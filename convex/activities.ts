import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { api } from "./_generated/api";

// Tạo một hoạt động mới (bắt đầu với Poll)
export const createActivity = mutation({
  args: {
    sessionId: v.id("sessions"),
    type: v.union(v.literal("poll"), v.literal("wordcloud"), v.literal("rating"), v.literal("board"), v.literal("qa")),
    title: v.string(),
    config: v.any(),
    requiresStudentCode: v.boolean(),
    timeLimit: v.optional(v.number()), // phút, cho phép số thập phân
    order: v.number(),
    slideCue: v.optional(v.string()), // Mốc slide PowerPoint (tùy chọn)
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    // Nếu hoạt động yêu cầu mã sinh viên thì session phải bật thu thập (treat missing as false)
    const sessionCollectsCode = session.collectStudentCode ?? false;
    if (args.requiresStudentCode && !sessionCollectsCode) {
      throw new Error("Buổi giảng chưa bật thu thập mã sinh viên");
    }

    const activityId = await ctx.db.insert("activities", {
      sessionId: args.sessionId,
      type: args.type,
      title: args.title.trim(),
      config: args.config,
      requiresStudentCode: args.requiresStudentCode,
      timeLimit: args.timeLimit,
      status: "draft",
      order: args.order,
      slideCue: args.slideCue?.trim() || undefined,
      createdAt: Date.now(),
    });

    return activityId;
  },
});

// Lấy danh sách hoạt động của một buổi
export const listActivities = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

// Bắt đầu một hoạt động (chuyển sang active)
export const startActivity = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) throw new Error("Không tìm thấy hoạt động");

    const now = Date.now();

    await ctx.db.patch(args.activityId, {
      status: "active",
      startedAt: now,
    });

    // Nếu có timeLimit → lên lịch tự động đóng
    if (activity.timeLimit && activity.timeLimit > 0) {
      const delayMs = Math.round(activity.timeLimit * 60 * 1000); // phút → mili giây

      await ctx.scheduler.runAfter(
        delayMs,
        internal.activities.internalExpireActivity,
        { activityId: args.activityId }
      );
    }

    return true;
  },
});

// Internal function: Tự động hết giờ và tạo "Không trả lời"
export const internalExpireActivity = internalMutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity || activity.status !== "active") return;

    // Đóng hoạt động
    await ctx.db.patch(args.activityId, {
      status: "expired",
      closedAt: Date.now(),
    });

    // Nếu hoạt động yêu cầu mã sinh viên → tự động tạo bản ghi "Không trả lời"
    if (activity.requiresStudentCode) {
      await ctx.runMutation(api.responses.createNoResponseRecords, {
        activityId: args.activityId,
      });
    }
  },
});

// Đóng hoạt động (thủ công bởi giảng viên)
export const closeActivity = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return;

    await ctx.db.patch(args.activityId, {
      status: "closed",
      closedAt: Date.now(),
    });

    // Nếu hoạt động yêu cầu mã sinh viên → vẫn tạo no_response cho những người chưa trả lời
    if (activity.requiresStudentCode) {
      await ctx.runMutation(api.responses.createNoResponseRecords, {
        activityId: args.activityId,
      });
    }
  },
});

// Lấy hoạt động đang active của session (nếu có)
export const getActiveActivity = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
  },
});

// Di chuyển hoạt động lên trên
export const moveActivityUp = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return;

    const previous = await ctx.db
      .query("activities")
      .withIndex("by_session_and_order", (q) =>
        q.eq("sessionId", activity.sessionId).lt("order", activity.order)
      )
      .order("desc")
      .first();

    if (!previous) return; // already at top

    // Swap orders
    await ctx.db.patch(activity._id, { order: previous.order });
    await ctx.db.patch(previous._id, { order: activity.order });
  },
});

// Di chuyển hoạt động xuống dưới
export const moveActivityDown = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return;

    const next = await ctx.db
      .query("activities")
      .withIndex("by_session_and_order", (q) =>
        q.eq("sessionId", activity.sessionId).gt("order", activity.order)
      )
      .order("asc")
      .first();

    if (!next) return; // already at bottom

    // Swap orders
    await ctx.db.patch(activity._id, { order: next.order });
    await ctx.db.patch(next._id, { order: activity.order });
  },
});

// Cập nhật lại toàn bộ thứ tự hoạt động (dùng cho kéo thả)
export const reorderActivities = mutation({
  args: {
    sessionId: v.id("sessions"),
    orderedActivityIds: v.array(v.id("activities")),
  },
  handler: async (ctx, args) => {
    const { sessionId, orderedActivityIds } = args;

    // Lấy tất cả hoạt động của session để verify
    const existing = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();

    const existingIds = new Set(existing.map((a) => a._id));

    // Chỉ giữ những id hợp lệ và thuộc session này
    const validIds = orderedActivityIds.filter((id) => existingIds.has(id));

    // Gán lại order từ 1..n theo thứ tự mới
    for (let i = 0; i < validIds.length; i++) {
      await ctx.db.patch(validIds[i], { order: i + 1 });
    }
  },
});

// Tạo bản sao hoạt động (dùng để "Làm lại" hoạt động đã đóng/hết giờ)
export const duplicateActivity = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const original = await ctx.db.get(args.activityId);
    if (!original) {
      throw new Error("Không tìm thấy hoạt động gốc");
    }

    // Tìm order lớn nhất hiện tại trong session để đặt activity mới ở cuối
    const activitiesInSession = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", original.sessionId))
      .collect();

    const maxOrder = activitiesInSession.length > 0 
      ? Math.max(...activitiesInSession.map(a => a.order)) 
      : 0;

    const newActivityId = await ctx.db.insert("activities", {
      sessionId: original.sessionId,
      type: original.type,
      title: original.title,
      config: original.config,
      requiresStudentCode: original.requiresStudentCode,
      timeLimit: original.timeLimit,
      slideCue: original.slideCue,
      status: "draft",
      order: maxOrder + 1,
      createdAt: Date.now(),
    });

    return newActivityId;
  },
});

// Cập nhật hoạt động (chỉ cho phép khi chưa active)
export const updateActivity = mutation({
  args: {
    activityId: v.id("activities"),
    title: v.optional(v.string()),
    config: v.optional(v.any()),
    requiresStudentCode: v.optional(v.boolean()),
    timeLimit: v.optional(v.number()),
    slideCue: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) throw new Error("Không tìm thấy hoạt động");

    if (activity.status === "active") {
      throw new Error("Không thể sửa hoạt động đang diễn ra");
    }

    const patch: any = {};
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.config !== undefined) patch.config = args.config;
    if (args.requiresStudentCode !== undefined) patch.requiresStudentCode = args.requiresStudentCode;
    if (args.timeLimit !== undefined) patch.timeLimit = args.timeLimit;
    if (args.slideCue !== undefined) patch.slideCue = args.slideCue?.trim() || undefined;

    await ctx.db.patch(args.activityId, patch);
    return true;
  },
});

// Xóa hoạt động (chỉ cho phép khi không active)
export const deleteActivity = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return;

    if (activity.status === "active") {
      throw new Error("Không thể xóa hoạt động đang diễn ra");
    }

    // Xóa tất cả responses liên quan trước
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();

    for (const r of responses) {
      await ctx.db.delete(r._id);
    }

    await ctx.db.delete(args.activityId);
  },
});

// ============================================================
// SCRIPT RUNNER (Kịch bản) - Lõi cho "B: Liền mạch PowerPoint"
// ============================================================

/**
 * Lấy danh sách hoạt động đã sắp xếp theo order (dùng nội bộ cho script)
 */
async function getSortedActivities(ctx: any, sessionId: any) {
  const acts = await ctx.db
    .query("activities")
    .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
    .collect();

  return acts.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * Bắt đầu / tiếp tục kịch bản từ vị trí hiện tại (hoặc 0)
 */
export const startScriptRunner = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    const sorted = await getSortedActivities(ctx, args.sessionId);
    if (sorted.length === 0) {
      throw new Error("Chưa có hoạt động nào trong kịch bản");
    }

    const pos = session.currentScriptPosition ?? 0;
    const clamped = Math.min(Math.max(pos, 0), sorted.length - 1);

    await ctx.db.patch(args.sessionId, {
      isScriptRunning: true,
      currentScriptPosition: clamped,
    });

    return { started: true, position: clamped, total: sorted.length };
  },
});

/**
 * Dừng kịch bản (không ảnh hưởng hoạt động đang chạy)
 */
export const stopScriptRunner = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: false,
    });
  },
});

/**
 * Chuyển đến vị trí cụ thể trong kịch bản (dùng cho click filmstrip hoặc companion)
 * Tự động đóng activity cũ, start activity mới, cập nhật vị trí
 */
export const jumpToScriptPosition = mutation({
  args: {
    sessionId: v.id("sessions"),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    const sorted = await getSortedActivities(ctx, args.sessionId);
    if (sorted.length === 0) throw new Error("Kịch bản trống");

    const targetPos = Math.max(0, Math.min(args.position, sorted.length - 1));
    const targetActivity = sorted[targetPos];

    // Đóng activity đang active (nếu có)
    const currentActive = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (currentActive) {
      await ctx.db.patch(currentActive._id, {
        status: "closed",
        closedAt: Date.now(),
      });
    }

    // Start hoạt động mục tiêu
    if (targetActivity.status !== "active") {
      const now = Date.now();
      await ctx.db.patch(targetActivity._id, {
        status: "active",
        startedAt: now,
      });

      // Scheduler expire nếu có timeLimit
      if (targetActivity.timeLimit && targetActivity.timeLimit > 0) {
        const delayMs = Math.round(targetActivity.timeLimit * 60 * 1000);
        await ctx.scheduler.runAfter(
          delayMs,
          internal.activities.internalExpireActivity,
          { activityId: targetActivity._id }
        );
      }
    }

    // Cập nhật vị trí script
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: true,
      currentScriptPosition: targetPos,
    });

    return { position: targetPos, activityId: targetActivity._id };
  },
});

/**
 * TIẾP THEO trong kịch bản - hàm cốt lõi cho nút "TIẾP THEO" và phím Space
 * Đây là hàm giúp lecturer chỉ cần bấm 1 nút là:
 *  - Đóng hoạt động cũ
 *  - Bật hoạt động kế tiếp
 *  - Cập nhật vị trí script (để companion + mọi view đều thấy)
 *  - Gợi ý slide cue mạnh
 */
export const advanceInScript = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    const sorted = await getSortedActivities(ctx, args.sessionId);
    if (sorted.length === 0) throw new Error("Kịch bản trống");

    const currentPos = session.currentScriptPosition ?? 0;
    const nextPos = Math.min(currentPos + 1, sorted.length - 1);

    // Nếu đã ở cuối thì không làm gì
    if (nextPos === currentPos) {
      return { position: currentPos, atEnd: true };
    }

    const nextActivity = sorted[nextPos];

    // Đóng activity đang active
    const currentActive = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (currentActive) {
      await ctx.db.patch(currentActive._id, {
        status: "closed",
        closedAt: Date.now(),
      });
    }

    // Kích hoạt hoạt động tiếp theo
    if (nextActivity.status !== "active") {
      const now = Date.now();
      await ctx.db.patch(nextActivity._id, {
        status: "active",
        startedAt: now,
      });

      if (nextActivity.timeLimit && nextActivity.timeLimit > 0) {
        const delayMs = Math.round(nextActivity.timeLimit * 60 * 1000);
        await ctx.scheduler.runAfter(
          delayMs,
          internal.activities.internalExpireActivity,
          { activityId: nextActivity._id }
        );
      }
    }

    // Cập nhật script position trên session (realtime cho mọi client)
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: true,
      currentScriptPosition: nextPos,
    });

    return {
      position: nextPos,
      total: sorted.length,
      nextActivityId: nextActivity._id,
      nextSlideCue: nextActivity.slideCue || null,
    };
  },
});

/**
 * Lấy trạng thái script realtime (dành cho companion + presenter)
 */
export const getScriptState = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    const sorted = await getSortedActivities(ctx, args.sessionId);

    const pos = session.currentScriptPosition ?? 0;
    const clamped = sorted.length > 0 ? Math.min(pos, sorted.length - 1) : 0;

    const currentActivity = sorted[clamped] || null;
    const nextActivity = clamped < sorted.length - 1 ? sorted[clamped + 1] : null;

    return {
      isRunning: session.isScriptRunning ?? false,
      position: clamped,
      total: sorted.length,
      currentActivity,
      nextActivity,
      currentSlideCue: currentActivity?.slideCue || null,
      nextSlideCue: nextActivity?.slideCue || null,
    };
  },
});
