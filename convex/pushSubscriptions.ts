import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Đăng ký push subscription cho SV trong 1 session.
 * Idempotent: nếu endpoint đã tồn tại → cập nhật, không tạo trùng.
 */
export const registerSubscription = mutation({
  args: {
    sessionId: v.id("sessions"),
    studentCode: v.optional(v.string()),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionId: args.sessionId,
        studentCode: args.studentCode,
        p256dh: args.p256dh,
        auth: args.auth,
      });
      return { id: existing._id, updated: true };
    }

    const id = await ctx.db.insert("pushSubscriptions", {
      sessionId: args.sessionId,
      studentCode: args.studentCode,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/**
 * Huỷ đăng ký theo endpoint (gọi từ client khi SV opt-out / rời phòng).
 */
export const unregisterSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Liệt kê subscriptions của 1 session — dùng cho action gửi push.
 */
export const listSubscriptionsForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

/**
 * Xoá nhiều subscription theo IDs — dùng khi push server trả 410 Gone.
 * Internal: chỉ gọi từ action sendActivityNotification.
 */
export const deleteSubscriptionsByIds = internalMutation({
  args: { ids: v.array(v.id("pushSubscriptions")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      try {
        await ctx.db.delete(id);
      } catch {
        // đã bị xoá
      }
    }
  },
});
