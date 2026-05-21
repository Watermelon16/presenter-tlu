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
      collectStudentCode: args.collectStudentCode ?? true,
      status: "active",
      createdAt: Date.now(),
      currentRun: 1,  // Phiên đầu tiên
    });

    return { sessionId, code };
  },
});

// Đọc số phiên hiện tại của session — backward compat: undefined → 1
export async function readCurrentRun(ctx: { db: { get: (id: string) => Promise<{ currentRun?: number } | null> } }, sessionId: string): Promise<number> {
  const s = await ctx.db.get(sessionId);
  return s?.currentRun ?? 1;
}

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
 * Bắt đầu PHIÊN MỚI cho session — giữ lịch sử các phiên cũ.
 *
 * Tăng currentRun, reset activities về NHÁP. KHÔNG xóa data — responses,
 * participants, boardPosts của các phiên cũ vẫn còn trong DB (filtered ra
 * khi query bằng run number).
 *
 * Dùng khi: dạy cùng nội dung cho 1 lớp khác.
 */
export const resetSessionForNewRun = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    const oldRun = session.currentRun ?? 1;
    const newRun = oldRun + 1;

    // Reset trạng thái tất cả activities về NHÁP
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const a of activities) {
      await ctx.db.patch(a._id, {
        status: "draft",
        startedAt: undefined,
        closedAt: undefined,
      });
    }

    // Tăng currentRun + reset session state, KHÔNG xóa data cũ
    await ctx.db.patch(args.sessionId, {
      isScriptRunning: false,
      currentScriptPosition: 0,
      status: "active",
      endedAt: undefined,
      pdfCurrentPage: 1,
      currentRun: newRun,
    });

    return {
      success: true,
      activitiesReset: activities.length,
      oldRun,
      newRun,
    };
  },
});

/**
 * Liệt kê các phiên đã chạy của session (kèm số participant + response của mỗi phiên).
 */
export const listRuns = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return { current: 1, runs: [] };

    const currentRun = session.currentRun ?? 1;

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const responses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    // Gom số participant + response theo run
    const runStats = new Map<number, { participantCount: number; responseCount: number }>();
    for (let i = 1; i <= currentRun; i++) {
      runStats.set(i, { participantCount: 0, responseCount: 0 });
    }
    for (const p of participants) {
      const r = p.run ?? 1;
      const stat = runStats.get(r) || { participantCount: 0, responseCount: 0 };
      stat.participantCount++;
      runStats.set(r, stat);
    }
    for (const res of responses) {
      const r = res.run ?? 1;
      const stat = runStats.get(r) || { participantCount: 0, responseCount: 0 };
      stat.responseCount++;
      runStats.set(r, stat);
    }

    const runs = Array.from(runStats.entries())
      .map(([number, stat]) => ({
        number,
        isCurrent: number === currentRun,
        participantCount: stat.participantCount,
        responseCount: stat.responseCount,
      }))
      .sort((a, b) => b.number - a.number); // mới nhất trước

    return { current: currentRun, runs };
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

/**
 * Liệt kê chi tiết các session theo danh sách ID — dùng cho trang Quản lý buổi cũ.
 * Trả về stats: số activities, responses, participants, boardPosts cho mỗi session.
 */
export const listSessionsByIds = query({
  args: { sessionIds: v.array(v.id("sessions")) },
  handler: async (ctx, args) => {
    const results = [];
    for (const sid of args.sessionIds) {
      const session = await ctx.db.get(sid);
      if (!session) continue;

      const activities = await ctx.db
        .query("activities")
        .withIndex("by_session", (q) => q.eq("sessionId", sid))
        .collect();

      const participants = await ctx.db
        .query("participants")
        .withIndex("by_session", (q) => q.eq("sessionId", sid))
        .collect();

      const responses = await ctx.db
        .query("responses")
        .withIndex("by_session_and_student", (q) => q.eq("sessionId", sid))
        .collect();

      const boardPosts = await ctx.db
        .query("boardPosts")
        .filter((q) => q.eq(q.field("sessionId"), sid))
        .collect();

      results.push({
        _id: session._id,
        code: session.code,
        title: session.title,
        hostName: session.hostName,
        status: session.status,
        createdAt: session.createdAt,
        endedAt: session.endedAt,
        currentRun: session.currentRun ?? 1,
        hasPdf: !!session.pdfStorageId,
        pdfFileName: session.pdfFileName,
        stats: {
          activityCount: activities.length,
          participantCount: participants.length,
          responseCount: responses.length,
          boardPostCount: boardPosts.length,
        },
      });
    }
    // Sort: ended cuối, mới nhất trước
    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Xóa session + tất cả data liên quan (activities, responses, participants, board posts, PDF).
 * Cẩn thận: hành động không hồi phục được.
 */
export const deleteSession = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Không tìm thấy buổi giảng");

    let counts = {
      activities: 0,
      responses: 0,
      participants: 0,
      boardPosts: 0,
      images: 0,
    };

    // 1. Board posts (có ảnh storage)
    const boardPosts = await ctx.db
      .query("boardPosts")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .collect();
    for (const p of boardPosts) {
      // Note: imageUrl là URL public — không có storageId riêng để xóa
      // Convex storage URLs sẽ orphan nếu không track riêng. Skip for now.
      await ctx.db.delete(p._id);
      counts.boardPosts++;
    }

    // 2. Responses
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const r of responses) {
      await ctx.db.delete(r._id);
      counts.responses++;
    }

    // 3. Participants
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const p of participants) {
      await ctx.db.delete(p._id);
      counts.participants++;
    }

    // 4. Activities
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const a of activities) {
      await ctx.db.delete(a._id);
      counts.activities++;
    }

    // 5. PDF storage
    if (session.pdfStorageId) {
      try {
        await ctx.storage.delete(session.pdfStorageId);
        counts.images++;
      } catch {
        // Ignore — có thể đã bị xóa
      }
    }

    // 6. Session itself
    await ctx.db.delete(args.sessionId);

    return { success: true, counts };
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
