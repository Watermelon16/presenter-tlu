import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { computeAttendanceFromCheckin } from "./lms";

// Sinh viên tham gia phòng + nhập thông tin danh tính
//
// CHỐNG GIAN LẬN (điểm danh hộ / làm bài hộ):
// - 1 thiết bị (deviceId) chỉ được dùng cho 1 studentCode duy nhất trong 1 phòng
// - Nếu cố join code khác từ cùng thiết bị → reject (báo "thiết bị đã đăng ký SV khác")
// - Nếu studentCode đã có nhưng từ thiết bị khác → flag participant để giảng viên kiểm tra
//
// LIÊN THÔNG LMS: nếu session.lmsSessionId set:
// - fullName/className truyền vào bị bỏ qua, lấy từ rosterCache theo studentCode
// - studentCode không có trong rosterCache → REJECT
// - Cutoff đi muộn dùng attendanceOpenAt + lateCutoffMinutes (LMS-driven)
//   fallback sang officialStartAt + lateThresholdMinutes (legacy first-scan)
export const joinSession = mutation({
  args: {
    code: v.string(),
    studentCode: v.string(),
    fullName: v.optional(v.string()),
    className: v.optional(v.string()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();

    if (!session) {
      throw new ConvexError("Không tìm thấy phòng với mã này");
    }

    if (session.status !== "active") {
      throw new ConvexError("Phòng đã kết thúc");
    }

    const studentCode = args.studentCode.trim();
    if (!studentCode) {
      throw new ConvexError("Vui lòng nhập mã sinh viên");
    }
    const deviceId = args.deviceId?.trim() || undefined;
    const isLmsLinked = !!session.lmsSessionId;

    // Resolve fullName + className
    let fullName: string;
    let className: string;
    if (isLmsLinked) {
      const rosterRow = await ctx.db
        .query("rosterCache")
        .withIndex("by_session_and_student", (q) =>
          q.eq("sessionId", session._id).eq("studentCode", studentCode)
        )
        .first();
      if (!rosterRow) {
        throw new ConvexError("Mã sinh viên không có trong danh sách lớp. Liên hệ giảng viên để kiểm tra.");
      }
      fullName = rosterRow.fullName;
      className = session.className ?? "";
    } else {
      fullName = (args.fullName ?? "").trim();
      className = (args.className ?? "").trim();
      if (!fullName || !className) {
        throw new ConvexError("Vui lòng nhập đầy đủ Họ tên và Lớp");
      }
    }

    // CHECK 1: Thiết bị này đã đăng ký SV khác trong phòng này chưa?
    if (deviceId) {
      const sameDevice = await ctx.db
        .query("participants")
        .withIndex("by_session_and_device", (q) =>
          q.eq("sessionId", session._id).eq("deviceId", deviceId)
        )
        .first();

      if (sameDevice && sameDevice.studentCode !== studentCode) {
        throw new ConvexError(
          `Thiết bị này đã đăng ký SV "${sameDevice.studentCode}" (${sameDevice.fullName}) trong buổi. Mỗi thiết bị chỉ dùng cho 1 SV.`
        );
      }
    }

    // Tìm participant theo studentCode
    const existing = await ctx.db
      .query("participants")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", session._id).eq("studentCode", studentCode)
      )
      .first();

    const currentRun = session.currentRun ?? 1;
    const joinedAt = Date.now();

    // CHECK 2: tìm participant của SV này trong PHIÊN HIỆN TẠI (run filter)
    // Nếu existing là của phiên trước → tạo participant mới cho phiên này
    if (existing && (existing.run ?? 1) === currentRun) {
      const patch: Record<string, unknown> = {
        fullName,
        className,
      };

      if (deviceId && existing.deviceId && existing.deviceId !== deviceId) {
        patch.deviceId = deviceId;
        patch.flagged = true;
        patch.flagReason = `Đăng nhập từ ${(existing.deviceChangeCount ?? 0) + 2} thiết bị khác nhau trong buổi`;
        patch.deviceChangeCount = (existing.deviceChangeCount ?? 0) + 1;
      } else if (deviceId && !existing.deviceId) {
        patch.deviceId = deviceId;
      }

      await ctx.db.patch(existing._id, patch);
      return {
        participantId: existing._id,
        sessionId: session._id,
        flagged: !!patch.flagged,
        attendanceStatus: existing.attendanceStatus ?? null,
        fullName,
        className,
      };
    }

    // Auto-set officialStartAt nếu chưa có và session KHÔNG dùng attendanceOpenAt (LMS-driven)
    let officialStartAt = session.officialStartAt;
    if (!officialStartAt && !session.attendanceOpenAt) {
      officialStartAt = joinedAt;
      await ctx.db.patch(session._id, { officialStartAt: joinedAt });
    }

    // Compute attendance: ưu tiên attendanceOpenAt (LMS), fallback officialStartAt
    // 3 trạng thái: 0..10p=present, 10..50p=late, >50p=absent (cấu hình per session)
    const attendanceStatus = computeAttendanceFromCheckin(
      joinedAt,
      session.attendanceOpenAt,
      officialStartAt,
      session.lateCutoffMinutes,
      session.lateThresholdMinutes,
      session.absentAfterMinutes
    );

    const participantId = await ctx.db.insert("participants", {
      sessionId: session._id,
      studentCode,
      fullName,
      className,
      joinedAt,
      deviceId,
      deviceChangeCount: 0,
      run: currentRun,
      attendanceStatus,
      attendanceManualOverride: false,
      checkinAt: joinedAt,
      checkinSource: isLmsLinked ? "presenter" : undefined,
    });

    // Fire-and-forget webhook sync sang LMS (nếu session liên thông LMS).
    // webhookUrl ưu tiên field session, fallback env LMS_SYNC_URL (đã set).
    if (session.lmsSessionId) {
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: session.lmsSessionId,
        studentId: studentCode,
        studentName: fullName,
        attendanceStatus,
        checkinTime: joinedAt,
      });
    }

    const t0 = session.attendanceOpenAt ?? officialStartAt;
    return {
      participantId,
      sessionId: session._id,
      flagged: false,
      attendanceStatus,
      fullName,
      className,
      lateBySeconds: attendanceStatus === "late" && t0
        ? Math.round((joinedAt - t0) / 1000)
        : 0,
    };
  },
});

// Lấy danh sách sinh viên đã tham gia (dành cho giảng viên xem sau)
export const listParticipants = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const currentRun = session?.currentRun ?? 1;
    const all = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .collect();
    return all.filter((p) => (p.run ?? 1) === currentRun);
  },
});

/**
 * GV override attendance status cho 1 SV.
 * Set manualOverride=true để tránh auto-recompute.
 */
export const setAttendanceStatus = mutation({
  args: {
    participantId: v.id("participants"),
    status: v.union(
      v.literal("present"),
      v.literal("late"),
      v.literal("excused"),
      v.literal("absent"),
      v.literal("early_leave")
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    if (!participant) throw new ConvexError("Không tìm thấy SV");

    await ctx.db.patch(args.participantId, {
      attendanceStatus: args.status,
      attendanceManualOverride: true,
      attendanceNote: args.note,
    });

    // Push status mới lên LMS nếu session liên thông LMS
    const session = await ctx.db.get(participant.sessionId);
    if (session?.lmsSessionId) {
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: session.lmsSessionId,
        studentId: participant.studentCode,
        studentName: participant.fullName,
        attendanceStatus: args.status,
        checkinTime: participant.checkinAt ?? participant.joinedAt,
      });
    }
  },
});

/**
 * Reset officialStartAt (T0) của session — dùng khi GV muốn lấy giờ
 * scan đầu tiên thực sự làm T0 thay vì giá trị đã set tạm.
 */
export const resetOfficialStartAt = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { officialStartAt: undefined });
    return { ok: true };
  },
});

/**
 * Xóa 1 participant (GV cleanup nhầm/giả). Cũng xóa response của SV đó
 * cho session này để giữ DB sạch.
 */
export const removeParticipant = mutation({
  args: { participantId: v.id("participants") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.participantId);
    if (!p) return { ok: false, reason: "not_found" };
    // Xóa responses của SV này trong session
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", p.sessionId).eq("studentCode", p.studentCode)
      )
      .collect();
    for (const r of responses) {
      await ctx.db.delete(r._id);
    }
    await ctx.db.delete(args.participantId);
    // Reset officialStartAt nếu vừa xóa SV đầu tiên (so far ko critical, skip)
    return { ok: true, responsesDeleted: responses.length };
  },
});

/**
 * Bulk override — set status cho NHIỀU SV cùng lúc.
 * Dùng cho action "Đánh tất cả vắng có phép", v.v.
 */
export const setAttendanceStatusBulk = mutation({
  args: {
    participantIds: v.array(v.id("participants")),
    status: v.union(
      v.literal("present"),
      v.literal("late"),
      v.literal("excused"),
      v.literal("absent"),
      v.literal("early_leave")
    ),
  },
  handler: async (ctx, args) => {
    for (const id of args.participantIds) {
      await ctx.db.patch(id, {
        attendanceStatus: args.status,
        attendanceManualOverride: true,
      });
      // Push từng SV lên LMS nếu session liên thông LMS
      const p = await ctx.db.get(id);
      if (!p) continue;
      const session = await ctx.db.get(p.sessionId);
      if (session?.lmsSessionId) {
        await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
          webhookUrl: session.attendanceWebhookUrl,
          lmsSessionId: session.lmsSessionId,
          studentId: p.studentCode,
          studentName: p.fullName,
          attendanceStatus: args.status,
          checkinTime: p.checkinAt ?? p.joinedAt,
        });
      }
    }
    return { count: args.participantIds.length };
  },
});

/**
 * GV chỉnh setting điểm danh của session: ngưỡng đi muộn, T0, webhook URL.
 */
export const updateAttendanceSettings = mutation({
  args: {
    sessionId: v.id("sessions"),
    lateThresholdMinutes: v.optional(v.number()),
    absentAfterMinutes: v.optional(v.number()),
    officialStartAt: v.optional(v.number()),
    attendanceWebhookUrl: v.optional(v.string()),
    lmsSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.lateThresholdMinutes !== undefined) {
      patch.lateThresholdMinutes = Math.max(0, Math.min(120, args.lateThresholdMinutes));
    }
    if (args.absentAfterMinutes !== undefined) {
      patch.absentAfterMinutes = Math.max(0, Math.min(240, args.absentAfterMinutes));
      // Phải > lateThresholdMinutes
      const lt = args.lateThresholdMinutes ?? (await ctx.db.get(args.sessionId))?.lateThresholdMinutes ?? 10;
      if ((patch.absentAfterMinutes as number) <= lt) {
        throw new ConvexError(`Ngưỡng vắng (${patch.absentAfterMinutes}p) phải lớn hơn ngưỡng đi muộn (${lt}p)`);
      }
    }
    if (args.officialStartAt !== undefined) {
      patch.officialStartAt = args.officialStartAt;
    }
    if (args.attendanceWebhookUrl !== undefined) {
      const url = args.attendanceWebhookUrl.trim();
      patch.attendanceWebhookUrl = url || undefined;
    }
    if (args.lmsSessionId !== undefined) {
      const id = args.lmsSessionId.trim();
      patch.lmsSessionId = id || undefined;
    }
    await ctx.db.patch(args.sessionId, patch);
  },
});
