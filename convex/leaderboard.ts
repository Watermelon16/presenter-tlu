import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Default scoring (công bằng cho sinh viên đại học)
const DEFAULT_SCORING = {
  poll: 1,
  wordcloud: 1,
  rating: 1,
  board: 2,
  qa: 2,
  qaUpvote: 1,
};

type ScoringConfig = typeof DEFAULT_SCORING;

type ScoredParticipant = {
  studentCode: string;
  fullName: string;
  className: string;
  score: number;
  answeredCount: number;
  avgResponseMs: number | null;
  fastestResponseMs: number | null;
  flagged: boolean;
  flagReason?: string;
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

/**
 * Helper: tính điểm + thống kê cho TẤT CẢ participants trong 1 (session, run).
 * Đã sort theo điểm giảm dần, tie-break theo avgResponseMs tăng dần.
 *
 * Dùng cho: bảng thành tích trong buổi, lịch sử xuyên buổi (per session rank).
 */
async function computeSessionRunScores(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  run: number,
  config: ScoringConfig
): Promise<ScoredParticipant[]> {
  const participantsRaw = await ctx.db
    .query("participants")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const participants = participantsRaw.filter((p) => (p.run ?? 1) === run);

  const activities = await ctx.db
    .query("activities")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();

  const allResponses = await ctx.db
    .query("responses")
    .withIndex("by_session_and_student", (q) => q.eq("sessionId", sessionId))
    .collect();
  const responses = allResponses.filter((r) => (r.run ?? 1) === run);

  const allBoardPosts = await ctx.db
    .query("boardPosts")
    .filter((q) => q.eq(q.field("sessionId"), sessionId))
    .collect();
  const boardPosts = allBoardPosts.filter((p) => (p.run ?? 1) === run);

  const scoreMap = new Map<string, number>();
  const responseTimeSum = new Map<string, number>();
  const responseTimeCount = new Map<string, number>();
  const fastestResponse = new Map<string, number>();

  participants.forEach((p) => {
    scoreMap.set(p.studentCode, 0);
    responseTimeSum.set(p.studentCode, 0);
    responseTimeCount.set(p.studentCode, 0);
  });

  const scoringActivityIds = new Set(
    activities.filter((a) => a.requiresStudentCode).map((a) => a._id)
  );

  const computeSpeedBonus = (
    basePoints: number,
    activity: Doc<"activities">,
    submittedAt?: number
  ) => {
    if (!activity.startedAt || !submittedAt || !activity.timeLimit) return 0;
    const elapsed = submittedAt - activity.startedAt;
    const total = activity.timeLimit * 60 * 1000;
    if (elapsed <= 0 || total <= 0) return 0;
    const remainingRatio = Math.max(0, 1 - elapsed / total);
    return Math.round(basePoints * remainingRatio * 0.5 * 10) / 10;
  };

  for (const resp of responses) {
    const activity = activities.find((a) => a._id === resp.activityId);
    if (!activity || !resp.studentCode) continue;
    if (!scoringActivityIds.has(activity._id)) continue;
    if (resp.status !== "answered") continue;

    const studentCode = resp.studentCode;
    let basePoints = 0;

    if (
      activity.type === "poll" ||
      activity.type === "wordcloud" ||
      activity.type === "rating" ||
      activity.type === "opentext"
    ) {
      const key = activity.type === "opentext" ? "wordcloud" : activity.type;
      basePoints = config[key as keyof ScoringConfig] || 1;
    } else if (activity.type === "qa") {
      const value = typeof resp.value === "object" ? resp.value : {};
      if (value.text) basePoints = config.qa;
      const upvotes = value.upvotes || 0;
      basePoints += upvotes * config.qaUpvote;
    }

    if (
      activity.type === "poll" &&
      activity.config?.isQuiz &&
      Array.isArray(activity.config?.correctOptionIds)
    ) {
      const correctIds: string[] = activity.config.correctOptionIds;
      const chosen = (resp.value as { choiceIds?: string[] })?.choiceIds || [];
      const correctSet = new Set(correctIds);
      const chosenSet = new Set(chosen);
      const isCorrect =
        chosenSet.size === correctSet.size &&
        [...chosenSet].every((id) => correctSet.has(id));
      if (isCorrect) {
        basePoints += Math.round(basePoints * 0.5 * 10) / 10;
      }
    }

    const speedBonus = computeSpeedBonus(basePoints, activity, resp.submittedAt);
    const total = basePoints + speedBonus;

    const current = scoreMap.get(studentCode) || 0;
    scoreMap.set(studentCode, current + total);

    if (activity.startedAt && resp.submittedAt) {
      const elapsedMs = resp.submittedAt - activity.startedAt;
      if (elapsedMs > 0) {
        responseTimeSum.set(
          studentCode,
          (responseTimeSum.get(studentCode) || 0) + elapsedMs
        );
        responseTimeCount.set(
          studentCode,
          (responseTimeCount.get(studentCode) || 0) + 1
        );
        const prevFastest = fastestResponse.get(studentCode);
        if (prevFastest === undefined || elapsedMs < prevFastest) {
          fastestResponse.set(studentCode, elapsedMs);
        }
      }
    }
  }

  for (const post of boardPosts) {
    if (!post.studentCode) continue;
    const activity = activities.find((a) => a._id === post.activityId);
    if (!activity || !scoringActivityIds.has(activity._id)) continue;
    const current = scoreMap.get(post.studentCode) || 0;
    scoreMap.set(post.studentCode, current + config.board);
  }

  return participants
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
      if (b.score !== a.score) return b.score - a.score;
      if (a.avgResponseMs === null) return 1;
      if (b.avgResponseMs === null) return -1;
      return a.avgResponseMs - b.avgResponseMs;
    });
}

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

    const allParticipants = await computeSessionRunScores(
      ctx,
      args.sessionId,
      targetRun,
      config
    );

    const leaderboard = allParticipants
      .slice(0, 10)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
      }));

    const totalParticipants = allParticipants.length;
    const participantsWithScore = allParticipants.filter((p) => p.score > 0).length;
    const flaggedCount = allParticipants.filter((p) => p.flagged).length;

    return {
      leaderboard,
      totalParticipants,
      participantsWithScore,
      flaggedCount,
    };
  },
});

/**
 * Lịch sử thành tích của một sinh viên xuyên các buổi.
 *
 * Trả về:
 * - sessions: list các (session, run) SV đã tham gia, kèm điểm + rank trong buổi đó
 * - aggregate: tổng điểm, số buổi, số phiên, top medal counts
 *
 * Lưu ý hiệu năng: với SV tham gia rất nhiều buổi (>50), query này sẽ chạy
 * leaderboard cho từng (session, run). Chấp nhận được cho 1 trường ĐH cá nhân.
 */
export const getStudentHistory = query({
  args: {
    studentCode: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const studentCode = args.studentCode.trim();
    if (!studentCode) {
      return {
        studentCode: "",
        fullName: null,
        className: null,
        sessions: [],
        aggregate: {
          totalScore: 0,
          sessionCount: 0,
          runCount: 0,
          answeredTotal: 0,
          goldCount: 0,
          silverCount: 0,
          bronzeCount: 0,
          topTenCount: 0,
        },
      };
    }

    // Lấy tất cả participants của SV này (mọi session, mọi run)
    const myParticipants = await ctx.db
      .query("participants")
      .withIndex("by_student", (q) => q.eq("studentCode", studentCode))
      .collect();

    if (myParticipants.length === 0) {
      return {
        studentCode,
        fullName: null,
        className: null,
        sessions: [],
        aggregate: {
          totalScore: 0,
          sessionCount: 0,
          runCount: 0,
          answeredTotal: 0,
          goldCount: 0,
          silverCount: 0,
          bronzeCount: 0,
          topTenCount: 0,
        },
      };
    }

    // Lấy thông tin SV mới nhất (tên + lớp) — dùng participant join gần nhất
    const latest = [...myParticipants].sort((a, b) => b.joinedAt - a.joinedAt)[0];

    // Group by (sessionId, run) — mỗi cặp = 1 mục trong lịch sử
    type RunKey = string; // `${sessionId}::${run}`
    const runEntries = new Map<RunKey, { sessionId: Id<"sessions">; run: number; joinedAt: number }>();
    for (const p of myParticipants) {
      const run = p.run ?? 1;
      const key = `${p.sessionId}::${run}`;
      const existing = runEntries.get(key);
      if (!existing || p.joinedAt > existing.joinedAt) {
        runEntries.set(key, { sessionId: p.sessionId, run, joinedAt: p.joinedAt });
      }
    }

    // Sort theo joinedAt desc, áp dụng limit (default 30)
    const limit = args.limit ?? 30;
    const sortedEntries = Array.from(runEntries.values())
      .sort((a, b) => b.joinedAt - a.joinedAt)
      .slice(0, limit);

    // Cache session để tránh fetch trùng
    const sessionCache = new Map<string, Doc<"sessions"> | null>();
    const getSession = async (id: Id<"sessions">) => {
      const key = id as unknown as string;
      if (sessionCache.has(key)) return sessionCache.get(key)!;
      const s = await ctx.db.get(id);
      sessionCache.set(key, s);
      return s;
    };

    const sessions = [];
    let totalScore = 0;
    let answeredTotal = 0;
    let goldCount = 0;
    let silverCount = 0;
    let bronzeCount = 0;
    let topTenCount = 0;

    for (const entry of sortedEntries) {
      const session = await getSession(entry.sessionId);
      if (!session) continue;

      const config = session.scoringConfig ?? DEFAULT_SCORING;
      const scored = await computeSessionRunScores(
        ctx,
        entry.sessionId,
        entry.run,
        config
      );

      const myIndex = scored.findIndex((s) => s.studentCode === studentCode);
      if (myIndex < 0) continue; // không tìm thấy — skip

      const me = scored[myIndex];
      const rank = myIndex + 1;
      const totalParticipants = scored.length;
      const participantsWithScore = scored.filter((s) => s.score > 0).length;

      totalScore += me.score;
      answeredTotal += me.answeredCount;
      if (me.score > 0) {
        if (rank === 1) goldCount++;
        else if (rank === 2) silverCount++;
        else if (rank === 3) bronzeCount++;
        if (rank <= 10) topTenCount++;
      }

      sessions.push({
        sessionId: entry.sessionId,
        sessionCode: session.code,
        sessionTitle: session.title,
        hostName: session.hostName ?? null,
        sessionStatus: session.status,
        run: entry.run,
        currentRun: session.currentRun ?? 1,
        joinedAt: entry.joinedAt,
        score: me.score,
        rank,
        totalParticipants,
        participantsWithScore,
        answeredCount: me.answeredCount,
        avgResponseMs: me.avgResponseMs,
        fastestResponseMs: me.fastestResponseMs,
        flagged: me.flagged,
      });
    }

    return {
      studentCode,
      fullName: latest.fullName,
      className: latest.className,
      sessions,
      aggregate: {
        totalScore: Math.round(totalScore * 10) / 10,
        sessionCount: new Set(sessions.map((s) => s.sessionId)).size,
        runCount: sessions.length,
        answeredTotal,
        goldCount,
        silverCount,
        bronzeCount,
        topTenCount,
      },
    };
  },
});
