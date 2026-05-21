import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Helpers V8 cho grading flow (action `grading.gradeOpentextResponses` gọi qua runQuery/runMutation).
 * Cũng export query/mutation public để UI dùng trực tiếp (review + override).
 */

export const getActivity = internalQuery({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.activityId);
  },
});

export const listAnsweredResponses = internalQuery({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    return all.filter((r) => r.status === "answered");
  },
});

export const applyGrade = internalMutation({
  args: {
    responseId: v.id("responses"),
    aiGrade: v.union(v.literal("correct"), v.literal("partial"), v.literal("wrong")),
    aiGradeReason: v.string(),
    aiGradeModel: v.string(),
  },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.responseId);
    if (!r) return;
    // Không override nếu GV đã manual-grade
    if (r.manualGrade) return;
    await ctx.db.patch(args.responseId, {
      aiGrade: args.aiGrade,
      aiGradeReason: args.aiGradeReason,
      aiGradeModel: args.aiGradeModel,
    });
  },
});

// ===== Public: UI review + override =====

/**
 * List opentext responses của 1 activity (kèm AI grade nếu có) — dùng cho modal review.
 */
export const listOpentextResponsesForGrading = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity || activity.type !== "opentext") return null;

    const all = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    const answered = all.filter((r) => r.status === "answered");

    // Filter run hiện tại
    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;
    const filtered = answered.filter((r) => (r.run ?? 1) === currentRun);

    return {
      activity: {
        _id: activity._id,
        title: activity.title,
        config: activity.config,
        status: activity.status,
      },
      responses: filtered.map((r) => ({
        _id: r._id,
        studentCode: r.studentCode ?? null,
        value: typeof r.value === "string" ? r.value : "",
        submittedAt: r.submittedAt,
        aiGrade: r.aiGrade ?? null,
        aiGradeReason: r.aiGradeReason ?? null,
        aiGradeModel: r.aiGradeModel ?? null,
        manualGrade: r.manualGrade ?? false,
      })),
    };
  },
});

/**
 * GV override grade thủ công cho 1 response.
 * Set manualGrade=true để action AI sau không override.
 */
export const overrideResponseGrade = mutation({
  args: {
    responseId: v.id("responses"),
    grade: v.union(
      v.literal("correct"),
      v.literal("partial"),
      v.literal("wrong"),
      v.literal("clear") // xoá grade về null
    ),
  },
  handler: async (ctx, args) => {
    if (args.grade === "clear") {
      await ctx.db.patch(args.responseId, {
        aiGrade: undefined,
        aiGradeReason: undefined,
        aiGradeModel: undefined,
        manualGrade: false,
      });
      return;
    }
    await ctx.db.patch(args.responseId, {
      aiGrade: args.grade,
      manualGrade: true,
    });
  },
});
