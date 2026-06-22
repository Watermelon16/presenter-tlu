import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Helpers phân quyền dùng chung cho mọi mutation/query của GIẢNG VIÊN.
 *
 * Lý do: Convex mutation là endpoint công khai. Trước đây nhiều mutation thao tác
 * trên session (xóa buổi, đổi chế độ, điều khiển kịch bản, điểm danh...) KHÔNG kiểm
 * tra danh tính → bất kỳ ai biết sessionId (lộ ra trang SV) đều gọi được. Các helper
 * này khóa lại: phải đăng nhập + đã duyệt, và đúng chủ buổi (hoặc admin).
 *
 * KHÔNG dùng cho mutation của SINH VIÊN (joinSession, submitResponse, upvoteQuestion,
 * createBoardPost, toggleLikeBoardPost, sendReaction, heartbeat, generateUploadUrl):
 * SV không đăng nhập nên các mutation đó phải để công khai.
 */

// MutationCtx kế thừa khả năng đọc của QueryCtx nên QueryCtx đủ cho cả 2.
export async function requireApprovedUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(
    ctx as Parameters<typeof getAuthUserId>[0]
  );
  if (!userId) throw new Error("Cần đăng nhập trước");
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!profile) throw new Error("Profile chưa tạo — refresh và thử lại");
  if (profile.status === "banned") throw new Error("Tài khoản đã bị khoá");
  if (profile.status === "pending") throw new Error("Tài khoản chờ admin duyệt");
  return { userId, profile };
}

/**
 * Yêu cầu caller là chủ buổi giảng (hoặc admin). Trả về session để khỏi get lại.
 *
 * Tương thích ngược: session cũ (trước khi có ownerUserId) không có chủ → cho phép
 * mọi GV đã duyệt để không khóa cứng dữ liệu cũ. Session mới luôn có ownerUserId.
 */
export async function requireSessionOwner(
  ctx: QueryCtx,
  sessionId: Id<"sessions">
) {
  const { userId, profile } = await requireApprovedUser(ctx);
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Không tìm thấy buổi giảng");
  const isAdmin = profile.role === "admin";
  if (session.ownerUserId && session.ownerUserId !== userId && !isAdmin) {
    throw new Error("Bạn không có quyền với buổi giảng này");
  }
  return { userId, profile, session };
}
