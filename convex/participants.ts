import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { computeAttendanceFromCheckin, resolveAccessMode } from "./lms";
import { requireSessionOwner } from "./authz";

// Sinh viên tham gia phòng + nhập thông tin danh tính
//
// CHỐNG GIAN LẬN (điểm danh hộ / làm bài hộ):
// - 1 thiết bị (deviceId) chỉ được dùng cho 1 SV CHÍNH THỨC duy nhất trong 1 phòng
// - Nếu cố join bằng MSV chính thức khác từ cùng thiết bị → reject
// - Nếu studentCode đã có nhưng từ thiết bị khác → flag participant để giảng viên kiểm tra
//
// CHẾ ĐỘ VÀO PHÒNG (accessMode — xem resolveAccessMode trong lms.ts):
// - roster : bắt buộc MSV có trong rosterCache, không có → REJECT (như cũ cho phòng LMS)
// - open   : ai cũng vào; MSV khớp roster → SV chính thức; còn lại bắt buộc Họ tên + Lớp,
//            đánh dấu KHÁCH (isGuest) — không điểm danh, không sync LMS
// - public : quảng bá/đại trà; chỉ bắt buộc Họ tên, Lớp + MSV tùy chọn; mọi người không
//            khớp roster đều là KHÁCH
//
// KHÁCH (isGuest): vẫn tham gia hoạt động, nhưng KHÔNG vào sổ điểm danh (attendanceStatus
// để trống), KHÔNG auto-set T0, KHÔNG đẩy lên LMS. MSV trống → sinh guest_<deviceId>.
//
// ĐIỂM DANH (SV chính thức): cutoff đi muộn dùng attendanceOpenAt + lateCutoffMinutes
// (LMS-driven), fallback officialStartAt + lateThresholdMinutes (legacy first-scan).
export const joinSession = mutation({
  args: {
    code: v.string(),
    studentCode: v.optional(v.string()),  // tùy chọn ở chế độ open/public
    fullName: v.optional(v.string()),
    className: v.optional(v.string()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();

    if (!session) {
      throw new ConvexError("Không tìm thấy phòng với mã này");
    }

    if (session.status !== "active") {
      throw new ConvexError("Phòng đã kết thúc");
    }

    const deviceId = args.deviceId?.trim() || undefined;
    const inputStudentCode = (args.studentCode ?? "").trim();
    const accessMode = resolveAccessMode(session);
    const isLmsLinked = !!session.lmsSessionId;

    // Tra danh sách lớp theo MSV (nếu có) — dùng chung cho cả 3 chế độ
    const rosterRow = inputStudentCode
      ? await ctx.db
          .query("rosterCache")
          .withIndex("by_session_and_student", (q) =>
            q.eq("sessionId", session._id).eq("studentCode", inputStudentCode)
          )
          .first()
      : null;

    // Resolve danh tính + xác định SV chính thức / khách
    let studentCode: string;
    let fullName: string;
    let className: string;
    let isGuest: boolean;

    if (rosterRow) {
      // Khớp danh sách lớp → SV chính thức (ở mọi chế độ)
      studentCode = inputStudentCode;
      fullName = rosterRow.fullName;
      className = session.className ?? (args.className ?? "").trim();
      isGuest = false;
    } else if (accessMode === "roster") {
      // Chế độ chặt: bắt buộc có trong danh sách lớp
      if (!inputStudentCode) {
        throw new ConvexError("Vui lòng nhập mã sinh viên");
      }
      throw new ConvexError("Mã sinh viên không có trong danh sách lớp. Liên hệ giảng viên để kiểm tra.");
    } else {
      // open / public — khách vãng lai (không khớp danh sách lớp)
      fullName = (args.fullName ?? "").trim();
      className = (args.className ?? "").trim();
      if (!fullName) {
        throw new ConvexError("Vui lòng nhập họ và tên");
      }
      if (accessMode === "open" && !className) {
        throw new ConvexError("Vui lòng nhập đầy đủ Họ tên và Lớp");
      }
      isGuest = true;
      // MSV: dùng MSV khai (nếu có) để GV vẫn nhận diện, else sinh khóa ổn định theo thiết bị
      studentCode = inputStudentCode
        || (deviceId ? `guest_${deviceId}` : `guest_${Math.random().toString(36).slice(2, 12)}`);
    }

    // CHECK 1: Thiết bị này đã đăng ký SV khác trong phòng này chưa?
    if (deviceId) {
      const sameDevice = await ctx.db
        .query("participants")
        .withIndex("by_session_and_device", (q) =>
          q.eq("sessionId", session._id).eq("deviceId", deviceId)
        )
        .first();

      // Chỉ chặn khi CẢ HAI là SV chính thức (chống điểm danh hộ). Khách (isGuest)
      // được miễn — để chế độ open/public không vướng, và cho phép "nâng cấp" từ
      // khách sang SV thật trên cùng thiết bị.
      if (
        sameDevice &&
        sameDevice.studentCode !== studentCode &&
        !sameDevice.isGuest &&
        !isGuest
      ) {
        throw new ConvexError(
          `Thiết bị này đã đăng ký SV "${sameDevice.studentCode}" (${sameDevice.fullName}) trong buổi. Mỗi thiết bị chỉ dùng cho 1 SV.`
        );
      }
    }

    // Tìm participant theo studentCode
    const existing = await ctx.db
      .query("participants")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", session._id).eq("studentCode", studentCode)
      )
      .first();

    const currentRun = session.currentRun ?? 1;
    const joinedAt = Date.now();

    // CHECK 2: tìm participant của SV này trong PHIÊN HIỆN TẠI (run filter)
    // Nếu existing là của phiên trước → tạo participant mới cho phiên này
    if (existing && (existing.run ?? 1) === currentRun) {
      const patch: Record<string, unknown> = {
        fullName,
        className,
        isGuest,
      };

      // Nâng cấp KHÁCH → SV chính thức (vd roster mới được đồng bộ sau khi khách
      // đã join bằng MSV thật): tính điểm danh bù dựa trên giờ join trước đó.
      if (existing.isGuest && !isGuest && !existing.attendanceStatus) {
        let officialStartAt = session.officialStartAt;
        if (!officialStartAt && !session.attendanceOpenAt) {
          officialStartAt = existing.joinedAt;
          await ctx.db.patch(session._id, { officialStartAt: existing.joinedAt });
        }
        patch.attendanceStatus = computeAttendanceFromCheckin(
          existing.joinedAt,
          session.attendanceOpenAt,
          officialStartAt,
          session.lateCutoffMinutes,
          session.lateThresholdMinutes,
          session.absentAfterMinutes
        );
        patch.checkinAt = existing.joinedAt;
      }

      if (deviceId && existing.deviceId && existing.deviceId !== deviceId) {
        patch.deviceId = deviceId;
        patch.flagged = true;
        patch.flagReason = `Đăng nhập từ ${(existing.deviceChangeCount ?? 0) + 2} thiết bị khác nhau trong buổi`;
        patch.deviceChangeCount = (existing.deviceChangeCount ?? 0) + 1;
      } else if (deviceId && !existing.deviceId) {
        patch.deviceId = deviceId;
      }

      await ctx.db.patch(existing._id, patch);
      return {
        participantId: existing._id,
        sessionId: session._id,
        flagged: !!patch.flagged,
        studentCode,
        isGuest,
        attendanceStatus:
          (patch.attendanceStatus as string | undefined) ??
          existing.attendanceStatus ??
          null,
        fullName,
        className,
      };
    }

    // === KHÁCH: ghi nhận để GV thấy + tham gia hoạt động, KHÔNG vào sổ điểm danh ===
    // Không auto-set T0, không attendanceStatus, không sync LMS.
    if (isGuest) {
      // 1 THIẾT BỊ = 1 KHÁCH: nếu thiết bị này đã có 1 khách trong PHIÊN HIỆN TẠI →
      // DÙNG LẠI bản ghi đó (cập nhật tên/lớp theo lần mới nhất), KHÔNG tạo khách mới
      // → số lượng không bị thổi phồng khi 1 máy đăng ký nhiều lần. Giữ nguyên
      // studentCode gốc (định danh ổn định) để không lệch dữ liệu trả lời đã có.
      if (deviceId) {
        const sameDeviceGuest = await ctx.db
          .query("participants")
          .withIndex("by_session_and_device", (q) =>
            q.eq("sessionId", session._id).eq("deviceId", deviceId)
          )
          .filter((q) => q.eq(q.field("isGuest"), true))
          .first();
        if (sameDeviceGuest && (sameDeviceGuest.run ?? 1) === currentRun) {
          await ctx.db.patch(sameDeviceGuest._id, { fullName, className });
          return {
            participantId: sameDeviceGuest._id,
            sessionId: session._id,
            flagged: false,
            studentCode: sameDeviceGuest.studentCode,
            isGuest: true,
            attendanceStatus: null,
            fullName,
            className,
            lateBySeconds: 0,
          };
        }
      }

      const participantId = await ctx.db.insert("participants", {
        sessionId: session._id,
        studentCode,
        fullName,
        className,
        joinedAt,
        deviceId,
        deviceChangeCount: 0,
        run: currentRun,
        isGuest: true,
      });
      return {
        participantId,
        sessionId: session._id,
        flagged: false,
        studentCode,
        isGuest: true,
        attendanceStatus: null,
        fullName,
        className,
        lateBySeconds: 0,
      };
    }

    // === SV chính thức (khớp danh sách lớp): điểm danh + sync LMS ===
    // Auto-set officialStartAt nếu chưa có và session KHÔNG dùng attendanceOpenAt (LMS-driven)
    let officialStartAt = session.officialStartAt;
    if (!officialStartAt && !session.attendanceOpenAt) {
      officialStartAt = joinedAt;
      await ctx.db.patch(session._id, { officialStartAt: joinedAt });
    }

    // Compute attendance: ưu tiên attendanceOpenAt (LMS), fallback officialStartAt
    // 3 trạng thái: 0..10p=present, 10..50p=late, >50p=absent (cấu hình per session)
    const attendanceStatus = computeAttendanceFromCheckin(
      joinedAt,
      session.attendanceOpenAt,
      officialStartAt,
      session.lateCutoffMinutes,
      session.lateThresholdMinutes,
      session.absentAfterMinutes
    );

    const participantId = await ctx.db.insert("participants", {
      sessionId: session._id,
      studentCode,
      fullName,
      className,
      joinedAt,
      deviceId,
      deviceChangeCount: 0,
      run: currentRun,
      attendanceStatus,
      attendanceManualOverride: false,
      checkinAt: joinedAt,
      checkinSource: isLmsLinked ? "presenter" : undefined,
      isGuest: false,
    });

    // Fire-and-forget webhook sync sang LMS (nếu session liên thông LMS).
    // webhookUrl ưu tiên field session, fallback env LMS_SYNC_URL (đã set).
    if (session.lmsSessionId) {
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: session.lmsSessionId,
        studentId: studentCode,
        studentName: fullName,
        attendanceStatus,
        checkinTime: joinedAt,
      });
    }

    const t0 = session.attendanceOpenAt ?? officialStartAt;
    return {
      participantId,
      sessionId: session._id,
      flagged: false,
      studentCode,
      isGuest: false,
      attendanceStatus,
      fullName,
      className,
      lateBySeconds: attendanceStatus === "late" && t0
        ? Math.round((joinedAt - t0) / 1000)
        : 0,
    };
  },
});

// Lấy danh sách sinh viên đã tham gia (dành cho giảng viên xem sau)
export const listParticipants = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const currentRun = session?.currentRun ?? 1;
    const all = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .collect();
    return all.filter((p) => (p.run ?? 1) === currentRun);
  },
});

/**
 * GV override attendance status cho 1 SV.
 * Set manualOverride=true để tránh auto-recompute.
 */
export const setAttendanceStatus = mutation({
  args: {
    participantId: v.id("participants"),
    status: v.union(
      v.literal("present"),
      v.literal("late"),
      v.literal("excused"),
      v.literal("absent"),
      v.literal("early_leave")
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    if (!participant) throw new ConvexError("Không tìm thấy SV");
    await requireSessionOwner(ctx, participant.sessionId);

    await ctx.db.patch(args.participantId, {
      attendanceStatus: args.status,
      attendanceManualOverride: true,
      attendanceNote: args.note,
    });

    // Push status mới lên LMS nếu session liên thông LMS
    const session = await ctx.db.get(participant.sessionId);
    if (session?.lmsSessionId) {
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: session.lmsSessionId,
        studentId: participant.studentCode,
        studentName: participant.fullName,
        attendanceStatus: args.status,
        checkinTime: participant.checkinAt ?? participant.joinedAt,
      });
    }
  },
});

/**
 * Reset officialStartAt (T0) của session — dùng khi GV muốn lấy giờ
 * scan đầu tiên thực sự làm T0 thay vì giá trị đã set tạm.
 */
export const resetOfficialStartAt = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await requireSessionOwner(ctx, args.sessionId);
    await ctx.db.patch(args.sessionId, { officialStartAt: undefined });
    return { ok: true };
  },
});

/**
 * Xóa 1 participant (GV cleanup nhầm/giả). Cũng xóa response của SV đó
 * cho session này để giữ DB sạch.
 */
export const removeParticipant = mutation({
  args: { participantId: v.id("participants") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.participantId);
    if (!p) return { ok: false, reason: "not_found" };
    await requireSessionOwner(ctx, p.sessionId);
    // Xóa responses của SV này trong session
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", p.sessionId).eq("studentCode", p.studentCode)
      )
      .collect();
    for (const r of responses) {
      await ctx.db.delete(r._id);
    }
    await ctx.db.delete(args.participantId);
    // Reset officialStartAt nếu vừa xóa SV đầu tiên (so far ko critical, skip)
    return { ok: true, responsesDeleted: responses.length };
  },
});

/**
 * Bulk override — set status cho NHIỀU SV cùng lúc.
 * Dùng cho action "Đánh tất cả vắng có phép", v.v.
 */
export const setAttendanceStatusBulk = mutation({
  args: {
    participantIds: v.array(v.id("participants")),
    status: v.union(
      v.literal("present"),
      v.literal("late"),
      v.literal("excused"),
      v.literal("absent"),
      v.literal("early_leave")
    ),
  },
  handler: async (ctx, args) => {
    if (args.participantIds.length === 0) return { count: 0 };
    // Xác thực chủ buổi qua SV đầu tiên, rồi chỉ xử lý các SV cùng buổi đó.
    const first = await ctx.db.get(args.participantIds[0]);
    if (!first) throw new ConvexError("Không tìm thấy SV");
    await requireSessionOwner(ctx, first.sessionId);

    let count = 0;
    for (const id of args.participantIds) {
      const p = await ctx.db.get(id);
      if (!p || p.sessionId !== first.sessionId) continue;
      await ctx.db.patch(id, {
        attendanceStatus: args.status,
        attendanceManualOverride: true,
      });
      count++;
      // Push từng SV lên LMS nếu session liên thông LMS
      const session = await ctx.db.get(p.sessionId);
      if (session?.lmsSessionId) {
        await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
          webhookUrl: session.attendanceWebhookUrl,
          lmsSessionId: session.lmsSessionId,
          studentId: p.studentCode,
          studentName: p.fullName,
          attendanceStatus: args.status,
          checkinTime: p.checkinAt ?? p.joinedAt,
        });
      }
    }
    return { count };
  },
});

/**
 * Đồng bộ lại TẤT CẢ participants trong run hiện tại lên LMS.
 * Dùng khi GV phát hiện LMS panel lệch trạng thái với Presenter — bấm 1 phát
 * push hết status hiện tại sang LMS để 2 bên match. Fire-and-forget từng SV.
 */
export const pushAllParticipantsToLms = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const { session } = await requireSessionOwner(ctx, args.sessionId);
    if (!session.lmsSessionId) {
      throw new ConvexError("Buổi giảng này không liên thông LMS");
    }

    const currentRun = session.currentRun ?? 1;
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    let queued = 0;
    let skipped = 0;
    for (const p of participants) {
      if ((p.run ?? 1) !== currentRun) continue;
      if (!p.attendanceStatus) {
        skipped++;
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.lmsSync.sendAttendanceToLms, {
        webhookUrl: session.attendanceWebhookUrl,
        lmsSessionId: session.lmsSessionId,
        studentId: p.studentCode,
        studentName: p.fullName,
        attendanceStatus: p.attendanceStatus,
        checkinTime: p.checkinAt ?? p.joinedAt,
      });
      queued++;
    }

    return { queued, skipped };
  },
});

/**
 * GV chỉnh setting điểm danh của session: ngưỡng đi muộn, T0, webhook URL.
 */
export const updateAttendanceSettings = mutation({
  args: {
    sessionId: v.id("sessions"),
    lateThresholdMinutes: v.optional(v.number()),
    absentAfterMinutes: v.optional(v.number()),
    officialStartAt: v.optional(v.number()),
    attendanceWebhookUrl: v.optional(v.string()),
    lmsSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionOwner(ctx, args.sessionId);
    const patch: Record<string, unknown> = {};
    if (args.lateThresholdMinutes !== undefined) {
      patch.lateThresholdMinutes = Math.max(0, Math.min(120, args.lateThresholdMinutes));
    }
    if (args.absentAfterMinutes !== undefined) {
      patch.absentAfterMinutes = Math.max(0, Math.min(240, args.absentAfterMinutes));
      // Phải > lateThresholdMinutes
      const lt = args.lateThresholdMinutes ?? (await ctx.db.get(args.sessionId))?.lateThresholdMinutes ?? 10;
      if ((patch.absentAfterMinutes as number) <= lt) {
        throw new ConvexError(`Ngưỡng vắng (${patch.absentAfterMinutes}p) phải lớn hơn ngưỡng đi muộn (${lt}p)`);
      }
    }
    if (args.officialStartAt !== undefined) {
      patch.officialStartAt = args.officialStartAt;
    }
    if (args.attendanceWebhookUrl !== undefined) {
      const url = args.attendanceWebhookUrl.trim();
      patch.attendanceWebhookUrl = url || undefined;
    }
    if (args.lmsSessionId !== undefined) {
      const id = args.lmsSessionId.trim();
      patch.lmsSessionId = id || undefined;
    }
    await ctx.db.patch(args.sessionId, patch);
  },
});
