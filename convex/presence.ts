import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const ONLINE_WINDOW_MS = 35_000; // còn "online" nếu heartbeat trong 35s gần đây

/** Client (deviceId) báo còn sống. Upsert lastSeenAt + dọn bản ghi cũ của phòng. */
export const heartbeat = mutation({
  args: { sessionId: v.id("sessions"), clientId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_session_and_client", (q) =>
        q.eq("sessionId", args.sessionId).eq("clientId", args.clientId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("presence", {
        sessionId: args.sessionId,
        clientId: args.clientId,
        lastSeenAt: now,
      });
    }

    // Dọn các bản ghi quá cũ (>5 phút) để bảng không phình.
    const stale = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const p of stale) {
      if (now - p.lastSeenAt > 300_000) await ctx.db.delete(p._id);
    }
  },
});

/** Số client đang online (heartbeat trong cửa sổ gần đây). */
export const onlineCount = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    return rows.filter((p) => now - p.lastSeenAt < ONLINE_WINDOW_MS).length;
  },
});
