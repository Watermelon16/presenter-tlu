import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Tạo URL để upload file (dùng cho Board ảnh, sau này có thể mở rộng)
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Lấy URL công khai của 1 file đã upload (dùng cho video activity)
export const getStorageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
