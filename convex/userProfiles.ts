import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * User profile management.
 *
 * Flow:
 * - User đăng nhập Google lần đầu → Convex Auth tạo users row.
 * - `ensureProfile` được gọi từ client → tạo userProfiles row (status="pending", role="lecturer").
 * - First user ever → auto-promote thành admin + approved.
 * - Admin có thể approve/ban/promote khác.
 */

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      user: user
        ? {
            _id: user._id,
            email: user.email ?? null,
            name: user.name ?? null,
            image: user.image ?? null,
          }
        : null,
      profile: profile
        ? {
            _id: profile._id,
            status: profile.status,
            role: profile.role,
            displayName: profile.displayName ?? null,
            email: profile.email,
          }
        : null,
    };
  },
});

/**
 * Tạo profile nếu chưa có — gọi mỗi lần user load home.
 * Auto-promote first user thành admin + approved.
 */
export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) return existing._id;

    // Check xem đây có phải user đầu tiên không → admin + approved
    const allProfiles = await ctx.db.query("userProfiles").take(1);
    const isFirstUser = allProfiles.length === 0;

    const id = await ctx.db.insert("userProfiles", {
      userId,
      email: user.email ?? "",
      displayName: user.name ?? undefined,
      status: isFirstUser ? "approved" : "pending",
      role: isFirstUser ? "admin" : "lecturer",
      createdAt: Date.now(),
      approvedAt: isFirstUser ? Date.now() : undefined,
      approvedBy: isFirstUser ? userId : undefined,
    });
    return id;
  },
});

/**
 * Helper internal — lấy profile từ ctx auth, throw nếu không có hoặc không approved.
 * Sessions/activities mutations dùng để gate access.
 */
export async function requireApprovedUser(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
  db: {
    query: (table: string) => {
      withIndex: (
        idx: string,
        cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown
      ) => { first: () => Promise<Doc<"userProfiles"> | null> };
    };
    get: (id: Id<"users">) => Promise<Doc<"users"> | null>;
  };
}): Promise<{ userId: Id<"users">; profile: Doc<"userProfiles"> }> {
  // Inline implementation — không thể import getAuthUserId vào helper signature gọn vậy.
  // Caller phải gọi getAuthUserId rồi pass userId vào — hoặc dùng requireApprovedUserInline.
  throw new Error("Dùng requireApprovedUserInline thay vì requireApprovedUser");
}

// === Admin management ===

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") return null;

    const profiles = await ctx.db.query("userProfiles").collect();
    return profiles
      .map((p) => ({
        _id: p._id,
        userId: p.userId,
        email: p.email,
        displayName: p.displayName ?? null,
        status: p.status,
        role: p.role,
        createdAt: p.createdAt,
        approvedAt: p.approvedAt ?? null,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const setUserStatus = mutation({
  args: {
    profileId: v.id("userProfiles"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("banned")
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") throw new Error("Cần quyền admin");

    const target = await ctx.db.get(args.profileId);
    if (!target) throw new Error("Không tìm thấy user");
    // Không cho admin tự ban chính mình
    if (target.userId === userId && args.status !== "approved") {
      throw new Error("Không thể tự thay đổi status của chính mình");
    }

    await ctx.db.patch(args.profileId, {
      status: args.status,
      approvedAt: args.status === "approved" ? Date.now() : target.approvedAt,
      approvedBy: args.status === "approved" ? userId : target.approvedBy,
    });
  },
});

export const setUserRole = mutation({
  args: {
    profileId: v.id("userProfiles"),
    role: v.union(v.literal("admin"), v.literal("lecturer")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") throw new Error("Cần quyền admin");

    const target = await ctx.db.get(args.profileId);
    if (!target) throw new Error("Không tìm thấy user");
    // Không cho hạ vai trò của chính mình (tránh lock-out)
    if (target.userId === userId && args.role !== "admin") {
      throw new Error("Không thể tự hạ vai trò của chính mình");
    }
    await ctx.db.patch(args.profileId, { role: args.role });
  },
});

// === Internal wipe data — admin gọi để reset toàn bộ ===

export const adminWipeAllSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") throw new Error("Cần quyền admin");

    const counts = { sessions: 0, activities: 0, responses: 0, participants: 0, boardPosts: 0, push: 0 };

    const sessions = await ctx.db.query("sessions").collect();
    for (const s of sessions) {
      // Cascade delete
      const acts = await ctx.db
        .query("activities")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const a of acts) {
        await ctx.db.delete(a._id);
        counts.activities++;
      }
      const parts = await ctx.db
        .query("participants")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const p of parts) {
        await ctx.db.delete(p._id);
        counts.participants++;
      }
      const resps = await ctx.db
        .query("responses")
        .withIndex("by_session_and_student", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const r of resps) {
        await ctx.db.delete(r._id);
        counts.responses++;
      }
      const posts = await ctx.db
        .query("boardPosts")
        .filter((q) => q.eq(q.field("sessionId"), s._id))
        .collect();
      for (const p of posts) {
        await ctx.db.delete(p._id);
        counts.boardPosts++;
      }
      const subs = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const sub of subs) {
        await ctx.db.delete(sub._id);
        counts.push++;
      }
      if (s.pdfStorageId) {
        try {
          await ctx.storage.delete(s.pdfStorageId);
        } catch {}
      }
      await ctx.db.delete(s._id);
      counts.sessions++;
    }
    return counts;
  },
});
