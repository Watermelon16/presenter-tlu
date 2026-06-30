import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { aggregateWordCloud } from "../lib/wordcloud";
import { requireSessionOwner } from "./authz";

// Gửi câu trả lời cho một hoạt động
//
// CHỐNG GIAN LẬN: Lưu deviceId trên mỗi response. Nếu deviceId trên response
// khác với deviceId của participant (đăng ký lúc join) → mark deviceMismatch
// để giảng viên thấy "câu trả lời này có thể là người khác submit hộ".
export const submitResponse = mutation({
  args: {
    activityId: v.id("activities"),
    studentCode: v.optional(v.string()), // Bắt buộc nếu activity requiresStudentCode
    value: v.any(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) throw new Error("Không tìm thấy hoạt động");

    if (activity.status !== "active") {
      throw new Error("Hoạt động đã đóng hoặc hết hạn");
    }

    // Kiểm tra thời gian nếu có timeLimit
    if (activity.timeLimit && activity.startedAt) {
      const elapsedMinutes = (Date.now() - activity.startedAt) / (1000 * 60);
      if (elapsedMinutes > activity.timeLimit) {
        throw new Error("Đã hết thời gian trả lời hoạt động này");
      }
    }

    // Kiểm tra yêu cầu danh tính
    if (activity.requiresStudentCode && !args.studentCode) {
      throw new Error("Hoạt động này yêu cầu nhập mã sinh viên");
    }

    // Kiểm tra đã trả lời chưa (theo PHIÊN HIỆN TẠI — phiên mới SV được trả lời lại)
    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;
    const runForCheck = currentRun;
    if (args.studentCode) {
      const existings = await ctx.db
        .query("responses")
        .withIndex("by_session_and_student", (q) =>
          q
            .eq("sessionId", activity.sessionId)
            .eq("studentCode", args.studentCode)
        )
        .filter((q) => q.eq(q.field("activityId"), args.activityId))
        .collect();

      const existingInCurrentRun = existings.find((r) => (r.run ?? 1) === runForCheck);
      if (existingInCurrentRun) {
        throw new Error("Bạn đã trả lời hoạt động này rồi");
      }
    } else if (args.deviceId && (activity.type === "poll" || activity.type === "rating" || activity.type === "survey")) {
      // Dedupe anonymous: poll/rating/survey tính 1 lần / device để không làm méo kết quả.
      // Wordcloud/qa/board cho phép multi-submit (brainstorm/Q&A nhiều câu).
      const allForActivity = await ctx.db
        .query("responses")
        .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
        .collect();
      const dupeInRun = allForActivity.find(
        (r) => (r.run ?? 1) === runForCheck && r.deviceId === args.deviceId
      );
      if (dupeInRun) {
        throw new Error("Thiết bị này đã gửi câu trả lời rồi");
      }
    }

    // Check deviceId mismatch (chống làm bài hộ)
    let deviceMismatch: boolean | undefined = undefined;
    if (args.deviceId && args.studentCode) {
      const participant = await ctx.db
        .query("participants")
        .withIndex("by_session_and_student", (q) =>
          q.eq("sessionId", activity.sessionId).eq("studentCode", args.studentCode!)
        )
        .first();

      if (participant?.deviceId && participant.deviceId !== args.deviceId) {
        deviceMismatch = true;
        // Cũng flag participant để giảng viên dễ thấy
        await ctx.db.patch(participant._id, {
          flagged: true,
          flagReason: participant.flagReason || "Câu trả lời gửi từ thiết bị khác với thiết bị đã đăng ký",
        });
      }
    }

    await ctx.db.insert("responses", {
      activityId: args.activityId,
      sessionId: activity.sessionId,
      studentCode: args.studentCode,
      value: args.value,
      status: "answered",
      submittedAt: Date.now(),
      deviceId: args.deviceId,
      deviceMismatch,
      run: currentRun,
    });

    return { success: true, deviceMismatch: !!deviceMismatch };
  },
});

/**
 * Lịch sử SV: danh sách tất cả activity (trừ draft) trong buổi + câu trả lời của SV,
 * thống kê tổng (số response, my rank). Dùng cho giao diện sinh viên.
 */
export const getMyHistoryInSession = query({
  args: {
    sessionId: v.id("sessions"),
    studentCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.studentCode) {
      return { items: [], stats: { participatedCount: 0, totalAnswered: 0, totalActivities: 0 }, run: 1 };
    }

    const session = await ctx.db.get(args.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const visible = activities
      .filter((a) => a.status !== "draft")
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    // Tất cả responses của SV — filter theo phiên hiện tại
    const myAllResponses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentCode", args.studentCode)
      )
      .collect();
    const myResponses = myAllResponses.filter((r) => (r.run ?? 1) === currentRun);

    const responseByActivity = new Map(myResponses.map((r) => [r.activityId, r]));

    // Board posts của SV — filter theo phiên
    const allBoardPosts = await ctx.db
      .query("boardPosts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("studentCode"), args.studentCode))
      .collect();
    const boardPosts = allBoardPosts.filter((p) => (p.run ?? 1) === currentRun);

    const boardPostsByActivity = new Map<string, typeof boardPosts>();
    for (const p of boardPosts) {
      const arr = boardPostsByActivity.get(p.activityId) || [];
      arr.push(p);
      boardPostsByActivity.set(p.activityId, arr);
    }

    // Đếm tổng response — filter theo phiên
    const allResponsesRaw = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const allResponses = allResponsesRaw.filter((r) => (r.run ?? 1) === currentRun);

    const totalResponseCountByActivity = new Map<string, number>();
    for (const r of allResponses) {
      if (r.status === "answered") {
        totalResponseCountByActivity.set(
          r.activityId,
          (totalResponseCountByActivity.get(r.activityId) || 0) + 1
        );
      }
    }

    // Poll breakdown — đếm vote per option để SV xem stats lớp khi activity đã đóng
    const pollBreakdownByActivity = new Map<string, Record<string, number>>();
    for (const act of visible.filter((a) => a.type === "poll")) {
      const counts: Record<string, number> = {};
      for (const r of allResponses.filter((x) => x.activityId === act._id && x.status === "answered")) {
        // Poll lưu { choiceIds: [...] } (legacy: selectedOptions). Đọc cả hai.
        const v = r.value as { choiceIds?: string[]; selectedOptions?: string[] } | undefined;
        for (const id of v?.choiceIds ?? v?.selectedOptions ?? []) {
          counts[id] = (counts[id] ?? 0) + 1;
        }
      }
      pollBreakdownByActivity.set(act._id as unknown as string, counts);
    }

    // Wordcloud breakdown — top từ + count (gom trùng ý như màn trình chiếu)
    const wordcloudBreakdownByActivity = new Map<string, Array<{ word: string; count: number }>>();
    for (const act of visible.filter((a) => a.type === "wordcloud")) {
      const texts = allResponses
        .filter((x) => x.activityId === act._id && x.status === "answered")
        .map((r) => (typeof r.value === "string" ? r.value : ""));
      const top = aggregateWordCloud(texts).slice(0, 20);
      wordcloudBreakdownByActivity.set(act._id as unknown as string, top);
    }

    // Rating breakdown — average
    const ratingBreakdownByActivity = new Map<string, { average: number; count: number; distribution: Record<number, number> }>();
    for (const act of visible.filter((a) => a.type === "rating")) {
      const ratings: number[] = [];
      const dist: Record<number, number> = {};
      for (const r of allResponses.filter((x) => x.activityId === act._id && x.status === "answered")) {
        const v = (r.value as { rating?: number })?.rating;
        if (typeof v === "number") {
          ratings.push(v);
          dist[v] = (dist[v] ?? 0) + 1;
        }
      }
      const avg = ratings.length > 0 ? ratings.reduce((s, n) => s + n, 0) / ratings.length : 0;
      ratingBreakdownByActivity.set(act._id as unknown as string, {
        average: Math.round(avg * 10) / 10,
        count: ratings.length,
        distribution: dist,
      });
    }

    const items = visible.map((act) => {
      const myResp = responseByActivity.get(act._id) || null;
      const myBoard = boardPostsByActivity.get(act._id) || [];
      const hasParticipated = !!myResp || myBoard.length > 0;
      const actIdStr = act._id as unknown as string;

      return {
        _id: act._id,
        title: act.title,
        type: act.type,
        status: act.status,
        order: act.order,
        slideCue: act.slideCue,
        requiresStudentCode: act.requiresStudentCode,
        startedAt: act.startedAt,
        closedAt: act.closedAt,
        timeLimit: act.timeLimit,
        config: act.config,
        myResponse: myResp,
        myBoardPosts: myBoard,
        hasParticipated,
        totalAnswers: totalResponseCountByActivity.get(act._id) || 0,
        // Breakdown để replay (chỉ có giá trị khi activity đã closed/expired)
        pollBreakdown: pollBreakdownByActivity.get(actIdStr) ?? null,
        wordcloudTop: wordcloudBreakdownByActivity.get(actIdStr) ?? null,
        ratingBreakdown: ratingBreakdownByActivity.get(actIdStr) ?? null,
      };
    });

    const participatedCount = items.filter((i) => i.hasParticipated).length;
    const totalAnswered = items.filter((i) => i.myResponse?.status === "answered").length;

    return {
      items,
      stats: {
        participatedCount,
        totalAnswered,
        totalActivities: items.length,
      },
      run: currentRun,
    };
  },
});

// Lấy câu trả lời của 1 SV cho 1 hoạt động (dùng để hiển thị "đã trả lời" + chống submit lại)
export const getMyResponse = query({
  args: {
    activityId: v.id("activities"),
    studentCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.studentCode) return null;

    const activity = await ctx.db.get(args.activityId);
    if (!activity) return null;

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const candidates = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", activity.sessionId).eq("studentCode", args.studentCode)
      )
      .filter((q) => q.eq(q.field("activityId"), args.activityId))
      .collect();

    // Chỉ trả response thuộc phiên hiện tại (để SV không bị chặn submit khi phiên mới)
    return candidates.find((r) => (r.run ?? 1) === currentRun) ?? null;
  },
});

// Lấy kết quả của một hoạt động (dành cho giảng viên)
export const getActivityResponses = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return [];
    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const all = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    return all.filter((r) => (r.run ?? 1) === currentRun);
  },
});

// Lấy kết quả chi tiết, phân loại rõ ràng (Answered vs No Response)
export const getActivityResults = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();

    const answered = responses.filter((r) => r.status === "answered");
    const noResponse = responses.filter((r) => r.status === "no_response");

    return {
      answered,
      noResponse,
      totalAnswered: answered.length,
      totalNoResponse: noResponse.length,
    };
  },
});

// Lấy kết quả Word Cloud (gom tần suất từ)
export const getWordCloudResults = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return { words: [], totalResponses: 0 };
    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const all = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .filter((q) => q.eq(q.field("status"), "answered"))
      .collect();
    const responses = all.filter((r) => (r.run ?? 1) === currentRun);

    // Gom từ trùng ý: không phân biệt hoa/thường, có dấu/không dấu, lỗi gõ 1 ký tự
    const results = aggregateWordCloud(
      responses.map((r) => (typeof r.value === "string" ? r.value : ""))
    );

    return {
      words: results,
      totalResponses: responses.length,
    };
  },
});

// Lấy kết quả Rating / Thang điểm
export const getRatingResults = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return { distribution: {}, average: 0, total: 0 };
    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const all = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .filter((q) => q.eq(q.field("status"), "answered"))
      .collect();
    const responses = all.filter((r) => (r.run ?? 1) === currentRun);

    const distribution: Record<number, number> = {};
    let sum = 0;

    for (const res of responses) {
      // Hỗ trợ cả format mới { rating: number } lẫn legacy number
      let val: number;
      const v = res.value;
      if (v && typeof v === "object" && typeof (v as { rating?: unknown }).rating === "number") {
        val = (v as { rating: number }).rating;
      } else {
        val = Number(v);
      }
      if (isNaN(val)) continue;
      distribution[val] = (distribution[val] || 0) + 1;
      sum += val;
    }

    const total = responses.length;
    const average = total > 0 ? sum / total : 0;

    return {
      distribution,
      average: Math.round(average * 10) / 10,
      total,
    };
  },
});

// Upvote một câu hỏi trong Q&A
export const upvoteQuestion = mutation({
  args: { responseId: v.id("responses") },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.responseId);
    if (!response) return;

    // Tăng số upvote (lưu trong value nếu là Q&A)
    const currentValue = response.value;
    let newValue = currentValue;

    if (typeof currentValue === "object" && currentValue !== null) {
      newValue = {
        ...currentValue,
        upvotes: (currentValue.upvotes || 0) + 1,
      };
    } else {
      // Trường hợp cũ: value là string → chuyển thành object
      newValue = {
        text: currentValue,
        upvotes: 1,
      };
    }

    await ctx.db.patch(args.responseId, { value: newValue });
  },
});

// Giảng viên trả lời câu hỏi trong Q&A
export const answerQaQuestion = mutation({
  args: {
    responseId: v.id("responses"),
    answer: v.string(),
  },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.responseId);
    if (!response) return;
    await requireSessionOwner(ctx, response.sessionId);

    let newValue = response.value;

    // Chuẩn hóa value thành object nếu đang là string
    if (typeof newValue === "string") {
      newValue = { text: newValue, upvotes: 0, status: "visible" };
    } else if (typeof newValue === "object" && newValue !== null) {
      newValue = { ...newValue };
    } else {
      return;
    }

    const trimmed = args.answer.trim();

    if (trimmed.length === 0) {
      // Xóa câu trả lời → bỏ answer và quay về trạng thái visible (hoặc giữ nguyên status trước đó nếu muốn)
      delete newValue.answer;
      newValue.status = "visible";
    } else {
      newValue.answer = trimmed;
      newValue.status = "answered";
    }

    await ctx.db.patch(args.responseId, {
      value: newValue,
    });
  },
});

// Hàm hỗ trợ: Tạo bản ghi "Không trả lời" cho những sinh viên đã có mã trong buổi
export const createNoResponseRecords = internalMutation({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return;

    // Chỉ áp dụng cho hoạt động yêu cầu danh tính
    if (!activity.requiresStudentCode) return;

    // Lấy tất cả participant đã cung cấp mã sinh viên trong session này
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", activity.sessionId))
      .collect();

    // Lấy những người đã trả lời hoạt động này
    const existingResponses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    // Lọc participants + responses theo run hiện tại
    const currentParticipants = participants.filter((p) => (p.run ?? 1) === currentRun);
    const respondedCodes = new Set(
      existingResponses
        .filter((r) => r.studentCode && (r.run ?? 1) === currentRun)
        .map((r) => r.studentCode)
    );

    // Tạo no_response cho những người chưa trả lời trong phiên hiện tại
    for (const participant of currentParticipants) {
      if (!respondedCodes.has(participant.studentCode)) {
        await ctx.db.insert("responses", {
          activityId: args.activityId,
          sessionId: activity.sessionId,
          studentCode: participant.studentCode,
          value: null,
          status: "no_response",
          submittedAt: Date.now(),
          run: currentRun,
        });
      }
    }
  },
});

// ============================================
// Các query hỗ trợ UI (dành cho giảng viên)
// ============================================

// Lấy danh sách sinh viên đã tham gia buổi (có mã sinh viên) — phiên hiện tại
export const listSessionParticipants = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const currentRun = session?.currentRun ?? 1;
    const all = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
    return all.filter((p) => (p.run ?? 1) === currentRun);
  },
});

// Thống kê nhanh cho Poll (đếm số vote mỗi lựa chọn)
export const getPollVoteCounts = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity || activity.type !== "poll") {
      return { options: [], totalAnswered: 0 };
    }

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .filter((q) => q.eq(q.field("status"), "answered"))
      .collect();

    // Lọc theo phiên hiện tại (undefined = run 1, backward compat)
    const responses = allResponses.filter((r) => (r.run ?? 1) === currentRun);

    const config = activity.config as { options?: { id: string; text: string }[] } | undefined;
    const options = config?.options || [];

    const counts: Record<string, number> = {};

    // Khởi tạo count = 0 cho mọi lựa chọn
    options.forEach((opt) => {
      counts[opt.id] = 0;
    });

    // Đếm vote — hỗ trợ cả format mới {choiceIds:[...]} lẫn legacy (string hoặc array)
    responses.forEach((res) => {
      let choiceIds: string[] = [];
      const v = res.value;
      if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { choiceIds?: unknown }).choiceIds)) {
        choiceIds = (v as { choiceIds: string[] }).choiceIds;
      } else if (Array.isArray(v)) {
        choiceIds = v as string[];
      } else if (typeof v === "string") {
        choiceIds = [v];
      }
      choiceIds.forEach((choiceId) => {
        if (counts[choiceId] !== undefined) {
          counts[choiceId]++;
        }
      });
    });

    return {
      options: options.map((opt) => ({
        id: opt.id,
        text: opt.text,
        count: counts[opt.id] || 0,
      })),
      totalAnswered: responses.length,
    };
  },
});

// Lấy trạng thái tham gia của từng sinh viên cho một hoạt động
export const getActivityParticipationStatus = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return [];

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const allParticipants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", activity.sessionId))
      .collect();
    const participants = allParticipants.filter((p) => (p.run ?? 1) === currentRun);

    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    const responses = allResponses.filter((r) => (r.run ?? 1) === currentRun);

    const responseMap = new Map(
      responses.map((r) => [r.studentCode, r])
    );

    return participants.map((p) => {
      const response = responseMap.get(p.studentCode);
      return {
        studentCode: p.studentCode,
        fullName: p.fullName,
        className: p.className,
        hasResponded: !!response && response.status === "answered",
        responseStatus: response?.status ?? "no_response",
        submittedAt: response?.submittedAt,
      };
    });
  },
});

// ============================================
// Query chi tiết cho UI (ưu tiên 1 & 2)
// ============================================

/**
 * Lấy kết quả chi tiết của một Poll.
 * Hỗ trợ tốt nhiều loại: trắc nghiệm, thang điểm, word cloud, trả lời mở.
 */
export const getDetailedPollResults = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity || activity.type !== "poll") {
      return null;
    }

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    const responses = allResponses.filter((r) => (r.run ?? 1) === currentRun);

    const answeredResponses = responses.filter((r) => r.status === "answered");
    const noResponseCount = responses.filter((r) => r.status === "no_response").length;

    const config = activity.config as any;
    const pollType = config?.type || "multiple_choice"; // multiple_choice | rating | open_text | word_cloud

    let result: any = {
      activityId: args.activityId,
      pollType,
      totalAnswered: answeredResponses.length,
      totalNoResponse: noResponseCount,
      requiresStudentCode: activity.requiresStudentCode,
    };

    if (pollType === "multiple_choice" || pollType === "single_choice") {
      const options: { id: string; text: string }[] = config?.options || [];
      const counts: Record<string, number> = {};
      options.forEach((opt: any) => (counts[opt.id] = 0));

      answeredResponses.forEach((res) => {
        const value = res.value as { choiceIds?: string[] };
        value?.choiceIds?.forEach((id) => {
          if (counts[id] !== undefined) counts[id]++;
        });
      });

      result.options = options.map((opt: any) => ({
        id: opt.id,
        text: opt.text,
        count: counts[opt.id] || 0,
      }));

      // Nếu yêu cầu danh tính, trả thêm danh sách người chọn từng option
      if (activity.requiresStudentCode) {
        const votersByOption: Record<string, any[]> = {};
        options.forEach((opt: any) => (votersByOption[opt.id] = []));

        // Lấy thông tin sinh viên
        const studentCodes = answeredResponses
          .map((r) => r.studentCode)
          .filter(Boolean) as string[];

        const participants = await ctx.db
          .query("participants")
          .withIndex("by_session", (q) => q.eq("sessionId", activity.sessionId))
          .collect();

        const participantMap = new Map(participants.map((p) => [p.studentCode, p]));

        answeredResponses.forEach((res) => {
          const value = res.value as { choiceIds?: string[] };
          const student = res.studentCode ? participantMap.get(res.studentCode) : null;

          value?.choiceIds?.forEach((choiceId) => {
            if (votersByOption[choiceId]) {
              votersByOption[choiceId].push({
                studentCode: res.studentCode,
                fullName: student?.fullName || "",
                className: student?.className || "",
                submittedAt: res.submittedAt,
              });
            }
          });
        });

        result.votersByOption = votersByOption;
      }
    } 
    else if (pollType === "rating" || pollType === "scale") {
      const values = answeredResponses
        .map((r) => (r.value as { rating?: number })?.rating)
        .filter((v): v is number => typeof v === "number");

      const sum = values.reduce((a, b) => a + b, 0);
      result.average = values.length > 0 ? +(sum / values.length).toFixed(2) : 0;
      result.distribution = values;

      if (activity.requiresStudentCode) {
        const participants = await ctx.db
          .query("participants")
          .withIndex("by_session", (q) => q.eq("sessionId", activity.sessionId))
          .collect();
        const participantMap = new Map(participants.map((p) => [p.studentCode, p]));

        result.answers = answeredResponses.map((res) => {
          const student = res.studentCode ? participantMap.get(res.studentCode) : null;
          return {
            studentCode: res.studentCode,
            fullName: student?.fullName || "",
            className: student?.className || "",
            rating: (res.value as any)?.rating,
            submittedAt: res.submittedAt,
          };
        });
      }
    } 
    else {
      // word_cloud hoặc open_text
      if (activity.requiresStudentCode) {
        const participants = await ctx.db
          .query("participants")
          .withIndex("by_session", (q) => q.eq("sessionId", activity.sessionId))
          .collect();
        const participantMap = new Map(participants.map((p) => [p.studentCode, p]));

        result.answers = answeredResponses.map((res) => {
          const student = res.studentCode ? participantMap.get(res.studentCode) : null;
          return {
            studentCode: res.studentCode,
            fullName: student?.fullName || "",
            className: student?.className || "",
            text: (res.value as any)?.text || res.value,
            submittedAt: res.submittedAt,
          };
        });
      } else {
        result.answers = answeredResponses.map((res) => ({
          text: (res.value as any)?.text || res.value,
          submittedAt: res.submittedAt,
        }));
      }
    }

    return result;
  },
});

/**
 * KHẢO SÁT (type="survey"): trả về config + danh sách phản hồi thô (mỗi SV 1 bản
 * ghi: answers theo từng câu) + danh tính nếu yêu cầu. Client tự tổng hợp bằng
 * lib/survey.aggregateSurvey để render thống kê per câu, phân tích AI và export.
 */
export const getSurveyResponses = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity || activity.type !== "survey") return null;

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    const responses = allResponses.filter((r) => (r.run ?? 1) === currentRun);
    const answered = responses.filter((r) => r.status === "answered");
    const totalNoResponse = responses.filter((r) => r.status === "no_response").length;

    // Map danh tính nếu khảo sát có yêu cầu mã SV
    let participantMap: Map<string, { fullName: string; className: string }> | null = null;
    if (activity.requiresStudentCode) {
      const participants = await ctx.db
        .query("participants")
        .withIndex("by_session", (q) => q.eq("sessionId", activity.sessionId))
        .collect();
      participantMap = new Map(
        participants.map((p) => [p.studentCode, { fullName: p.fullName, className: p.className }])
      );
    }

    return {
      activityId: args.activityId,
      title: activity.title,
      config: activity.config ?? null,
      requiresStudentCode: activity.requiresStudentCode,
      totalRespondents: answered.length,
      totalNoResponse,
      responses: answered.map((r) => {
        const ident = r.studentCode && participantMap ? participantMap.get(r.studentCode) : null;
        const val = (r.value ?? {}) as { answers?: Record<string, unknown> };
        return {
          studentCode: r.studentCode ?? null,
          fullName: ident?.fullName ?? "",
          className: ident?.className ?? "",
          answers: val.answers ?? {},
          submittedAt: r.submittedAt,
        };
      }),
    };
  },
});

/**
 * Lấy toàn bộ phản hồi của một hoạt động, đã kèm thông tin sinh viên (nếu có).
 * Rất hữu ích để xuất Excel hoặc hiển thị bảng chi tiết.
 */
export const getActivityResponsesWithStudents = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return [];

    const session = await ctx.db.get(activity.sessionId);
    const currentRun = session?.currentRun ?? 1;

    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_activity", (q) => q.eq("activityId", args.activityId))
      .collect();
    const responses = allResponses.filter((r) => (r.run ?? 1) === currentRun);

    if (!activity.requiresStudentCode) {
      return responses.map((r) => ({
        ...r,
        studentInfo: null,
      }));
    }

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", activity.sessionId))
      .collect();

    const participantMap = new Map(participants.map((p) => [p.studentCode, p]));

    return responses.map((r) => {
      const student = r.studentCode ? participantMap.get(r.studentCode) : null;
      return {
        ...r,
        studentInfo: student
          ? {
              studentCode: student.studentCode,
              fullName: student.fullName,
              className: student.className,
            }
          : null,
      };
    });
  },
});

// ============================================
// EXPORT DATA - Dành cho xuất kết quả buổi giảng (Excel/CSV)
// ============================================

/**
 * Lấy toàn bộ dữ liệu để xuất kết quả theo sinh viên.
 * Rất hữu ích để giảng viên chấm điểm tham gia.
 */
export const getSessionFullExport = query({
  args: {
    sessionId: v.id("sessions"),
    run: v.optional(v.number()), // mặc định: phiên hiện tại
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const targetRun = args.run ?? session?.currentRun ?? 1;

    // Lấy participants của phiên target
    const allParticipants = await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
    const participants = allParticipants.filter((p) => (p.run ?? 1) === targetRun);

    // Lấy tất cả hoạt động theo thứ tự
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const sortedActivities = activities.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    // Lấy responses của phiên target
    const allResponses = await ctx.db
      .query("responses")
      .withIndex("by_session_and_student", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const filteredResponses = allResponses.filter((r) => (r.run ?? 1) === targetRun);

    // Lấy board posts của phiên target
    const allBoardPostsRaw = await ctx.db
      .query("boardPosts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const allBoardPosts = allBoardPostsRaw.filter((p) => (p.run ?? 1) === targetRun);

    // Gom responses theo studentCode + activityId
    const responseMap = new Map<string, any>(); // key = `${studentCode}:${activityId}`

    filteredResponses.forEach((res) => {
      if (res.studentCode) {
        const key = `${res.studentCode}:${res.activityId}`;
        responseMap.set(key, res);
      }
    });

    // Gom board posts theo studentCode
    const boardPostsByStudent = new Map<string, any[]>();
    allBoardPosts.forEach((post) => {
      if (post.studentCode) {
        if (!boardPostsByStudent.has(post.studentCode)) {
          boardPostsByStudent.set(post.studentCode, []);
        }
        boardPostsByStudent.get(post.studentCode)!.push(post);
      }
    });

    // Xây dựng dữ liệu export cho từng sinh viên
    const students = participants.map((p) => {
      const studentResponses: any = {};

      sortedActivities.forEach((act) => {
        const key = `${p.studentCode}:${act._id}`;
        const res = responseMap.get(key);

        if (res) {
          studentResponses[act._id] = {
            status: res.status,
            value: res.value,
            submittedAt: res.submittedAt,
          };
        } else {
          studentResponses[act._id] = {
            status: "no_response",
            value: null,
            submittedAt: null,
          };
        }
      });

      // Board stats
      const posts = boardPostsByStudent.get(p.studentCode) || [];
      const boardStats = {
        postCount: posts.length,
        totalLikes: posts.reduce((sum, p) => sum + (p.likes || 0), 0),
      };

      return {
        studentCode: p.studentCode,
        fullName: p.fullName,
        className: p.className,
        joinedAt: p.joinedAt,
        responses: studentResponses,
        boardStats,
        attendanceStatus: p.attendanceStatus ?? null,
        attendanceNote: p.attendanceNote ?? null,
        attendanceManualOverride: p.attendanceManualOverride ?? false,
        isGuest: p.isGuest ?? false,
      };
    });

    return {
      activities: sortedActivities.map((a) => ({
        _id: a._id,
        title: a.title,
        type: a.type,
        order: a.order,
        requiresStudentCode: a.requiresStudentCode,
      })),
      students,
      run: targetRun,
      officialStartAt: session?.officialStartAt ?? null,
      attendanceOpenAt: session?.attendanceOpenAt ?? null,
      lateThresholdMinutes: session?.lateThresholdMinutes ?? 10,
      absentAfterMinutes: session?.absentAfterMinutes ?? 50,
    };
  },
});

// ============================================
// Q&A Moderation (dành cho giảng viên)
// ============================================

export const setQaQuestionStatus = mutation({
  args: {
    responseId: v.id("responses"),
    status: v.union(v.literal("visible"), v.literal("hidden"), v.literal("answered")),
  },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.responseId);
    if (!response) return;
    await requireSessionOwner(ctx, response.sessionId);

    let newValue = response.value;
    if (typeof newValue === "string") {
      newValue = { text: newValue, upvotes: 0, status: args.status };
    } else if (typeof newValue === "object" && newValue !== null) {
      newValue = { ...newValue, status: args.status };
    } else {
      return;
    }

    await ctx.db.patch(args.responseId, { value: newValue });
  },
});

export const deleteQaQuestion = mutation({
  args: { responseId: v.id("responses") },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.responseId);
    if (!response) return;
    await requireSessionOwner(ctx, response.sessionId);
    await ctx.db.delete(args.responseId);
  },
});
