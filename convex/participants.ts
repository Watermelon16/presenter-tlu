import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Sinh viên tham gia phòng + nhập thông tin danh tính
//
// CHỐNG GIAN LẬN (điểm danh hộ / làm bài hộ):
// - 1 thiết bị (deviceId) chỉ được dùng cho 1 studentCode duy nhất trong 1 phòng
// - Nếu cố join code khác từ cùng thiết bị → reject (báo "thiết bị đã đăng ký SV khác")
// - Nếu studentCode đã có nhưng từ thiết bị khác → flag participant để giảng viên kiểm tra
export const joinSession = mutation({
  args: {
    code: v.string(),
    studentCode: v.string(),
    fullName: v.string(),
    className: v.string(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();

    if (!session) {
      throw new Error("Không tìm thấy phòng với mã này");
    }

    if (session.status !== "active") {
      throw new Error("Phòng đã kết thúc");
    }

    const studentCode = args.studentCode.trim();
    const fullName = args.fullName.trim();
    const className = args.className.trim();
    const deviceId = args.deviceId?.trim() || undefined;

    // CHECK 1: Thiết bị này đã đăng ký SV khác trong phòng này chưa?
    if (deviceId) {
      const sameDevice = await ctx.db
        .query("participants")
        .withIndex("by_session_and_device", (q) =>
          q.eq("sessionId", session._id).eq("deviceId", deviceId)
        )
        .first();

      if (sameDevice && sameDevice.studentCode !== studentCode) {
        throw new Error(
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
      return { participantId: existing._id, sessionId: session._id, flagged: !!patch.flagged };
    }

    // Tạo bản ghi mới — gắn currentRun + auto-compute attendance status
    const joinedAt = Date.now();

    // Auto-set officialStartAt nếu chưa có (SV đầu tiên = T0)
    let officialStartAt = session.officialStartAt;
    if (!officialStartAt) {
      officialStartAt = joinedAt;
      await ctx.db.patch(session._id, { officialStartAt: joinedAt });
    }

    // Compute attendance status: ≤ T0+ngưỡng = present, > = late
    const lateThresholdMs = (session.lateThresholdMinutes ?? 10) * 60 * 1000;
    const attendanceStatus: "present" | "late" =
      joinedAt - officialStartAt <= lateThresholdMs ? "present" : "late";

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
    });

    // Fire-and-forget webhook sync sang LMS (nếu đã cấu hình)
    if (session.attendanceWebhookUrl && session.lmsSessionId) {
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: session.lmsSessionId,
        studentId: studentCode,
        studentName: fullName,
        attendanceStatus,
        checkinTime: joinedAt,
      });
    }

    return {
      participantId,
      sessionId: session._id,
      flagged: false,
      attendanceStatus,
      lateBySeconds: attendanceStatus === "late"
        ? Math.round((joinedAt - officialStartAt) / 1000)
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
    await ctx.db.patch(args.participantId, {
      attendanceStatus: args.status,
      attendanceManualOverride: true,
      attendanceNote: args.note,
    });
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
    officialStartAt: v.optional(v.number()),
    attendanceWebhookUrl: v.optional(v.string()),
    lmsSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.lateThresholdMinutes !== undefined) {
      patch.lateThresholdMinutes = Math.max(0, Math.min(60, args.lateThresholdMinutes));
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
