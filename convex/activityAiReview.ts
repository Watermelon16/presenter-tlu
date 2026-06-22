// AI nhận xét tự động cho từng hoạt động khi GV đóng activity.
//
// Flow:
//   1. GV bấm "Đóng hoạt động" → client gọi closeActivity (đã có sẵn)
//   2. Nếu bật auto-AI-review + có API key → client gọi callAiJson() qua lib/aiClient
//      (key chỉ đi trực tiếp browser → provider, không qua Convex server)
//   3. Client gọi mutation setActivityAiReview để lưu kết quả vào DB
//
// File này chỉ chứa query lấy snapshot (gom dữ liệu kết quả) + mutation lưu review.
// Prompt + parse AI nằm ở client (lib/activityReviewClient.ts) để key không lộ.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

// ---- AUTH HELPER ----
async function requireOwnerOfActivity(
  ctx: QueryCtx,
  activityId: Id<"activities">
): Promise<{ activity: Doc<"activities">; session: Doc<"sessions"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError({ message: "Cần đăng nhập" });

  const activity = await ctx.db.get(activityId);
  if (!activity) throw new ConvexError({ message: "Hoạt động không tồn tại" });

  const session = await ctx.db.get(activity.sessionId);
  if (!session) throw new ConvexError({ message: "Buổi giảng không tồn tại" });

  if (session.ownerUserId && session.ownerUserId !== userId) {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (profile?.role !== "admin") {
      throw new ConvexError({ message: "Bạn không có quyền với hoạt động này" });
    }
  }

  return { activity, session };
}

// ---- SNAPSHOT QUERY ----
// Trả về cấu trúc gọn (đã agg) để client gửi cho AI mà không phải gửi raw responses to lớn.
export type ReviewSnapshot = {
  activityId: string;
  type: "poll" | "wordcloud" | "rating" | "board" | "qa" | "opentext" | "video" | "html";
  title: string;
  config: unknown;
  totalAnswered: number;
  totalNoResponse: number;
  // Dữ liệu agg theo type
  poll?: {
    options: Array<{ label: string; count: number; isCorrect?: boolean }>;
    totalCorrect?: number;          // nếu có đáp án
  };
  wordcloud?: {
    topWords: Array<{ word: string; count: number }>;
  };
  rating?: {
    average: number;
    min: number;
    max: number;
    distribution: Record<string, number>;
  };
  opentext?: {
    samples: string[];              // tối đa 30 câu trả lời
    referenceAnswer?: string;
    aiGradeBreakdown?: { correct: number; partial: number; wrong: number; ungraded: number };
  };
  qa?: {
    questions: Array<{ text: string; upvotes: number; answered: boolean }>;
  };
  board?: {
    columns: Array<{ id: string; title: string; postCount: number }>;
    samples: Array<{ columnId: string; content: string; likes: number }>; // top 30 by like
  };
};

export const getReviewSnapshot = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args): Promise<ReviewSnapshot | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const activity = await ctx.db.get(args.activityId);
    if (!activity) return null;

    const session = await ctx.db.get(activity.sessionId);
    if (!session) return null;

    if (session.ownerUserId && session.ownerUserId !== userId) {
      const profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (profile?.role !== "admin") return null;
    }

    const currentRun = session.currentRun ?? 1;

    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    const responses = allResponses.filter((r) => (r.run ?? 1) === currentRun);
    const answered = responses.filter((r) => r.status === "answered");
    const noResponse = responses.filter((r) => r.status === "no_response");

    const base: ReviewSnapshot = {
      activityId: String(activity._id),
      type: activity.type,
      title: activity.title,
      config: activity.config,
      totalAnswered: answered.length,
      totalNoResponse: noResponse.length,
    };

    const cfg = (activity.config ?? {}) as Record<string, unknown>;

    // ----- POLL -----
    if (activity.type === "poll") {
      const options = Array.isArray(cfg.options) ? (cfg.options as Array<Record<string, unknown>>) : [];
      const correctIds = new Set(
        Array.isArray(cfg.correctOptionIds)
          ? (cfg.correctOptionIds as unknown[]).map((x) => String(x))
          : []
      );
      // Đếm mỗi option
      const counts = new Map<string, number>();
      for (const r of answered) {
        // value có thể là string id hoặc { optionId }
        let id: string | null = null;
        if (typeof r.value === "string") id = r.value;
        else if (r.value && typeof r.value === "object") {
          const v2 = r.value as { optionId?: unknown };
          if (typeof v2.optionId === "string") id = v2.optionId;
        }
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      }
      let totalCorrect = 0;
      const outOptions = options.map((o) => {
        const id = String(o.id ?? "");
        const count = counts.get(id) || 0;
        const isCorrect = correctIds.has(id);
        if (isCorrect) totalCorrect += count;
        return {
          label: String(o.text ?? o.label ?? ""),
          count,
          isCorrect: correctIds.size > 0 ? isCorrect : undefined,
        };
      });
      base.poll = {
        options: outOptions,
        totalCorrect: correctIds.size > 0 ? totalCorrect : undefined,
      };
    }

    // ----- WORDCLOUD -----
    if (activity.type === "wordcloud") {
      const counts = new Map<string, number>();
      for (const r of answered) {
        if (typeof r.value === "string") {
          const word = r.value.trim().toLowerCase();
          if (word) counts.set(word, (counts.get(word) || 0) + 1);
        }
      }
      base.wordcloud = {
        topWords: Array.from(counts.entries())
          .map(([word, count]) => ({ word, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 30),
      };
    }

    // ----- RATING -----
    if (activity.type === "rating") {
      const min = typeof cfg.min === "number" ? cfg.min : 1;
      const max = typeof cfg.max === "number" ? cfg.max : 5;
      const distribution: Record<string, number> = {};
      let sum = 0;
      let n = 0;
      for (const r of answered) {
        let val: number;
        if (r.value && typeof r.value === "object") {
          const v2 = r.value as { rating?: unknown };
          val = typeof v2.rating === "number" ? v2.rating : NaN;
        } else {
          val = Number(r.value);
        }
        if (isNaN(val)) continue;
        distribution[String(val)] = (distribution[String(val)] || 0) + 1;
        sum += val;
        n += 1;
      }
      base.rating = {
        average: n > 0 ? Math.round((sum / n) * 10) / 10 : 0,
        min,
        max,
        distribution,
      };
    }

    // ----- OPENTEXT -----
    if (activity.type === "opentext") {
      const samples: string[] = [];
      const grade = { correct: 0, partial: 0, wrong: 0, ungraded: 0 };
      for (const r of answered) {
        const txt = typeof r.value === "string"
          ? r.value
          : (r.value && typeof r.value === "object")
            ? String((r.value as { text?: unknown }).text ?? "")
            : "";
        if (txt.trim()) samples.push(txt.trim().slice(0, 400));
        if (r.aiGrade === "correct") grade.correct++;
        else if (r.aiGrade === "partial") grade.partial++;
        else if (r.aiGrade === "wrong") grade.wrong++;
        else grade.ungraded++;
      }
      base.opentext = {
        samples: samples.slice(0, 30),
        referenceAnswer: typeof cfg.referenceAnswer === "string" ? cfg.referenceAnswer : undefined,
        aiGradeBreakdown: grade,
      };
    }

    // ----- Q&A -----
    if (activity.type === "qa") {
      const questions: Array<{ text: string; upvotes: number; answered: boolean }> = [];
      for (const r of answered) {
        let text = "";
        let upvotes = 0;
        let isAnswered = false;
        if (typeof r.value === "string") text = r.value;
        else if (r.value && typeof r.value === "object") {
          const v2 = r.value as { text?: unknown; upvotes?: unknown; status?: unknown; answer?: unknown };
          text = String(v2.text ?? "");
          upvotes = typeof v2.upvotes === "number" ? v2.upvotes : 0;
          isAnswered = v2.status === "answered" || typeof v2.answer === "string";
        }
        if (text.trim()) {
          questions.push({ text: text.trim().slice(0, 300), upvotes, answered: isAnswered });
        }
      }
      questions.sort((a, b) => b.upvotes - a.upvotes);
      base.qa = { questions: questions.slice(0, 30) };
    }

    // ----- BOARD -----
    if (activity.type === "board") {
      const columns = Array.isArray(cfg.columns)
        ? (cfg.columns as Array<Record<string, unknown>>)
        : [];
      const allPosts = await ctx.db
        .query("boardPosts")
        .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
        .collect();
      const posts = allPosts.filter((p) => p.status === "visible" && (p.run ?? 1) === currentRun);
      const countByCol = new Map<string, number>();
      for (const p of posts) {
        countByCol.set(p.columnId, (countByCol.get(p.columnId) || 0) + 1);
      }
      base.board = {
        columns: columns.map((c) => ({
          id: String(c.id ?? ""),
          title: String(c.title ?? c.name ?? ""),
          postCount: countByCol.get(String(c.id ?? "")) || 0,
        })),
        samples: posts
          .slice()
          .sort((a, b) => b.likes - a.likes)
          .slice(0, 30)
          .map((p) => ({
            columnId: p.columnId,
            content: p.content.slice(0, 400),
            likes: p.likes,
          })),
      };
    }

    return base;
  },
});

// ---- MUTATION: lưu review ----
export const setActivityAiReview = mutation({
  args: {
    activityId: v.id("activities"),
    summary: v.string(),
    observations: v.array(v.string()),
    suggestion: v.optional(v.string()),
    provider: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const { activity, session } = await requireOwnerOfActivity(ctx, args.activityId);
    const run = session.currentRun ?? 1;

    await ctx.db.patch(activity._id, {
      aiReview: {
        summary: args.summary.trim().slice(0, 500),
        observations: args.observations.map((s) => s.trim().slice(0, 300)).filter(Boolean),
        suggestion: args.suggestion?.trim().slice(0, 400) || undefined,
        run,
        provider: args.provider,
        model: args.model,
        createdAt: Date.now(),
      },
    });
  },
});

// Xóa review (khi GV muốn gen lại)
export const clearActivityAiReview = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const { activity } = await requireOwnerOfActivity(ctx, args.activityId);
    await ctx.db.patch(activity._id, { aiReview: undefined });
  },
});
