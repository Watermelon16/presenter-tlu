import { internalMutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";

/**
 * Tạo (hoặc reuse) Presenter session từ request của LMS.
 *
 * Gọi qua HTTP endpoint POST /lms/create-room (xem convex/http.ts).
 * LMS gửi `lms_session_id` (UUID attendance_session) + `host_email` (GV).
 * Optionally LMS gửi `roster` để Presenter cache validate MSV + auto-fill họ tên.
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
    lmsClassId: v.optional(v.string()),
    roster: v.optional(
      v.array(v.object({ studentCode: v.string(), fullName: v.string() }))
    ),
  },
  handler: async (ctx, args) => {
    // 1. Idempotency: đã có session linked LMS này chưa?
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_lms_session", (q) =>
        q.eq("lmsSessionId", args.lmsSessionId)
      )
      .first();
    if (existing) {
      // Refresh roster (nếu LMS gửi) — danh sách SV có thể thay đổi
      if (args.roster) {
        await replaceRoster(ctx, existing._id, args.lmsSessionId, args.roster);
      }
      // Refresh className/lmsClassId nếu LMS gửi
      const patch: Record<string, unknown> = {};
      if (args.className !== undefined) patch.className = args.className;
      if (args.lmsClassId !== undefined) patch.lmsClassId = args.lmsClassId;
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);

      return {
        sessionId: existing._id,
        code: existing.code,
        created: false,
        rosterCount: args.roster?.length ?? 0,
      };
    }

    // 2. Tìm Convex user theo email
    //    Ưu tiên match email TRỰC TIẾP (vì giờ GV có thể login Presenter
    //    bằng @tlu.edu.vn qua MS), fallback sang lmsEmail mapping nếu
    //    user @tlu.edu.vn chưa từng login Presenter.
    const emailLower = args.hostEmail.trim().toLowerCase();
    let profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", emailLower))
      .first();
    if (!profile) {
      profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_lms_email", (q) => q.eq("lmsEmail", emailLower))
        .first();
    }
    if (!profile) {
      throw new Error(
        `Không tìm thấy GV với email "${args.hostEmail}" trên Presenter. GV cần đăng nhập Presenter (Google) ít nhất 1 lần, hoặc admin cần set lmsEmail = "${args.hostEmail}" cho user tương ứng.`
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
      className: args.className,
      lmsClassId: args.lmsClassId,
      hostEmail: emailLower,
    });

    // 5. Cache roster nếu LMS gửi
    if (args.roster) {
      await replaceRoster(ctx, sessionId, args.lmsSessionId, args.roster);
    }

    return {
      sessionId,
      code,
      created: true,
      rosterCount: args.roster?.length ?? 0,
    };
  },
});

// Helper: thay roster cache (xoá hết rồi insert lại) — exported để dùng lại trong lms.ts
export async function replaceRoster(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  lmsSessionId: string,
  roster: Array<{ studentCode: string; fullName: string }>
): Promise<void> {
  const existing = await ctx.db
    .query("rosterCache")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const r of existing) await ctx.db.delete(r._id);
  const now = Date.now();
  for (const item of roster) {
    if (!item.studentCode?.trim()) continue;
    await ctx.db.insert("rosterCache", {
      sessionId,
      lmsSessionId,
      studentCode: item.studentCode.trim(),
      fullName: item.fullName.trim(),
      syncedAt: now,
    });
  }
}

// Tạo mã ngắn (chung với sessions.ts — copy để tránh import cross-file in internal)
function generateShortCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Bỏ I, O, 0, 1 để dễ đọc
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
