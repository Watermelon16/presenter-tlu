// LMS realtime sync — extend lmsProvisioning + lmsSync (đã có) bằng:
//   - setAttendanceOpenAt: LMS bấm "Bắt đầu buổi" → presenter ghi T0 cứng
//   - upsertParticipantFromLms: SV checkin LMS QR → mirror sang presenter
//   - syncRosterFromLms: refresh roster lớp
//   - finalizeAttendance: LMS đóng buổi → mark absent cho roster chưa join
//   - getAttendanceState: query realtime cho AttendancePanel UI

import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { replaceRoster } from "./lmsProvisioning";

// Map internal status (early_leave — feat/*) ↔ LMS status_code (left_early — DB LMS).
// Khi gửi ra LMS, đổi early_leave → left_early.
// Khi nhận từ LMS, đổi left_early → early_leave.
type InternalStatus = "present" | "late" | "excused" | "absent" | "early_leave";
type LmsStatus = "present" | "late" | "excused" | "absent" | "left_early";

export function toInternalStatus(lms: string | null | undefined): InternalStatus {
  if (lms === "left_early") return "early_leave";
  if (lms === "late" || lms === "excused" || lms === "absent" || lms === "present") return lms;
  return "present";
}
export function toLmsStatus(internal: InternalStatus): LmsStatus {
  if (internal === "early_leave") return "left_early";
  return internal;
}

const DEFAULT_LATE_CUTOFF_MINUTES = 10;
const DEFAULT_ABSENT_AFTER_MINUTES = 50;

// Tính trạng thái điểm danh dựa vào lúc check-in:
//   0..lateCutoff phút       → present
//   lateCutoff..absentAfter  → late
//   > absentAfter            → absent (auto; GV có thể chỉnh excused/late sau)
export function computeAttendanceFromCheckin(
  checkinAt: number,
  openAt: number | undefined,
  fallbackStartAt: number | undefined,
  lateCutoffMinutes: number | undefined,
  fallbackThresholdMinutes: number | undefined,
  absentAfterMinutes: number | undefined
): "present" | "late" | "absent" {
  // Ưu tiên attendanceOpenAt (LMS-driven); fallback officialStartAt (auto từ SV đầu)
  const t0 = openAt ?? fallbackStartAt;
  if (!t0) return "present";
  const lateMin = lateCutoffMinutes ?? fallbackThresholdMinutes ?? DEFAULT_LATE_CUTOFF_MINUTES;
  const absMin = absentAfterMinutes ?? DEFAULT_ABSENT_AFTER_MINUTES;
  const lateCutoff = t0 + lateMin * 60_000;
  const absentCutoff = t0 + absMin * 60_000;
  if (checkinAt > absentCutoff) return "absent";
  if (checkinAt > lateCutoff) return "late";
  return "present";
}

// Backward-compat alias — giữ tên cũ trong khi đang dùng ở nơi khác
export function computePresentOrLate(
  checkinAt: number,
  openAt: number | undefined,
  fallbackStartAt: number | undefined,
  cutoffMinutes: number | undefined,
  fallbackThresholdMinutes: number | undefined
): "present" | "late" {
  const r = computeAttendanceFromCheckin(
    checkinAt, openAt, fallbackStartAt,
    cutoffMinutes, fallbackThresholdMinutes,
    undefined  // không enforce absent cutoff khi gọi qua alias cũ
  );
  return r === "absent" ? "late" : r;
}

// ─── Internal: LMS gọi "Bắt đầu buổi" ──────────────────────────────────────
export const setAttendanceOpenAt = internalMutation({
  args: {
    lmsSessionId: v.string(),
    openAt: v.number(),
    lateCutoffMinutes: v.optional(v.number()),
    absentAfterMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_lms_session", (q) => q.eq("lmsSessionId", args.lmsSessionId))
      .first();
    if (!session) throw new ConvexError("Không tìm thấy phòng cho lmsSessionId");
    // Clear officialStartAt (auto-set khi SV đầu scan) — LMS-driven T0 ưu tiên hơn.
    // Tránh 2 T0 conflict trong panel + late computation.
    await ctx.db.patch(session._id, {
      attendanceOpenAt: args.openAt,
      officialStartAt: undefined,
      lateCutoffMinutes: args.lateCutoffMinutes ?? session.lateCutoffMinutes ?? DEFAULT_LATE_CUTOFF_MINUTES,
      absentAfterMinutes: args.absentAfterMinutes ?? session.absentAfterMinutes ?? DEFAULT_ABSENT_AFTER_MINUTES,
    });
    return { sessionId: session._id, code: session.code };
  },
});

// ─── Internal: sync roster (LMS đẩy danh sách mới) ─────────────────────────
export const syncRosterFromLms = internalMutation({
  args: {
    lmsSessionId: v.string(),
    roster: v.array(v.object({ studentCode: v.string(), fullName: v.string() })),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_lms_session", (q) => q.eq("lmsSessionId", args.lmsSessionId))
      .first();
    if (!session) throw new ConvexError("Không tìm thấy phòng cho lmsSessionId");
    await replaceRoster(ctx, session._id, args.lmsSessionId, args.roster);
    return { count: args.roster.length };
  },
});

// ─── Internal: SV checkin trên LMS QR → mirror sang presenter ──────────────
export const upsertParticipantFromLms = internalMutation({
  args: {
    lmsSessionId: v.string(),
    studentCode: v.string(),
    fullName: v.string(),
    checkinAt: v.number(),
    statusFromLms: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_lms_session", (q) => q.eq("lmsSessionId", args.lmsSessionId))
      .first();
    if (!session) throw new ConvexError("Không tìm thấy phòng cho lmsSessionId");

    const currentRun = session.currentRun ?? 1;

    // Status: Presenter là source of truth cho logic late/absent — luôn recompute
    // từ checkinAt + T₀ + cutoffs. Chỉ trust status_code từ LMS nếu là override
    // do GV LMS đánh tay (excused / early_leave) — Presenter compute không ra
    // được 2 trạng thái này.
    const lmsOverride = args.statusFromLms === "excused" || args.statusFromLms === "left_early" || args.statusFromLms === "early_leave"
      ? toInternalStatus(args.statusFromLms)
      : null;
    const status: InternalStatus = lmsOverride ?? computeAttendanceFromCheckin(
      args.checkinAt,
      session.attendanceOpenAt,
      session.officialStartAt,
      session.lateCutoffMinutes,
      session.lateThresholdMinutes,
      session.absentAfterMinutes
    );

    // Auto-add vào rosterCache nếu chưa có (LMS coi SV này hợp lệ → mitigate stale roster:
    // lần sau SV scan QR Presenter cùng MSV này sẽ pass roster validation luôn).
    const rosterRow = await ctx.db
      .query("rosterCache")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", session._id).eq("studentCode", args.studentCode)
      )
      .first();
    if (!rosterRow) {
      await ctx.db.insert("rosterCache", {
        sessionId: session._id,
        lmsSessionId: args.lmsSessionId,
        studentCode: args.studentCode,
        fullName: args.fullName,
        syncedAt: Date.now(),
      });
    }

    const existing = await ctx.db
      .query("participants")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", session._id).eq("studentCode", args.studentCode)
      )
      .first();

    let participantId;
    let created;
    if (existing && (existing.run ?? 1) === currentRun) {
      // Nếu GV đã override tay → không đè
      if (existing.attendanceManualOverride) {
        return { participantId: existing._id, skipped: "manual_override" };
      }
      await ctx.db.patch(existing._id, {
        attendanceStatus: status,
        checkinAt: args.checkinAt,
        checkinSource: "lms",
        fullName: args.fullName,
        className: session.className ?? existing.className,
        syncedToLmsAt: Date.now(),
      });
      participantId = existing._id;
      created = false;
    } else {
      participantId = await ctx.db.insert("participants", {
        sessionId: session._id,
        studentCode: args.studentCode,
        fullName: args.fullName,
        className: session.className ?? "",
        joinedAt: args.checkinAt,
        run: currentRun,
        attendanceStatus: status,
        attendanceManualOverride: false,
        checkinAt: args.checkinAt,
        checkinSource: "lms",
        syncedToLmsAt: Date.now(),
      });
      created = true;
    }

    // Echo về LMS khi Presenter compute status KHÁC với cái LMS gửi sang.
    // Lý do: LMS có thể chưa biết T0 hoặc dùng logic late khác → Presenter là
    // source of truth cho present/late/absent (compute từ checkinAt + T0 + cutoffs).
    // Không gây loop vì LMS không tự push lại khi nhận status update.
    const lmsSaid = toInternalStatus(args.statusFromLms ?? null);
    if (status !== lmsSaid) {
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: args.lmsSessionId,
        studentId: args.studentCode,
        studentName: args.fullName,
        attendanceStatus: status,
        checkinTime: args.checkinAt,
      });
    }

    return { participantId, created };
  },
});

// ─── Internal: LMS đóng buổi → mark absent cho roster chưa join + push lên LMS ─
export const finalizeAttendance = internalMutation({
  args: { lmsSessionId: v.string(), closedAt: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_lms_session", (q) => q.eq("lmsSessionId", args.lmsSessionId))
      .first();
    if (!session) throw new ConvexError("Không tìm thấy phòng cho lmsSessionId");

    const currentRun = session.currentRun ?? 1;
    const roster = await ctx.db
      .query("rosterCache")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();

    const checkedInCodes = new Set(
      participants.filter((p) => (p.run ?? 1) === currentRun).map((p) => p.studentCode)
    );

    let inserted = 0;
    const absentSvs: Array<{ studentCode: string; fullName: string }> = [];
    for (const r of roster) {
      if (checkedInCodes.has(r.studentCode)) continue;
      await ctx.db.insert("participants", {
        sessionId: session._id,
        studentCode: r.studentCode,
        fullName: r.fullName,
        className: session.className ?? "",
        joinedAt: args.closedAt,
        run: currentRun,
        attendanceStatus: "absent",
        attendanceManualOverride: false,
        checkinAt: args.closedAt,
        checkinSource: "lms",
        syncedToLmsAt: Date.now(),
      });
      inserted++;
      absentSvs.push({ studentCode: r.studentCode, fullName: r.fullName });
    }

    await ctx.db.patch(session._id, { attendanceFinalizedAt: args.closedAt });

    // Push từng SV absent về LMS (best-effort, scheduler ngoài tx).
    // Note: nếu LMS đóng buổi cũng thường tự mark absent trên DB của họ —
    // đẩy này là defensive sync để cả 2 bên chắc chắn match.
    for (const sv of absentSvs) {
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: args.lmsSessionId,
        studentId: sv.studentCode,
        studentName: sv.fullName,
        attendanceStatus: "absent",
        checkinTime: args.closedAt,
      });
    }

    return { absentCount: inserted };
  },
});

// ─── Internal: LMS xóa attendance_session → cascade delete phòng Presenter ─
// Đồng bộ với deleteSession trong sessions.ts (giống logic + cùng counts trả về).
export const deleteSessionByLmsId = internalMutation({
  args: { lmsSessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_lms_session", (q) => q.eq("lmsSessionId", args.lmsSessionId))
      .first();
    if (!session) return { ok: true, notFound: true, counts: null };

    const counts = {
      activities: 0, responses: 0, participants: 0, boardPosts: 0,
      images: 0, rosterCache: 0,
    };

    // 1. Board posts
    const boardPosts = await ctx.db
      .query("boardPosts")
      .filter((q) => q.eq(q.field("sessionId"), session._id))
      .collect();
    for (const p of boardPosts) { await ctx.db.delete(p._id); counts.boardPosts++; }

    // 2. Responses
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const r of responses) { await ctx.db.delete(r._id); counts.responses++; }

    // 3. Participants
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const p of participants) { await ctx.db.delete(p._id); counts.participants++; }

    // 4. Activities
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const a of activities) { await ctx.db.delete(a._id); counts.activities++; }

    // 5. Roster cache
    const roster = await ctx.db
      .query("rosterCache")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const r of roster) { await ctx.db.delete(r._id); counts.rosterCache++; }

    // 5b. Push subscriptions
    const pushSubs = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const s of pushSubs) { await ctx.db.delete(s._id); }

    // 6. PDF storage
    if (session.pdfStorageId) {
      try { await ctx.storage.delete(session.pdfStorageId); counts.images++; } catch { /* ignore */ }
    }

    // 7. Session itself
    const code = session.code;
    await ctx.db.delete(session._id);

    return { ok: true, notFound: false, code, counts };
  },
});

// ─── Internal query: dùng cho HTTP action /lms/student-checkin ─────────────
export const getSessionByLmsId = internalQuery({
  args: { lmsSessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_lms_session", (q) => q.eq("lmsSessionId", args.lmsSessionId))
      .first();
    if (!session) return null;
    return {
      sessionId: session._id,
      code: session.code,
      attendanceOpenAt: session.attendanceOpenAt,
      officialStartAt: session.officialStartAt,
      lateCutoffMinutes: session.lateCutoffMinutes,
      lateThresholdMinutes: session.lateThresholdMinutes,
    };
  },
});

// ─── Public query: state attendance cho AttendancePanel ─────────────────
export const getAttendanceState = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();
    if (!session) return null;

    const isLmsLinked = !!session.lmsSessionId;
    const currentRun = session.currentRun ?? 1;
    const roster = await ctx.db
      .query("rosterCache")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const presentInRun = participants.filter((p) => (p.run ?? 1) === currentRun);

    const byCode = new Map<string, Doc<"participants">>();
    for (const p of presentInRun) byCode.set(p.studentCode, p);

    type Row = {
      studentCode: string;
      fullName: string;
      className: string;
      attendanceStatus: InternalStatus | null;
      attendanceManualOverride: boolean;
      attendanceNote: string | null;
      checkinSource: "lms" | "presenter" | null;
      checkinAt: number | null;
      flagged: boolean;
      participantId: string | null;
    };
    const rows: Row[] = [];

    for (const r of roster) {
      const p = byCode.get(r.studentCode);
      rows.push({
        studentCode: r.studentCode,
        fullName: p?.fullName ?? r.fullName,
        className: p?.className ?? session.className ?? "",
        attendanceStatus: (p?.attendanceStatus ?? null) as InternalStatus | null,
        attendanceManualOverride: !!p?.attendanceManualOverride,
        attendanceNote: p?.attendanceNote ?? null,
        checkinSource: p?.checkinSource ?? null,
        checkinAt: p?.checkinAt ?? p?.joinedAt ?? null,
        flagged: !!p?.flagged,
        participantId: p?._id ?? null,
      });
      if (p) byCode.delete(r.studentCode);
    }
    // SV có participant nhưng KHÔNG có trong roster — bất thường, flag
    for (const p of byCode.values()) {
      rows.push({
        studentCode: p.studentCode,
        fullName: p.fullName,
        className: p.className,
        attendanceStatus: (p.attendanceStatus ?? null) as InternalStatus | null,
        attendanceManualOverride: !!p.attendanceManualOverride,
        attendanceNote: p.attendanceNote ?? null,
        checkinSource: p.checkinSource ?? null,
        checkinAt: p.checkinAt ?? p.joinedAt ?? null,
        flagged: !isLmsLinked ? false : true, // chỉ flag nếu LMS-linked (vì non-LMS không có roster)
        participantId: p._id,
      });
    }

    rows.sort((a, b) => a.studentCode.localeCompare(b.studentCode));

    // Lấy syncedAt của roster row mới nhất (nếu có) để hiện trên panel
    const rosterSyncedAt = roster.reduce<number | null>(
      (max, r) => (max == null || r.syncedAt > max ? r.syncedAt : max),
      null
    );

    return {
      sessionId: session._id,
      sessionTitle: session.title,
      isLmsLinked,
      attendanceOpenAt: session.attendanceOpenAt ?? session.officialStartAt ?? null,
      lateCutoffMinutes: session.lateCutoffMinutes ?? session.lateThresholdMinutes ?? DEFAULT_LATE_CUTOFF_MINUTES,
      absentAfterMinutes: session.absentAfterMinutes ?? DEFAULT_ABSENT_AFTER_MINUTES,
      attendanceFinalizedAt: session.attendanceFinalizedAt ?? null,
      className: session.className ?? null,
      rosterCount: roster.length,
      rosterSyncedAt,
      counts: {
        present: rows.filter((r) => r.attendanceStatus === "present").length,
        late: rows.filter((r) => r.attendanceStatus === "late").length,
        absent: rows.filter((r) => r.attendanceStatus === "absent").length,
        excused: rows.filter((r) => r.attendanceStatus === "excused").length,
        earlyLeave: rows.filter((r) => r.attendanceStatus === "early_leave").length,
        notCheckedIn: rows.filter((r) => r.attendanceStatus === null).length,
      },
      rows,
    };
  },
});

// ─── Public query: ngữ cảnh phòng để join page biết LMS-linked hay chưa ────
export const peekJoinContext = query({
  args: { code: v.string(), studentCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();
    if (!session) return null;

    const isLmsLinked = !!session.lmsSessionId;
    let rosterMatch: { fullName: string } | null = null;
    let rosterCount = 0;
    if (isLmsLinked) {
      const roster = await ctx.db
        .query("rosterCache")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();
      rosterCount = roster.length;
      if (args.studentCode?.trim()) {
        const row = await ctx.db
          .query("rosterCache")
          .withIndex("by_session_and_student", (q) =>
            q.eq("sessionId", session._id).eq("studentCode", args.studentCode!.trim())
          )
          .first();
        if (row) rosterMatch = { fullName: row.fullName };
      }
    }

    return {
      title: session.title,
      status: session.status,
      isLmsLinked,
      className: session.className ?? null,
      attendanceOpenAt: session.attendanceOpenAt ?? null,
      lateCutoffMinutes: session.lateCutoffMinutes ?? session.lateThresholdMinutes ?? DEFAULT_LATE_CUTOFF_MINUTES,
      rosterCount: isLmsLinked ? rosterCount : null,
      rosterMatch,
    };
  },
});
