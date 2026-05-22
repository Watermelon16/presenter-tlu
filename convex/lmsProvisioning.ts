import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Tạo (hoặc reuse) Presenter session từ request của LMS.
 *
 * Gọi qua HTTP endpoint POST /lms/create-room (xem convex/http.ts).
 * LMS gửi `lms_session_id` (UUID attendance_session) + `host_email` (GV).
 * Idempotent: cùng `lms_session_id` → trả về session cũ thay vì tạo mới.
 *
 * Yêu cầu: GV đã từng login Presenter (Google OAuth) → có `userProfiles`
 * với email khớp + status "approved". Nếu chưa → throw để LMS báo GV.
 */
export const createSessionFromLms = internalMutation({
  args: {
    lmsSessionId: v.string(),
    title: v.string(),
    hostEmail: v.string(),
    hostName: v.optional(v.string()),
    className: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Idempotency: đã có session linked LMS này chưa?
    const existing = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("lmsSessionId"), args.lmsSessionId))
      .first();
    if (existing) {
      return {
        sessionId: existing._id,
        code: existing.code,
        created: false,
      };
    }

    // 2. Tìm Convex user theo email (đã từng login Google Presenter)
    const emailLower = args.hostEmail.trim().toLowerCase();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", emailLower))
      .first();
    if (!profile) {
      throw new Error(
        `Không tìm thấy GV với email "${args.hostEmail}" trên Presenter. GV cần đăng nhập Presenter (Google) ít nhất 1 lần trước khi LMS tạo phòng.`
      );
    }
    if (profile.status === "banned") {
      throw new Error(`GV "${args.hostEmail}" đã bị khoá tài khoản trên Presenter`);
    }
    if (profile.status === "pending") {
      throw new Error(`GV "${args.hostEmail}" chưa được admin Presenter duyệt`);
    }

    // 3. Sinh code phòng — retry nếu collision (rất hiếm với 32^6 ≈ 1B)
    let code = generateShortCode();
    for (let i = 0; i < 5; i++) {
      const collision = await ctx.db
        .query("sessions")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!collision) break;
      code = generateShortCode();
    }

    // 4. Tạo session — gắn lmsSessionId để mapping 2 chiều
    const sessionId = await ctx.db.insert("sessions", {
      code,
      title: args.title.trim(),
      hostName: args.hostName?.trim() || profile.displayName || profile.email,
      collectStudentCode: true,
      status: "active",
      createdAt: Date.now(),
      currentRun: 1,
      ownerUserId: profile.userId,
      lmsSessionId: args.lmsSessionId,
    });

    return { sessionId, code, created: true };
  },
});

// Tạo mã ngắn (chung với sessions.ts — copy để tránh import cross-file in internal)
function generateShortCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Bỏ I, O, 0, 1 để dễ đọc
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
