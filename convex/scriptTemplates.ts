import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireApprovedUser, requireSessionOwner } from "./authz";

// Lưu toàn bộ kịch bản hiện tại thành mẫu
export const saveScriptAsTemplate = mutation({
  args: {
    sessionId: v.id("sessions"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSessionOwner(ctx, args.sessionId);
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    if (activities.length === 0) {
      throw new Error("Không có hoạt động nào để lưu");
    }

    const snapshot = activities.map((act) => ({
      type: act.type,
      title: act.title,
      config: act.config,
      slideCue: act.slideCue,
      timeLimit: act.timeLimit,
      requiresStudentCode: act.requiresStudentCode,
      order: act.order,
    }));

    await ctx.db.insert("scriptTemplates", {
      name: args.name.trim(),
      hostId: userId,
      activitiesSnapshot: snapshot,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Lấy danh sách template
export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const { userId, profile } = await requireApprovedUser(ctx);
    const all = await ctx.db
      .query("scriptTemplates")
      .order("desc")
      .collect();
    if (profile.role === "admin") return all;
    // Mỗi GV chỉ thấy mẫu của mình + mẫu cũ chưa gắn chủ (dùng chung, tương thích ngược).
    return all.filter((t) => !t.hostId || t.hostId === userId);
  },
});

// Áp dụng một template vào buổi hiện tại (copy các hoạt động)
export const applyTemplateToSession = mutation({
  args: {
    sessionId: v.id("sessions"),
    templateId: v.id("scriptTemplates"),
  },
  handler: async (ctx, args) => {
    await requireSessionOwner(ctx, args.sessionId);
    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error("Không tìm thấy kịch bản mẫu");
    }

    const existingActivities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    // Xóa hết hoạt động cũ trong buổi (để thay thế bằng template)
    for (const act of existingActivities) {
      await ctx.db.delete(act._id);
    }

    // Copy các hoạt động từ snapshot vào buổi
    const snapshot = template.activitiesSnapshot as any[];

    for (const item of snapshot) {
      await ctx.db.insert("activities", {
        sessionId: args.sessionId,
        type: item.type,
        title: item.title,
        config: item.config || {},
        slideCue: item.slideCue,
        timeLimit: item.timeLimit,
        requiresStudentCode: item.requiresStudentCode ?? false,
        order: item.order ?? 0,
        status: "draft",
        createdAt: Date.now(),
      });
    }

    return { success: true, appliedCount: snapshot.length };
  },
});

// Xóa mẫu kịch bản đã lưu
export const deleteTemplate = mutation({
  args: { templateId: v.id("scriptTemplates") },
  handler: async (ctx, args) => {
    const { userId, profile } = await requireApprovedUser(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error("Không tìm thấy mẫu để xóa");
    }
    if (template.hostId && template.hostId !== userId && profile.role !== "admin") {
      throw new Error("Bạn không có quyền xóa mẫu này");
    }
    await ctx.db.delete(args.templateId);
    return { success: true, name: template.name };
  },
});