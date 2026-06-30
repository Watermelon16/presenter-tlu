import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireSessionOwner } from "./authz";

// Tạo một hoạt động mới (bắt đầu với Poll)
export const createActivity = mutation({
  args: {
    sessionId: v.id("sessions"),
    type: v.union(v.literal("poll"), v.literal("wordcloud"), v.literal("rating"), v.literal("board"), v.literal("qa"), v.literal("opentext"), v.literal("video"), v.literal("html"), v.literal("survey")),
    title: v.string(),
    config: v.any(),
    requiresStudentCode: v.boolean(),
    timeLimit: v.optional(v.number()), // phút, cho phép số thập phân
    order: v.number(),
    slideCue: v.optional(v.string()), // Mốc slide PowerPoint (tùy chọn)
  },
  handler: async (ctx, args) => {
    const { session } = await requireSessionOwner(ctx, args.sessionId);

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
    await requireSessionOwner(ctx, activity.sessionId);

    const session = await ctx.db.get(activity.sessionId);

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

    // Gửi push notification cho SV đã subscribe (nếu VAPID đã cấu hình)
    // Video / HTML chỉ chiếu trên máy chiếu — không cần báo cho SV
    if (session && activity.type !== "video" && activity.type !== "html") {
      const typeLabel =
        activity.type === "poll"
          ? "Trắc nghiệm"
          : activity.type === "wordcloud"
            ? "Word Cloud"
            : activity.type === "rating"
              ? "Đánh giá"
              : activity.type === "board"
                ? "Bảng tương tác"
                : activity.type === "qa"
                  ? "Hỏi đáp"
                  : activity.type === "survey"
                    ? "Khảo sát"
                    : "Câu hỏi mở";
      await ctx.scheduler.runAfter(0, internal.push.sendActivityNotification, {
        sessionId: activity.sessionId,
        activityId: args.activityId,
        title: `🟢 ${typeLabel} mới`,
        body: activity.title,
        url: `/room/${session.code}`,
      });
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
      await ctx.runMutation(internal.responses.createNoResponseRecords, {
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
    await requireSessionOwner(ctx, activity.sessionId);

    await ctx.db.patch(args.activityId, {
      status: "closed",
      closedAt: Date.now(),
    });

    // Nếu hoạt động yêu cầu mã sinh viên → vẫn tạo no_response cho những người chưa trả lời
    if (activity.requiresStudentCode) {
      await ctx.runMutation(internal.responses.createNoResponseRecords, {
        activityId: args.activityId,
      });
    }
  },
});

// Lấy hoạt động đang active của session (nếu có).
// Bỏ qua video & html — chỉ chiếu trên máy chiếu, SV không xem trên điện thoại.
export const getActiveActivity = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "active"),
          q.neq(q.field("type"), "video"),
          q.neq(q.field("type"), "html")
        )
      )
      .first();
  },
});

// Di chuyển hoạt động lên trên
export const moveActivityUp = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return;
    await requireSessionOwner(ctx, activity.sessionId);

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
    await requireSessionOwner(ctx, activity.sessionId);

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
    await requireSessionOwner(ctx, sessionId);

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

/**
 * CHẠY LẠI TOÀN BỘ PHIÊN: với mọi activity đã close/expire (không active),
 * xoá responses + board posts → reset status="draft".
 * GV có thể bấm Bắt đầu từng cái HOẶC chạy script mode để chain tự động.
 *
 * KHÁC với `resetSessionForNewRun` (Phiên mới):
 *   - resetSessionForNewRun: tăng currentRun, KHÔNG xoá data (giữ lịch sử)
 *   - restartAllActivities: cùng run, XOÁ responses cũ (chạy lại y nguyên)
 */
export const restartAllActivities = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const { session } = await requireSessionOwner(ctx, args.sessionId);

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (activities.some((a) => a.status === "active")) {
      throw new Error("Đang có hoạt động chạy — đóng trước khi reset tất cả");
    }

    const currentRun = session.currentRun ?? 1;
    let resetCount = 0;
    let responseCount = 0;
    let postCount = 0;

    for (const activity of activities) {
      // Bỏ qua draft (chưa chạy, không cần xoá gì)
      if (activity.status === "draft") continue;

      // Xoá responses CỦA PHIÊN HIỆN TẠI (giữ lịch sử phiên cũ)
      const responses = await ctx.db
        .query("responses")
        .withIndex("by_activity", (q) => q.eq("activityId", activity._id))
        .collect();
      for (const r of responses) {
        if ((r.run ?? 1) === currentRun) {
          await ctx.db.delete(r._id);
          responseCount++;
        }
      }

      // Xoá board posts (nếu là board) — kèm ảnh storage
      if (activity.type === "board") {
        const posts = await ctx.db
          .query("boardPosts")
          .withIndex("by_activity", (q) => q.eq("activityId", activity._id))
          .collect();
        for (const p of posts) {
          if ((p.run ?? 1) === currentRun) {
            if (p.imageStorageId) {
              try { await ctx.storage.delete(p.imageStorageId); } catch { /* ignore */ }
            }
            await ctx.db.delete(p._id);
            postCount++;
          }
        }
      }

      // Reset về draft + clear nhận xét cũ
      await ctx.db.patch(activity._id, {
        status: "draft",
        startedAt: undefined,
        closedAt: undefined,
        aiReview: undefined,
      });
      resetCount++;
    }

    // Reset script position về đầu
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: false,
      currentScriptPosition: 0,
    });

    return { resetCount, responseCount, postCount };
  },
});

/**
 * CHẠY LẠI hoạt động: xóa toàn bộ responses cũ, đặt status="active" lại,
 * reset startedAt, re-schedule timeLimit nếu có. KHÔNG tạo bản sao mới.
 */
export const restartActivity = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) throw new Error("Không tìm thấy hoạt động");
    await requireSessionOwner(ctx, activity.sessionId);

    if (activity.status === "active") {
      throw new Error("Hoạt động đang chạy");
    }

    // Xóa toàn bộ responses cũ
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    for (const r of responses) {
      await ctx.db.delete(r._id);
    }

    // Xóa luôn board posts cũ nếu là board — kèm ảnh storage
    if (activity.type === "board") {
      const posts = await ctx.db
        .query("boardPosts")
        .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
        .collect();
      for (const p of posts) {
        if (p.imageStorageId) {
          try { await ctx.storage.delete(p.imageStorageId); } catch { /* ignore */ }
        }
        await ctx.db.delete(p._id);
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.activityId, {
      status: "active",
      startedAt: now,
      closedAt: undefined,
      aiReview: undefined, // clear nhận xét cũ — kết quả mới sẽ gen lại khi đóng
    });

    // Re-schedule expire nếu có timeLimit
    if (activity.timeLimit && activity.timeLimit > 0) {
      const delayMs = Math.round(activity.timeLimit * 60 * 1000);
      await ctx.scheduler.runAfter(
        delayMs,
        internal.activities.internalExpireActivity,
        { activityId: args.activityId }
      );
    }

    return { success: true, activityId: args.activityId };
  },
});

// Tạo bản sao hoạt động (giữ cho trường hợp muốn copy template)
export const duplicateActivity = mutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const original = await ctx.db.get(args.activityId);
    if (!original) {
      throw new Error("Không tìm thấy hoạt động gốc");
    }
    await requireSessionOwner(ctx, original.sessionId);

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
    await requireSessionOwner(ctx, activity.sessionId);

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
    await requireSessionOwner(ctx, activity.sessionId);

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

    // Nếu là video → xóa file trong storage để khỏi tốn dung lượng
    if (activity.type === "video" && activity.config?.videoStorageId) {
      try {
        await ctx.storage.delete(activity.config.videoStorageId);
      } catch {
        // ignore nếu file đã bị xóa hoặc không tồn tại
      }
    }

    // Nếu là html (upload file) → xóa file HTML trong storage
    if (activity.type === "html" && activity.config?.htmlStorageId) {
      try {
        await ctx.storage.delete(activity.config.htmlStorageId);
      } catch {
        // ignore nếu file đã bị xóa hoặc không tồn tại
      }
    }

    // Nếu là board → cascade xóa boardPosts (+ ảnh storage)
    if (activity.type === "board") {
      const posts = await ctx.db
        .query("boardPosts")
        .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
        .collect();
      for (const p of posts) {
        if (p.imageStorageId) {
          try { await ctx.storage.delete(p.imageStorageId); } catch { /* ignore */ }
        }
        await ctx.db.delete(p._id);
      }
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
    const { session } = await requireSessionOwner(ctx, args.sessionId);

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
    await requireSessionOwner(ctx, args.sessionId);
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: false,
    });
  },
});

/**
 * Chuyển đến vị trí cụ thể trong kịch bản. CHỈ cập nhật vị trí — không tự động kích hoạt.
 * Giảng viên phải bấm "▶ Kích hoạt" rõ ràng để SV trả lời.
 */
export const jumpToScriptPosition = mutation({
  args: {
    sessionId: v.id("sessions"),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSessionOwner(ctx, args.sessionId);

    const sorted = await getSortedActivities(ctx, args.sessionId);
    if (sorted.length === 0) throw new Error("Kịch bản trống");

    const targetPos = Math.max(0, Math.min(args.position, sorted.length - 1));
    const targetActivity = sorted[targetPos];

    // Cập nhật vị trí script — KHÔNG tự kích hoạt activity
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: true,
      currentScriptPosition: targetPos,
    });

    return { position: targetPos, activityId: targetActivity._id, status: targetActivity.status };
  },
});

/**
 * TIẾP THEO trong kịch bản — chỉ cập nhật vị trí, KHÔNG tự kích hoạt activity.
 * Giảng viên chủ động bấm "▶ Kích hoạt" để SV được trả lời.
 */
export const advanceInScript = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const { session } = await requireSessionOwner(ctx, args.sessionId);

    const sorted = await getSortedActivities(ctx, args.sessionId);
    if (sorted.length === 0) throw new Error("Kịch bản trống");

    const currentPos = session.currentScriptPosition ?? 0;
    const nextPos = Math.min(currentPos + 1, sorted.length - 1);

    if (nextPos === currentPos) {
      return { position: currentPos, atEnd: true };
    }

    const nextActivity = sorted[nextPos];

    // Chỉ cập nhật vị trí
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: true,
      currentScriptPosition: nextPos,
    });

    return {
      position: nextPos,
      total: sorted.length,
      nextActivityId: nextActivity._id,
      nextSlideCue: nextActivity.slideCue || null,
      status: nextActivity.status,
    };
  },
});

/**
 * (Giữ lại cho tương thích — không còn dùng trong UI mới)
 * Auto-advance: chuyển vị trí + tự kích hoạt activity. Dùng khi script chạy tự động.
 */
export const advanceAndActivate = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const { session } = await requireSessionOwner(ctx, args.sessionId);

    const sorted = await getSortedActivities(ctx, args.sessionId);
    if (sorted.length === 0) throw new Error("Kịch bản trống");

    const currentPos = session.currentScriptPosition ?? 0;
    const nextPos = Math.min(currentPos + 1, sorted.length - 1);

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
