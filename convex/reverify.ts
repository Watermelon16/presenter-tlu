// Điểm danh lại giữa giờ — chống SV điểm danh đầu giờ rồi rời lớp.
//
// Nguyên tắc bảo mật: mã xác minh KHÔNG được đặt trên bảng `sessions`, vì trang
// phòng của SV (app/room/[code]) subscribe trực tiếp doc session qua
// getSessionByCode (trả nguyên doc) — nếu để mã ở đó, SV ở nhà cũng đọc được mã
// mà không cần nhìn màn chiếu, phá vỡ mục đích xác minh vị trí vật lý.
// Mã được lưu ở bảng riêng `reverifyRounds`, chỉ trả về qua:
//   - kết quả mutation startRound (chỉ GV gọi mới thấy)
//   - query getActiveRoundForOwner (owner-only, GV mở lại panel vẫn thấy mã)
// SV chỉ thấy trạng thái "đang có đợt xác minh, hết hạn lúc X" qua
// getPublicRoundStatus — KHÔNG có mã.

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSessionOwner } from "./authz";

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 số
}

// ─── GV: mở đợt điểm danh lại — sinh mã, hiện to trên màn chiếu ────────────
export const startRound = mutation({
  args: {
    sessionId: v.id("sessions"),
    durationSeconds: v.optional(v.number()), // mặc định 90s, giới hạn 30-300s
  },
  handler: async (ctx, args) => {
    await requireSessionOwner(ctx, args.sessionId);
    const duration = Math.max(30, Math.min(300, args.durationSeconds ?? 90));
    const now = Date.now();
    const code = generateCode();
    const roundId = await ctx.db.insert("reverifyRounds", {
      sessionId: args.sessionId,
      code,
      createdAt: now,
      expiresAt: now + duration * 1000,
    });
    return { roundId, code, createdAt: now, expiresAt: now + duration * 1000 };
  },
});

// ─── GV: xem lại đợt gần nhất (kèm mã) — vd sau khi reload trang ───────────
export const getActiveRoundForOwner = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await requireSessionOwner(ctx, args.sessionId);
    const round = await ctx.db
      .query("reverifyRounds")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();
    if (!round) return null;
    return {
      code: round.code,
      createdAt: round.createdAt,
      expiresAt: round.expiresAt,
    };
  },
});

// ─── SV: chỉ biết "đang có đợt xác minh + hết hạn lúc X", KHÔNG có mã ──────
export const getPublicRoundStatus = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const round = await ctx.db
      .query("reverifyRounds")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();
    if (!round) return { active: false, expiresAt: null as number | null };
    return { active: Date.now() < round.expiresAt, expiresAt: round.expiresAt };
  },
});

// ─── SV: nhập mã đọc từ màn chiếu để xác nhận vẫn đang có mặt ──────────────
export const confirmPresence = mutation({
  args: {
    sessionId: v.id("sessions"),
    studentCode: v.string(),
    deviceId: v.optional(v.string()),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const round = await ctx.db
      .query("reverifyRounds")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();
    if (!round) throw new ConvexError("Chưa có đợt điểm danh lại nào đang mở");
    if (Date.now() > round.expiresAt) throw new ConvexError("Mã đã hết hạn — đợi GV mở đợt mới");
    if (args.code.trim() !== round.code) throw new ConvexError("Mã không đúng, kiểm tra lại trên màn chiếu");

    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new ConvexError("Không tìm thấy buổi giảng");
    const currentRun = session.currentRun ?? 1;

    const participant = await ctx.db
      .query("participants")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentCode", args.studentCode)
      )
      .first();
    if (!participant || (participant.run ?? 1) !== currentRun) {
      throw new ConvexError("Bạn chưa điểm danh đầu giờ — không thể xác minh giữa giờ");
    }
    if (participant.isGuest) {
      throw new ConvexError("Khách không cần xác minh điểm danh");
    }

    const patch: Record<string, unknown> = { lastReverifyAt: Date.now() };
    // Thiết bị khác với lúc điểm danh đầu giờ → không chặn (có thể đổi máy hợp lệ),
    // nhưng gắn cờ để GV để ý — cùng cơ chế chống gian lận đã dùng ở joinSession.
    if (args.deviceId && participant.deviceId && participant.deviceId !== args.deviceId) {
      patch.flagged = true;
      patch.flagReason = "Xác minh giữa giờ từ thiết bị khác — nghi nhờ người khác nhập hộ";
    }
    await ctx.db.patch(participant._id, patch);
    return { ok: true };
  },
});

// ─── GV: chốt đợt — SV present/late chưa xác minh sẽ bị gắn cờ để GV xem lại ─
// KHÔNG tự đổi attendanceStatus — chỉ cảnh báo, GV tự quyết định override.
export const finalizeRound = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const { session } = await requireSessionOwner(ctx, args.sessionId);
    const round = await ctx.db
      .query("reverifyRounds")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();
    if (!round) throw new ConvexError("Chưa mở đợt điểm danh lại nào");

    const currentRun = session.currentRun ?? 1;
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    let flaggedCount = 0;
    for (const p of participants) {
      if ((p.run ?? 1) !== currentRun) continue;
      if (p.isGuest) continue;
      if (p.attendanceStatus !== "present" && p.attendanceStatus !== "late") continue;
      if (p.attendanceManualOverride) continue;
      if (p.lastReverifyAt && p.lastReverifyAt >= round.createdAt) continue; // đã xác minh
      await ctx.db.patch(p._id, {
        flagged: true,
        flagReason: "Không xác minh lại giữa giờ — nghi rời lớp sớm",
      });
      flaggedCount++;
    }
    return { flaggedCount };
  },
});
