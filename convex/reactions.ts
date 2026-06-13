import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Emoji hợp lệ — chặn rác/abuse, chỉ cho một bộ cảm xúc nhỏ.
const ALLOWED = new Set(["👏", "❤️", "😮", "😂", "👍", "🎉", "🤔", "🔥"]);

/** SV thả 1 reaction. Dọn các reaction cũ (>60s) của phòng để bảng không phình. */
export const sendReaction = mutation({
  args: { sessionId: v.id("sessions"), emoji: v.string() },
  handler: async (ctx, args) => {
    if (!ALLOWED.has(args.emoji)) return;

    await ctx.db.insert("reactions", {
      sessionId: args.sessionId,
      emoji: args.emoji,
    });

    // Dọn cũ: xoá reaction của phòng tạo trước đây >60s (giới hạn 50 cái/lần để rẻ).
    const cutoff = Date.now() - 60_000;
    const old = await ctx.db
      .query("reactions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(50);
    for (const r of old) {
      if (r._creationTime < cutoff) await ctx.db.delete(r._id);
      else break; // order asc → gặp cái còn mới thì dừng
    }
  },
});

/** Presenter lấy các reaction gần nhất để render bay lên (client tự lọc theo thời gian). */
export const recentReactions = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("reactions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(30);
    return rows.map((r) => ({ _id: r._id, emoji: r.emoji, createdAt: r._creationTime }));
  },
});
