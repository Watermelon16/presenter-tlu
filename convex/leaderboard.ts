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
  args: {
    sessionId: v.id("sessions"),
    run: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];

    const config = session.scoringConfig ?? DEFAULT_SCORING;
    const targetRun = args.run ?? session.currentRun ?? 1;

    const participantsRaw = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const participants = participantsRaw.filter((p) => (p.run ?? 1) === targetRun);

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const responses = allResponses.filter((r) => (r.run ?? 1) === targetRun);

    const allBoardPosts = await ctx.db
      .query("boardPosts")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .collect();
    const boardPosts = allBoardPosts.filter((p) => (p.run ?? 1) === targetRun);

    const scoreMap = new Map<string, number>();
    // Tổng và đếm thời gian phản hồi để tính TB (ms)
    const responseTimeSum = new Map<string, number>();
    const responseTimeCount = new Map<string, number>();
    // Lưu thời gian phản hồi nhanh nhất (ms)
    const fastestResponse = new Map<string, number>();

    // Khởi tạo điểm
    participants.forEach((p) => {
      scoreMap.set(p.studentCode, 0);
      responseTimeSum.set(p.studentCode, 0);
      responseTimeCount.set(p.studentCode, 0);
    });

    // CHỈ tính điểm cho activities có requiresStudentCode=true (giảng viên bật ghi nhận điểm)
    const scoringActivityIds = new Set(
      activities.filter((a) => a.requiresStudentCode).map((a) => a._id)
    );

    // Helper: bonus tốc độ (0–50% điểm gốc) — trả lời càng sớm sau khi mở activity càng nhiều bonus
    const computeSpeedBonus = (basePoints: number, activity: any, submittedAt?: number) => {
      if (!activity.startedAt || !submittedAt || !activity.timeLimit) return 0;
      const elapsed = submittedAt - activity.startedAt;
      const total = activity.timeLimit * 60 * 1000;
      if (elapsed <= 0 || total <= 0) return 0;
      // Tỷ lệ thời gian còn lại × 50% điểm gốc, làm tròn 0.1
      const remainingRatio = Math.max(0, 1 - elapsed / total);
      return Math.round(basePoints * remainingRatio * 0.5 * 10) / 10;
    };

    // Tính điểm từ responses
    for (const resp of responses) {
      const activity = activities.find((a) => a._id === resp.activityId);
      if (!activity || !resp.studentCode) continue;
      if (!scoringActivityIds.has(activity._id)) continue; // bỏ qua activity ẩn danh
      if (resp.status !== "answered") continue; // bỏ qua "no_response"

      const studentCode = resp.studentCode;
      let basePoints = 0;

      if (activity.type === "poll" || activity.type === "wordcloud" || activity.type === "rating" || activity.type === "opentext") {
        const key = activity.type === "opentext" ? "wordcloud" : activity.type;
        basePoints = config[key as keyof typeof config] || 1;
      } else if (activity.type === "qa") {
        const value = typeof resp.value === "object" ? resp.value : {};
        if (value.text) basePoints = config.qa;
        const upvotes = value.upvotes || 0;
        basePoints += upvotes * config.qaUpvote;
      }

      // Bonus quiz: trả lời đúng được +50% điểm
      if (activity.type === "poll" && activity.config?.isQuiz && Array.isArray(activity.config?.correctOptionIds)) {
        const correctIds: string[] = activity.config.correctOptionIds;
        const chosen = (resp.value as { choiceIds?: string[] })?.choiceIds || [];
        const correctSet = new Set(correctIds);
        const chosenSet = new Set(chosen);
        const isCorrect = chosenSet.size === correctSet.size && [...chosenSet].every((id) => correctSet.has(id));
        if (isCorrect) {
          basePoints += Math.round(basePoints * 0.5 * 10) / 10;
        }
      }

      const speedBonus = computeSpeedBonus(basePoints, activity, resp.submittedAt);
      const total = basePoints + speedBonus;

      const current = scoreMap.get(studentCode) || 0;
      scoreMap.set(studentCode, current + total);

      // Tính thời gian phản hồi (ms) — từ lúc activity bắt đầu đến lúc SV submit
      if (activity.startedAt && resp.submittedAt) {
        const elapsedMs = resp.submittedAt - activity.startedAt;
        if (elapsedMs > 0) {
          responseTimeSum.set(studentCode, (responseTimeSum.get(studentCode) || 0) + elapsedMs);
          responseTimeCount.set(studentCode, (responseTimeCount.get(studentCode) || 0) + 1);
          const prevFastest = fastestResponse.get(studentCode);
          if (prevFastest === undefined || elapsedMs < prevFastest) {
            fastestResponse.set(studentCode, elapsedMs);
          }
        }
      }
    }

    // Tính điểm từ Board posts — chỉ cho board activity có requiresStudentCode
    for (const post of boardPosts) {
      if (!post.studentCode) continue;
      const activity = activities.find((a) => a._id === post.activityId);
      if (!activity || !scoringActivityIds.has(activity._id)) continue;
      const current = scoreMap.get(post.studentCode) || 0;
      scoreMap.set(post.studentCode, current + config.board);
    }

    // Tạo danh sách kết quả
    const allParticipants = participants
      .map((p) => {
        const count = responseTimeCount.get(p.studentCode) || 0;
        const sum = responseTimeSum.get(p.studentCode) || 0;
        const avgMs = count > 0 ? Math.round(sum / count) : null;
        const fastestMs = fastestResponse.get(p.studentCode) ?? null;
        return {
          studentCode: p.studentCode,
          fullName: p.fullName,
          className: p.className,
          score: Math.round((scoreMap.get(p.studentCode) || 0) * 10) / 10,
          answeredCount: count,
          avgResponseMs: avgMs,
          fastestResponseMs: fastestMs,
          flagged: !!p.flagged,
          flagReason: p.flagReason,
        };
      })
      .sort((a, b) => {
        // Sort theo điểm giảm dần, tie-break theo avgResponseMs tăng dần (nhanh hơn = cao hơn)
        if (b.score !== a.score) return b.score - a.score;
        if (a.avgResponseMs === null) return 1;
        if (b.avgResponseMs === null) return -1;
        return a.avgResponseMs - b.avgResponseMs;
      });

    const leaderboard = allParticipants
      .slice(0, 10)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
      }));

    const totalParticipants = participants.length;
    const participantsWithScore = allParticipants.filter(p => p.score > 0).length;
    const flaggedCount = allParticipants.filter(p => p.flagged).length;

    return {
      leaderboard,
      totalParticipants,
      participantsWithScore,
      flaggedCount,
    };
  },
});
