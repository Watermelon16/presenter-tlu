import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
          `Thiết bị này đã đăng ký với mã SV "${sameDevice.studentCode}" (${sameDevice.fullName}) trong buổi này. Mỗi thiết bị chỉ được dùng cho 1 SV.`
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
        patch.flagReason = `Đăng nhập từ ${(existing.deviceChangeCount ?? 0) + 2} thiết bị khác nhau (nghi vấn điểm danh hộ)`;
        patch.deviceChangeCount = (existing.deviceChangeCount ?? 0) + 1;
      } else if (deviceId && !existing.deviceId) {
        patch.deviceId = deviceId;
      }

      await ctx.db.patch(existing._id, patch);
      return { participantId: existing._id, sessionId: session._id, flagged: !!patch.flagged };
    }

    // Tạo bản ghi mới — gắn currentRun
    const participantId = await ctx.db.insert("participants", {
      sessionId: session._id,
      studentCode,
      fullName,
      className,
      joinedAt: Date.now(),
      deviceId,
      deviceChangeCount: 0,
      run: currentRun,
    });

    return { participantId, sessionId: session._id, flagged: false };
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
