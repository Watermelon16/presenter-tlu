import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Helper: require user đã đăng nhập + approved.
async function requireApprovedUser(ctx: {
  auth: unknown;
  db: import("./_generated/server").QueryCtx["db"];
}) {
  const userId = await getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0]);
  if (!userId) throw new Error("Cần đăng nhập trước");
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!profile) throw new Error("Profile chưa tạo — refresh và thử lại");
  if (profile.status === "banned") throw new Error("Tài khoản đã bị khoá");
  if (profile.status === "pending") throw new Error("Tài khoản chờ admin duyệt");
  return { userId, profile };
}

// List tất cả hotspot của 1 file PDF (cho cả edit + present).
// Không cần auth — bất kỳ ai mở phiên có file PDF này đều thấy hotspot
// (đồng bộ giữa các tab presenter/companion). Mutation mới cần auth.
export const listForPdf = query({
  args: { pdfStorageId: v.optional(v.id("_storage")) },
  handler: async (ctx, { pdfStorageId }) => {
    if (!pdfStorageId) return [];
    return await ctx.db
      .query("pdfHotspots")
      .withIndex("by_pdf", (q) => q.eq("pdfStorageId", pdfStorageId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pdfStorageId: v.id("_storage"),
    page: v.number(),
    x: v.number(),
    y: v.number(),
    w: v.number(),
    h: v.number(),
    targetPage: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireApprovedUser(ctx);
    const id = await ctx.db.insert("pdfHotspots", {
      pdfStorageId: args.pdfStorageId,
      ownerUserId: userId,
      page: Math.max(1, Math.floor(args.page)),
      x: clamp01(args.x),
      y: clamp01(args.y),
      w: clamp01(args.w),
      h: clamp01(args.h),
      targetPage: Math.max(1, Math.floor(args.targetPage)),
      label: args.label?.trim() || undefined,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("pdfHotspots"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    w: v.optional(v.number()),
    h: v.optional(v.number()),
    targetPage: v.optional(v.number()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const { userId } = await requireApprovedUser(ctx);
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Hotspot không tồn tại");
    if (existing.ownerUserId !== userId) throw new Error("Không có quyền sửa hotspot này");
    const next: Record<string, unknown> = {};
    if (patch.x !== undefined) next.x = clamp01(patch.x);
    if (patch.y !== undefined) next.y = clamp01(patch.y);
    if (patch.w !== undefined) next.w = clamp01(patch.w);
    if (patch.h !== undefined) next.h = clamp01(patch.h);
    if (patch.targetPage !== undefined) next.targetPage = Math.max(1, Math.floor(patch.targetPage));
    if (patch.label !== undefined) next.label = patch.label.trim() || undefined;
    await ctx.db.patch(id, next);
  },
});

export const remove = mutation({
  args: { id: v.id("pdfHotspots") },
  handler: async (ctx, { id }) => {
    const { userId } = await requireApprovedUser(ctx);
    const existing = await ctx.db.get(id);
    if (!existing) return;
    if (existing.ownerUserId !== userId) throw new Error("Không có quyền xoá hotspot này");
    await ctx.db.delete(id);
  },
});

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
