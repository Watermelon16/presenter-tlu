// LMS realtime sync — extend lmsProvisioning + lmsSync (đã có) bằng:
//   - setAttendanceOpenAt: LMS bấm "Bắt đầu buổi" → presenter ghi T0 cứng
//   - upsertParticipantFromLms: SV checkin LMS QR → mirror sang presenter
//   - syncRosterFromLms: refresh roster lớp
//   - finalizeAttendance: LMS đóng buổi → mark absent cho roster chưa join
//   - getAttendanceState: query realtime cho LmsAttendancePanel UI

import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
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
    await ctx.db.patch(session._id, {
      attendanceOpenAt: args.openAt,
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

    // Status: nếu LMS gửi explicit thì tôn trọng, không thì tự tính 3 trạng thái
    const status: InternalStatus = args.statusFromLms
      ? toInternalStatus(args.statusFromLms)
      : computeAttendanceFromCheckin(
          args.checkinAt,
          session.attendanceOpenAt,
          session.officialStartAt,
          session.lateCutoffMinutes,
          session.lateThresholdMinutes,
          session.absentAfterMinutes
        );

    const existing = await ctx.db
      .query("participants")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", session._id).eq("studentCode", args.studentCode)
      )
      .first();

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
      return { participantId: existing._id, created: false };
    }

    const id = await ctx.db.insert("participants", {
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
    return { participantId: id, created: true };
  },
});

// ─── Internal: LMS đóng buổi → mark absent cho roster chưa join ────────────
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
    }

    await ctx.db.patch(session._id, { attendanceFinalizedAt: args.closedAt });
    return { absentCount: inserted };
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

// ─── Public query: state attendance cho LmsAttendancePanel ─────────────────
export const getAttendanceState = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();
    if (!session) return null;

    const isLmsLinked = !!session.lmsSessionId;
    if (!isLmsLinked) {
      // Không liên thông LMS → panel ẩn (return null isLmsLinked = false)
      return {
        sessionId: session._id,
        isLmsLinked: false as const,
        attendanceOpenAt: null,
        lateCutoffMinutes: DEFAULT_LATE_CUTOFF_MINUTES,
        absentAfterMinutes: DEFAULT_ABSENT_AFTER_MINUTES,
        attendanceFinalizedAt: null,
        className: null,
        rosterCount: 0,
        counts: { present: 0, late: 0, absent: 0, excused: 0, earlyLeave: 0, notCheckedIn: 0 },
        rows: [],
      };
    }

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
      attendanceStatus: InternalStatus | null;
      checkinSource: "lms" | "presenter" | null;
      checkinAt: number | null;
      flagged: boolean;
    };
    const rows: Row[] = [];

    for (const r of roster) {
      const p = byCode.get(r.studentCode);
      rows.push({
        studentCode: r.studentCode,
        fullName: p?.fullName ?? r.fullName,
        attendanceStatus: (p?.attendanceStatus ?? null) as InternalStatus | null,
        checkinSource: p?.checkinSource ?? null,
        checkinAt: p?.checkinAt ?? p?.joinedAt ?? null,
        flagged: !!p?.flagged,
      });
      if (p) byCode.delete(r.studentCode);
    }
    // SV có participant nhưng KHÔNG có trong roster — bất thường, flag
    for (const p of byCode.values()) {
      rows.push({
        studentCode: p.studentCode,
        fullName: p.fullName,
        attendanceStatus: (p.attendanceStatus ?? null) as InternalStatus | null,
        checkinSource: p.checkinSource ?? null,
        checkinAt: p.checkinAt ?? p.joinedAt ?? null,
        flagged: true,
      });
    }

    rows.sort((a, b) => a.studentCode.localeCompare(b.studentCode));

    return {
      sessionId: session._id,
      isLmsLinked: true as const,
      attendanceOpenAt: session.attendanceOpenAt ?? session.officialStartAt ?? null,
      lateCutoffMinutes: session.lateCutoffMinutes ?? session.lateThresholdMinutes ?? DEFAULT_LATE_CUTOFF_MINUTES,
      absentAfterMinutes: session.absentAfterMinutes ?? DEFAULT_ABSENT_AFTER_MINUTES,
      attendanceFinalizedAt: session.attendanceFinalizedAt ?? null,
      className: session.className ?? null,
      rosterCount: roster.length,
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
