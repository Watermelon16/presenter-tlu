import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Sinh viên tham gia phòng + nhập thông tin danh tính
export const joinSession = mutation({
  args: {
    code: v.string(),
    studentCode: v.string(),
    fullName: v.string(),
    className: v.string(),
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

    // Kiểm tra xem mã sinh viên đã tham gia chưa trong phòng này
    const existing = await ctx.db
      .query("participants")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", session._id).eq("studentCode", args.studentCode.trim())
      )
      .first();

    if (existing) {
      // Nếu đã tham gia trước đó, cập nhật lại thông tin (hỗ trợ sửa tên/lớp)
      await ctx.db.patch(existing._id, {
        fullName: args.fullName.trim(),
        className: args.className.trim(),
      });
      return { participantId: existing._id, sessionId: session._id };
    }

    // Tạo bản ghi mới
    const participantId = await ctx.db.insert("participants", {
      sessionId: session._id,
      studentCode: args.studentCode.trim(),
      fullName: args.fullName.trim(),
      className: args.className.trim(),
      joinedAt: Date.now(),
    });

    return { participantId, sessionId: session._id };
  },
});

// Lấy danh sách sinh viên đã tham gia (dành cho giảng viên xem sau)
export const listParticipants = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .collect();
  },
});
