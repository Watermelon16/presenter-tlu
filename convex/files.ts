import { mutation } from "./_generated/server";

// Tạo URL để upload file (dùng cho Board ảnh, sau này có thể mở rộng)
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
