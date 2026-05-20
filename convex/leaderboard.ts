import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Default scoring (công bằng cho sinh viên đại học)
const DEFAULT_SCORING = {
  poll: 1,
  wordcloud: 1,
  rating: 1,
  board: 2,
  qa: 2,
  qaUpvote: 1,
};

export const getScoringConfig = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return DEFAULT_SCORING;

    return session.scoringConfig ?? DEFAULT_SCORING;
  },
});

export const updateScoringConfig = mutation({
  args: {
    sessionId: v.id("sessions"),
    config: v.object({
      poll: v.number(),
      wordcloud: v.number(),
      rating: v.number(),
      board: v.number(),
      qa: v.number(),
      qaUpvote: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      scoringConfig: args.config,
    });
    return { success: true };
  },
});

// Tính điểm tham gia của sinh viên trong buổi
export const getParticipationLeaderboard = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];

    const config = session.scoringConfig ?? DEFAULT_SCORING;

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const responses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const boardPosts = await ctx.db
      .query("boardPosts")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .collect();

    const scoreMap = new Map<string, number>();

    // Khởi tạo điểm
    participants.forEach((p) => {
      scoreMap.set(p.studentCode, 0);
    });

    // Tính điểm từ responses
    for (const resp of responses) {
      const activity = activities.find((a) => a._id === resp.activityId);
      if (!activity || !resp.studentCode) continue;

      const studentCode = resp.studentCode;
      let points = 0;

      if (activity.type === "poll" || activity.type === "wordcloud" || activity.type === "rating" || activity.type === "opentext") {
        // opentext dùng chung điểm với wordcloud (mỗi câu trả lời = 1 điểm)
        const key = activity.type === "opentext" ? "wordcloud" : activity.type;
        points = config[key as keyof typeof config] || 1;
      } else if (activity.type === "qa") {
        const value = typeof resp.value === "object" ? resp.value : {};
        // Điểm khi đặt câu hỏi
        if (value.text) {
          points = config.qa;
        }
        // Điểm từ upvote (nếu có)
        const upvotes = value.upvotes || 0;
        points += upvotes * config.qaUpvote;
      }

      const current = scoreMap.get(studentCode) || 0;
      scoreMap.set(studentCode, current + points);
    }

    // Tính điểm từ Board posts
    for (const post of boardPosts) {
      if (!post.studentCode) continue;
      const current = scoreMap.get(post.studentCode) || 0;
      scoreMap.set(post.studentCode, current + config.board);
    }

    // Tạo danh sách kết quả
    const allParticipants = participants
      .map((p) => ({
        studentCode: p.studentCode,
        fullName: p.fullName,
        className: p.className,
        score: scoreMap.get(p.studentCode) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const leaderboard = allParticipants
      .slice(0, 10)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
      }));

    const totalParticipants = participants.length;
    const participantsWithScore = allParticipants.filter(p => p.score > 0).length;

    return {
      leaderboard,
      totalParticipants,
      participantsWithScore,
    };
  },
});
