import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Tạo phòng mới
export const createSession = mutation({
  args: {
    title: v.string(),
    hostName: v.optional(v.string()),
    collectStudentCode: v.optional(v.boolean()),   // Có thu thập mã SV cho buổi này không
  },
  handler: async (ctx, args) => {
    // Tạo mã phòng ngắn, dễ nhớ (6 ký tự)
    const code = generateShortCode();

    const sessionId = await ctx.db.insert("sessions", {
      code,
      title: args.title.trim(),
      hostName: args.hostName?.trim(),
      collectStudentCode: args.collectStudentCode ?? true,   // Mặc định thu thập (phù hợp mục đích tính điểm)
      status: "active",
      createdAt: Date.now(),
    });

    return { sessionId, code };
  },
});

// Lấy thông tin phòng theo mã
export const getSessionByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();

    return session;
  },
});

// Kết thúc phòng (dành cho host)
export const endSession = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: "ended",
      endedAt: Date.now(),
    });
  },
});

// Cập nhật cài đặt thu thập mã sinh viên (dành cho presenter)
export const updateCollectStudentCode = mutation({
  args: {
    sessionId: v.id("sessions"),
    collectStudentCode: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      collectStudentCode: args.collectStudentCode,
    });
  },
});

// === Script Runner (Kịch bản) - Hỗ trợ liền mạch PowerPoint (ưu tiên B) ===

export const startScript = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    await ctx.db.patch(args.sessionId, {
      isScriptRunning: true,
      currentScriptPosition: 0,
    });
  },
});

export const stopScript = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: false,
    });
  },
});

export const setScriptPosition = mutation({
  args: {
    sessionId: v.id("sessions"),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    await ctx.db.patch(args.sessionId, {
      currentScriptPosition: Math.max(0, args.position),
      isScriptRunning: true, // Tự động bật nếu set vị trí
    });
  },
});

/**
 * Reset phiên giảng — bắt đầu PHIÊN MỚI với cùng kịch bản hoạt động.
 *
 * Xóa: tất cả response, participant, board posts, scoring tạm.
 * Reset: trạng thái activity về NHÁP, script position về 0.
 * Giữ: activities (tiêu đề, config, options, slide cue), session info, PDF nếu có, scoring config.
 *
 * Dùng khi: dạy cùng nội dung cho 1 lớp khác (cùng giảng viên, cùng kịch bản).
 */
export const resetSessionForNewRun = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    // Xóa tất cả responses của session
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const r of responses) {
      await ctx.db.delete(r._id);
    }

    // Xóa tất cả board posts
    const boardPosts = await ctx.db
      .query("boardPosts")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .collect();
    for (const p of boardPosts) {
      await ctx.db.delete(p._id);
    }

    // Xóa tất cả participants (SV phải join lại với phiên mới)
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const p of participants) {
      await ctx.db.delete(p._id);
    }

    // Reset trạng thái tất cả activities về NHÁP, xóa thời gian start/close
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    let resetActivityCount = 0;
    for (const a of activities) {
      await ctx.db.patch(a._id, {
        status: "draft",
        startedAt: undefined,
        closedAt: undefined,
      });
      resetActivityCount++;
    }

    // Reset script position
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: false,
      currentScriptPosition: 0,
      status: "active",  // Khôi phục trạng thái active nếu đã ended
      endedAt: undefined,
      pdfCurrentPage: 1, // Reset slide PDF về trang 1
    });

    return {
      success: true,
      activitiesReset: resetActivityCount,
      responsesDeleted: responses.length,
      participantsDeleted: participants.length,
      boardPostsDeleted: boardPosts.length,
    };
  },
});

// === Slide PDF (chiếu thay PowerPoint) ===

// Gán file PDF cho buổi giảng (sau khi upload xong vào Convex Storage)
export const setSessionPdf = mutation({
  args: {
    sessionId: v.id("sessions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    numPages: v.number(),
  },
  handler: async (ctx, args) => {
    // Nếu đã có PDF cũ → xóa khỏi storage để tiết kiệm dung lượng
    const session = await ctx.db.get(args.sessionId);
    if (session?.pdfStorageId) {
      try {
        await ctx.storage.delete(session.pdfStorageId);
      } catch {
        // bỏ qua nếu đã xóa
      }
    }

    await ctx.db.patch(args.sessionId, {
      pdfStorageId: args.storageId,
      pdfFileName: args.fileName,
      pdfNumPages: args.numPages,
      pdfCurrentPage: 1,
    });
  },
});

// Xóa PDF khỏi buổi giảng
export const clearSessionPdf = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session?.pdfStorageId) {
      try {
        await ctx.storage.delete(session.pdfStorageId);
      } catch {
        // bỏ qua
      }
    }
    await ctx.db.patch(args.sessionId, {
      pdfStorageId: undefined,
      pdfFileName: undefined,
      pdfNumPages: undefined,
      pdfCurrentPage: undefined,
    });
  },
});

// Cập nhật trang slide hiện tại (sync giữa các thiết bị / tab)
export const setPdfCurrentPage = mutation({
  args: {
    sessionId: v.id("sessions"),
    page: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      pdfCurrentPage: Math.max(1, args.page),
    });
  },
});

// Lấy URL công khai của PDF (để frontend tải về và render bằng PDF.js)
export const getSessionPdfUrl = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.pdfStorageId) return null;
    return await ctx.storage.getUrl(session.pdfStorageId);
  },
});

// Hàm tạo mã ngắn ngẫu nhiên
function generateShortCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Bỏ I, O, 0, 1 để dễ đọc
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
