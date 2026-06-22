// Snapshot dữ liệu buổi giảng để AI tóm tắt (engagement + responses + Q&A).
// Cung cấp 2 query:
//   - internal: getSessionSnapshot — gọi từ action runQuery (legacy ai.ts).
//   - public: getSessionSnapshotForOwner — gọi từ client (AI client-side mode),
//     auth check để chỉ owner đọc được.

import { v } from "convex/values";
import { internalQuery, query, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

async function buildSnapshot(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session) return null;

  const currentRun = session.currentRun ?? 1;

  const activities = await ctx.db
    .query("activities")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const responses = await ctx.db
    .query("responses")
    .withIndex("by_session_and_student", (q) => q.eq("sessionId", sessionId))
    .collect();
  const boardPosts = await ctx.db
    .query("boardPosts")
    .filter((q) => q.eq(q.field("sessionId"), sessionId))
    .collect();
  const participants = await ctx.db
    .query("participants")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();

  const r = responses.filter((x) => (x.run ?? 1) === currentRun);
  const b = boardPosts.filter((x) => (x.run ?? 1) === currentRun && x.status === "visible");
  const p = participants.filter((x) => (x.run ?? 1) === currentRun);

  type Activity = (typeof activities)[number];
  type Response = (typeof r)[number];
  const responsesByActivity = new Map<string, Response[]>();
  for (const resp of r) {
    const key = resp.activityId as unknown as string;
    const list = responsesByActivity.get(key) ?? [];
    list.push(resp);
    responsesByActivity.set(key, list);
  }

  const activitySummaries = activities
    .filter((a) => a.status === "closed" || a.status === "active" || a.status === "expired")
    .sort((x, y) => x.order - y.order)
    .map((a: Activity) => {
      const resps = responsesByActivity.get(a._id as unknown as string) ?? [];
      const cfg = (a.config ?? {}) as {
        options?: Array<{ id: string; text: string }>;
        isQuiz?: boolean;
        correctOptionIds?: string[];
        min?: number;
        max?: number;
      };

      let detail: Record<string, unknown> = {};
      if (a.type === "poll") {
        const optMap = new Map<string, { text: string; count: number }>();
        for (const opt of cfg.options ?? []) optMap.set(opt.id, { text: opt.text, count: 0 });
        for (const resp of resps) {
          // Poll lưu { choiceIds: [...] } (legacy: selectedOptions). Đọc cả hai.
          const v = resp.value as { choiceIds?: string[]; selectedOptions?: string[] } | undefined;
          for (const id of v?.choiceIds ?? v?.selectedOptions ?? []) {
            const o = optMap.get(id);
            if (o) o.count++;
          }
        }
        detail = {
          isQuiz: !!cfg.isQuiz,
          correctOptionIds: cfg.correctOptionIds ?? [],
          options: Array.from(optMap.entries()).map(([id, o]) => ({
            id, text: o.text, count: o.count,
            isCorrect: (cfg.correctOptionIds ?? []).includes(id),
          })),
        };
      } else if (a.type === "wordcloud" || a.type === "opentext") {
        detail = {
          answers: resps
            .map((x) => (typeof x.value === "string" ? x.value : (x.value as { text?: string })?.text ?? ""))
            .filter(Boolean)
            .slice(0, 50),
        };
      } else if (a.type === "rating") {
        const ratings = resps.map((x) => Number((x.value as { rating?: number })?.rating) || 0).filter((n) => n > 0);
        const avg = ratings.length > 0 ? ratings.reduce((s, n) => s + n, 0) / ratings.length : 0;
        detail = { count: ratings.length, average: Math.round(avg * 10) / 10, min: cfg.min ?? 1, max: cfg.max ?? 5 };
      } else if (a.type === "qa") {
        const qs = resps
          .map((x) => x.value as { question?: string; answer?: string; isAnswered?: boolean; upvotes?: number })
          .filter((v) => v?.question)
          .slice(0, 30);
        detail = { questions: qs };
      }

      return {
        id: a._id,
        type: a.type,
        title: a.title,
        order: a.order,
        slideCue: a.slideCue ?? null,
        status: a.status,
        responseCount: resps.length,
        detail,
      };
    });

  const boardSummary = b.slice(0, 50).map((post) => ({
    content: post.content.slice(0, 300),
    column: post.columnId,
    likes: post.likes,
  }));

  return {
    sessionTitle: session.title,
    className: session.className ?? null,
    participantCount: p.length,
    attendanceCounts: {
      present: p.filter((x) => x.attendanceStatus === "present").length,
      late: p.filter((x) => x.attendanceStatus === "late").length,
      absent: p.filter((x) => x.attendanceStatus === "absent").length,
      excused: p.filter((x) => x.attendanceStatus === "excused").length,
    },
    activities: activitySummaries,
    board: boardSummary,
  };
}

export const getSessionSnapshot = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => buildSnapshot(ctx, args.sessionId),
});

export const getSessionSnapshotForOwner = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    if (session.ownerUserId && session.ownerUserId !== userId) {
      const profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (profile?.role !== "admin") return null;
    }
    return buildSnapshot(ctx, args.sessionId);
  },
});
