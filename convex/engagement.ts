// Engagement heatmap — đếm events theo phút để vẽ biểu đồ nhịp lớp.
//
// Events tính engagement:
//   - responses (mọi loại activity: poll, wordcloud, rating, qa, opentext)
//   - boardPosts
//
// Bucket theo phút kể từ T₀ (attendanceOpenAt | officialStartAt | createdAt).
// Trả về series + summary (peak / drop minutes) cho EngagementHeatmap UI.

import { v } from "convex/values";
import { query } from "./_generated/server";

export const getEngagementHeatmap = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    const currentRun = session.currentRun ?? 1;
    const startAt =
      session.attendanceOpenAt ??
      session.officialStartAt ??
      session.createdAt;

    // Lấy responses + boardPosts của phiên hiện tại
    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId)
      )
      .collect();
    const responses = allResponses.filter(
      (r) => (r.run ?? 1) === currentRun && r.status === "answered"
    );

    const allBoardPosts = await ctx.db
      .query("boardPosts")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .collect();
    const boardPosts = allBoardPosts.filter(
      (b) => (b.run ?? 1) === currentRun && b.status === "visible"
    );

    // Lấy activities để map type cho từng response
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const activityType = new Map<string, string>();
    for (const a of activities) activityType.set(a._id as unknown as string, a.type);

    type Bucket = {
      responses: number;
      boardPosts: number;
      byType: Record<string, number>;
      total: number;
    };
    const buckets = new Map<number, Bucket>();

    const minuteOf = (ts: number) => Math.floor((ts - startAt) / 60_000);

    function bucket(minute: number): Bucket {
      let b = buckets.get(minute);
      if (!b) {
        b = { responses: 0, boardPosts: 0, byType: {}, total: 0 };
        buckets.set(minute, b);
      }
      return b;
    }

    for (const r of responses) {
      const m = minuteOf(r.submittedAt);
      if (m < 0) continue;
      const b = bucket(m);
      b.responses++;
      b.total++;
      const t = activityType.get(r.activityId as unknown as string) ?? "other";
      b.byType[t] = (b.byType[t] ?? 0) + 1;
    }

    for (const p of boardPosts) {
      const m = minuteOf(p.createdAt);
      if (m < 0) continue;
      const b = bucket(m);
      b.boardPosts++;
      b.total++;
      b.byType.board = (b.byType.board ?? 0) + 1;
    }

    const endAt = session.endedAt ?? Date.now();
    const maxMin = Math.max(0, Math.floor((endAt - startAt) / 60_000));

    // Dày đặc series — fill 0 cho phút không có engagement
    const series: Array<{
      minute: number;
      timestamp: number;
      responses: number;
      boardPosts: number;
      total: number;
      byType: Record<string, number>;
    }> = [];
    for (let i = 0; i <= maxMin; i++) {
      const b = buckets.get(i) ?? { responses: 0, boardPosts: 0, byType: {}, total: 0 };
      series.push({
        minute: i,
        timestamp: startAt + i * 60_000,
        responses: b.responses,
        boardPosts: b.boardPosts,
        total: b.total,
        byType: b.byType,
      });
    }

    // Tính peak + drop
    let peakIdx = 0;
    let peakCount = 0;
    let totalEngagement = 0;
    for (let i = 0; i < series.length; i++) {
      totalEngagement += series[i].total;
      if (series[i].total > peakCount) {
        peakCount = series[i].total;
        peakIdx = i;
      }
    }

    // Drop: phút có 0 hoạt động dài liên tiếp nhất (>=3 phút)
    let longestDropStart = -1;
    let longestDropLen = 0;
    let curStart = -1;
    let curLen = 0;
    for (let i = 0; i < series.length; i++) {
      if (series[i].total === 0) {
        if (curStart < 0) curStart = i;
        curLen++;
      } else {
        if (curLen > longestDropLen) {
          longestDropStart = curStart;
          longestDropLen = curLen;
        }
        curStart = -1;
        curLen = 0;
      }
    }
    if (curLen > longestDropLen) {
      longestDropStart = curStart;
      longestDropLen = curLen;
    }

    return {
      startAt,
      endAt: session.endedAt ?? null,
      now: Date.now(),
      currentRun,
      series,
      summary: {
        totalEngagement,
        peakMinute: series.length > 0 ? peakIdx : null,
        peakAt: series.length > 0 ? series[peakIdx].timestamp : null,
        peakCount,
        longestDropStartMinute: longestDropLen >= 3 ? longestDropStart : null,
        longestDropLen: longestDropLen >= 3 ? longestDropLen : 0,
      },
    };
  },
});
