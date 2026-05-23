import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Lấy danh sách tất cả bài đăng của một Board (realtime) — chỉ phiên hiện tại
export const listBoardPosts = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return [];

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const posts = await ctx.db
      .query("boardPosts")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .filter((q) => q.eq(q.field("status"), "visible"))
      .collect();

    // Filter theo run hiện tại (undefined = run 1, backward compat)
    const currentRunPosts = posts.filter((p) => (p.run ?? 1) === currentRun);

    return currentRunPosts.sort((a, b) => {
      if (b.likes !== a.likes) return b.likes - a.likes;
      return b.createdAt - a.createdAt;
    });
  },
});

// Sinh viên đăng bài mới lên Board (hỗ trợ ảnh)
export const createBoardPost = mutation({
  args: {
    activityId: v.id("activities"),
    content: v.string(),
    columnId: v.string(),
    imageStorageId: v.optional(v.id("_storage")), // ID từ Convex Storage
    studentCode: v.optional(v.string()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity || activity.type !== "board") {
      throw new Error("Hoạt động không phải Board hoặc không tồn tại");
    }
    if (activity.status !== "active") {
      throw new Error("Board hiện không mở để đăng bài");
    }

    // Kiểm tra thời gian nếu có
    if (activity.timeLimit && activity.startedAt) {
      const elapsed = (Date.now() - activity.startedAt) / (1000 * 60);
      if (elapsed > activity.timeLimit) {
        throw new Error("Đã hết thời gian đăng bài");
      }
    }

    // Kiểm tra yêu cầu mã sinh viên
    if (activity.requiresStudentCode && !args.studentCode) {
      throw new Error("Board này yêu cầu nhập mã sinh viên");
    }

    let finalImageUrl: string | undefined = undefined;

    if (args.imageStorageId) {
      // Resolve storageId thành URL công khai
      const url = await ctx.storage.getUrl(args.imageStorageId);
      if (url) {
        finalImageUrl = url;
      }
    }

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const postId = await ctx.db.insert("boardPosts", {
      activityId: args.activityId,
      sessionId: activity.sessionId,
      studentCode: args.studentCode,
      content: args.content.trim(),
      imageUrl: finalImageUrl,
      imageStorageId: args.imageStorageId,  // lưu để cleanup storage khi delete
      columnId: args.columnId,
      likes: 0,
      status: "visible",
      createdAt: Date.now(),
      run: currentRun,
    });

    return postId;
  },
});

// Like / Unlike một bài đăng (toggle đơn giản)
export const toggleLikeBoardPost = mutation({
  args: { postId: v.id("boardPosts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return;

    // Tăng like (không trừ để đơn giản, sinh viên có thể like nhiều lần nhưng hiếm)
    await ctx.db.patch(args.postId, {
      likes: post.likes + 1,
    });
  },
});

// Giảng viên ẩn / hiện bài đăng
export const setBoardPostStatus = mutation({
  args: {
    postId: v.id("boardPosts"),
    status: v.union(v.literal("visible"), v.literal("hidden")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.postId, { status: args.status });
  },
});

// Giảng viên xóa bài đăng
export const deleteBoardPost = mutation({
  args: { postId: v.id("boardPosts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return;
    // Cleanup ảnh khỏi Convex storage nếu có (chỉ posts mới có imageStorageId).
    if (post.imageStorageId) {
      try { await ctx.storage.delete(post.imageStorageId); } catch { /* ignore */ }
    }
    await ctx.db.delete(args.postId);
  },
});

// (Tùy chọn sau) Di chuyển bài sang cột khác
export const moveBoardPostToColumn = mutation({
  args: {
    postId: v.id("boardPosts"),
    newColumnId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.postId, { columnId: args.newColumnId });
  },
});
