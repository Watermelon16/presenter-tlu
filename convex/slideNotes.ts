import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Lấy toàn bộ ghi chú của một bộ slide (theo pdfStorageId) → map page→text ở client. */
export const getSlideNotes = query({
  args: { pdfStorageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("slideNotes")
      .withIndex("by_pdf", (q) => q.eq("pdfStorageId", args.pdfStorageId))
      .collect();
    return rows.map((r) => ({ page: r.page, text: r.text }));
  },
});

/** Upsert ghi chú cho 1 trang. text rỗng → xoá bản ghi cho gọn. */
export const setSlideNote = mutation({
  args: { pdfStorageId: v.id("_storage"), page: v.number(), text: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slideNotes")
      .withIndex("by_pdf_and_page", (q) =>
        q.eq("pdfStorageId", args.pdfStorageId).eq("page", args.page)
      )
      .first();

    const text = args.text.trim();
    if (existing) {
      if (text === "") await ctx.db.delete(existing._id);
      else await ctx.db.patch(existing._id, { text: args.text });
    } else if (text !== "") {
      await ctx.db.insert("slideNotes", {
        pdfStorageId: args.pdfStorageId,
        page: args.page,
        text: args.text,
      });
    }
  },
});
