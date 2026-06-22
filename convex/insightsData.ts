import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Gather toàn bộ dữ liệu cần để AI phân tích buổi giảng:
 * stats cho từng activity + leaderboard summary + samples.
 *
 * Trả về structured payload, action `insights.generate` sẽ format thành prompt.
 */
export const gatherSessionInsightsData = internalQuery({
  args: {
    sessionId: v.id("sessions"),
    run: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    const targetRun = args.run ?? session.currentRun ?? 1;

    // Lấy tất cả activities theo order
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session_and_order", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    // Tất cả participants của phiên này
    const allParticipants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const participants = allParticipants.filter((p) => (p.run ?? 1) === targetRun);
    const totalParticipants = participants.length;

    // Tất cả responses của phiên này
    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const responses = allResponses.filter((r) => (r.run ?? 1) === targetRun);

    // Board posts
    const allBoardPosts = await ctx.db
      .query("boardPosts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const boardPosts = allBoardPosts.filter((p) => (p.run ?? 1) === targetRun);

    // Phân tích từng activity
    const activityStats = activities.map((activity) => {
      const aResponses = responses.filter((r) => r.activityId === activity._id);
      const answered = aResponses.filter((r) => r.status === "answered");
      const noResp = aResponses.filter((r) => r.status === "no_response");

      const baseInfo = {
        id: activity._id,
        type: activity.type,
        title: activity.title,
        slideCue: activity.slideCue ?? null,
        status: activity.status,
        timeLimit: activity.timeLimit ?? null,
        requiresStudentCode: activity.requiresStudentCode,
        answeredCount: answered.length,
        noResponseCount: noResp.length,
        // Tỷ lệ trả lời = answered / total participants
        answerRate:
          totalParticipants > 0
            ? Math.round((answered.length / totalParticipants) * 100)
            : 0,
      };

      // Per-type detail
      if (activity.type === "poll") {
        const cfg = activity.config as
          | {
              isQuiz?: boolean;
              correctOptionIds?: string[];
              options?: Array<{ id: string; text: string }>;
              pollType?: string;
            }
          | undefined;
        const options = cfg?.options ?? [];
        const correctIds = new Set(cfg?.correctOptionIds ?? []);
        const isQuiz = !!cfg?.isQuiz && correctIds.size > 0;

        // Count votes per option
        const voteCount: Record<string, number> = {};
        let correctCount = 0;
        let wrongCount = 0;
        for (const r of answered) {
          const choiceIds = (r.value as { choiceIds?: string[] })?.choiceIds ?? [];
          for (const id of choiceIds) {
            voteCount[id] = (voteCount[id] ?? 0) + 1;
          }
          if (isQuiz) {
            const chosen = new Set(choiceIds);
            const isCorrect =
              chosen.size === correctIds.size &&
              [...chosen].every((id) => correctIds.has(id));
            if (isCorrect) correctCount++;
            else wrongCount++;
          }
        }

        return {
          ...baseInfo,
          isQuiz,
          options: options.map((o) => ({
            id: o.id,
            text: o.text,
            voteCount: voteCount[o.id] ?? 0,
            isCorrect: correctIds.has(o.id),
          })),
          correctCount: isQuiz ? correctCount : null,
          wrongCount: isQuiz ? wrongCount : null,
          correctPct:
            isQuiz && answered.length > 0
              ? Math.round((correctCount / answered.length) * 100)
              : null,
        };
      }

      if (activity.type === "wordcloud") {
        // Đếm tần suất từ trả lời (case-insensitive)
        const freq: Record<string, number> = {};
        for (const r of answered) {
          const text = typeof r.value === "string" ? r.value : "";
          const norm = text.trim().toLowerCase();
          if (norm) freq[norm] = (freq[norm] ?? 0) + 1;
        }
        const sorted = Object.entries(freq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([text, count]) => ({ text, count }));
        return { ...baseInfo, topWords: sorted };
      }

      if (activity.type === "opentext") {
        const samples = answered
          .slice(0, 30)
          .map((r) =>
            typeof r.value === "string"
              ? r.value.trim()
              : String((r.value as { text?: string })?.text ?? "")
          )
          .filter(Boolean);
        return { ...baseInfo, sampleAnswers: samples };
      }

      if (activity.type === "rating") {
        const cfg = activity.config as { min?: number; max?: number } | undefined;
        const values: number[] = [];
        for (const r of answered) {
          const v = (r.value as { rating?: number })?.rating;
          if (typeof v === "number") values.push(v);
        }
        const avg = values.length > 0
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
          : null;
        return {
          ...baseInfo,
          ratingRange: { min: cfg?.min ?? 1, max: cfg?.max ?? 5 },
          avgRating: avg,
          ratingCount: values.length,
        };
      }

      if (activity.type === "qa") {
        const questions = answered
          .map((r) => {
            const v = r.value as { text?: string; upvotes?: number } | string | undefined;
            if (typeof v === "string") return { text: v, upvotes: 0 };
            return { text: v?.text ?? "", upvotes: v?.upvotes ?? 0 };
          })
          .filter((q) => q.text)
          .sort((a, b) => b.upvotes - a.upvotes)
          .slice(0, 15);
        return { ...baseInfo, topQuestions: questions };
      }

      if (activity.type === "board") {
        const posts = boardPosts.filter((p) => p.activityId === activity._id);
        return {
          ...baseInfo,
          boardPostCount: posts.length,
          topPosts: posts
            .sort((a, b) => b.likes - a.likes)
            .slice(0, 10)
            .map((p) => ({ content: p.content, likes: p.likes })),
        };
      }

      return baseInfo;
    });

    return {
      session: {
        title: session.title,
        hostName: session.hostName ?? null,
        run: targetRun,
        status: session.status,
      },
      totalParticipants,
      activityCount: activities.length,
      activeActivities: activities.filter((a) => a.status === "active").length,
      closedActivities: activities.filter(
        (a) => a.status === "closed" || a.status === "expired"
      ).length,
      activityStats,
    };
  },
});
