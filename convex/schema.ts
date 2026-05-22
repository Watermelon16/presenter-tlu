import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Convex Auth tables (users, accounts, sessions, etc.)
  ...authTables,

  // Profile thông tin GV — gắn 1-1 với users.
  // status: pending khi mới đăng ký, admin approve → approved.
  // role: admin (quản lý users), lecturer (chỉ session của mình).
  userProfiles: defineTable({
    userId: v.id("users"),
    email: v.string(),
    displayName: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("banned")
    ),
    role: v.union(v.literal("admin"), v.literal("lecturer")),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"]),

  // Một buổi giảng (phòng)
  sessions: defineTable({
    code: v.string(),                    // Mã phòng ngắn (6-8 ký tự), unique
    title: v.string(),                   // Tên buổi giảng
    hostName: v.optional(v.string()),    // Tên giảng viên (tạm thời)
    collectStudentCode: v.optional(v.boolean()),     // Bật/tắt thu thập mã sinh viên cho toàn buổi
    status: v.union(v.literal("active"), v.literal("ended")),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),

    // Owner — user tạo session (auth required). Sessions cũ chưa có sẽ migrate sau.
    ownerUserId: v.optional(v.id("users")),

    // === Script Runner (Kịch bản) - server state cho liền mạch PPT (B) ===
    isScriptRunning: v.optional(v.boolean()),        // Đang chạy kịch bản hay không
    currentScriptPosition: v.optional(v.number()),   // Vị trí hiện tại trong kịch bản (0-based index)

    // === Bảng thành tích (Gamification nhẹ) ===
    scoringConfig: v.optional(v.object({
      poll: v.number(),
      wordcloud: v.number(),
      rating: v.number(),
      board: v.number(),
      qa: v.number(),
      qaUpvote: v.number(),
    })),

    // === Slide PDF (thay thế PowerPoint — chiếu trong cùng tab browser) ===
    pdfStorageId: v.optional(v.id("_storage")),
    pdfFileName: v.optional(v.string()),
    pdfNumPages: v.optional(v.number()),
    pdfCurrentPage: v.optional(v.number()),  // Trang đang chiếu (sync giữa các tab)

    // === Phiên giảng (run) — 1 buổi giảng có thể chạy lại nhiều lần cho nhiều lớp ===
    // currentRun bắt đầu từ 1 và tăng mỗi lần "Bắt đầu phiên mới"
    // Records cũ không có field run → coi như run = 1 (backward compat)
    currentRun: v.optional(v.number()),

    // === Điểm danh (attendance) ===
    // officialStartAt: T0 — thời điểm tính giờ điểm danh. Auto-set khi SV ĐẦU TIÊN scan.
    // GV có thể set tay (epoch ms) để override.
    officialStartAt: v.optional(v.number()),
    // Ngưỡng đi muộn (phút). Default 10. T0..T0+ngưỡng = "Có mặt", sau đó = "Đi muộn".
    lateThresholdMinutes: v.optional(v.number()),
    // Webhook URL — Presenter sẽ POST attendance data tới đây mỗi lần SV scan (tùy chọn).
    attendanceWebhookUrl: v.optional(v.string()),
  })
    .index("by_code", ["code"])
    .index("by_created", ["createdAt"])
    .index("by_owner", ["ownerUserId"]),

  // Sinh viên tham gia phòng (danh tính)
  participants: defineTable({
    sessionId: v.id("sessions"),
    studentCode: v.string(),   // Mã sinh viên (bắt buộc khi thu thập)
    fullName: v.string(),
    className: v.string(),
    joinedAt: v.number(),

    // === Chống gian lận ===
    deviceId: v.optional(v.string()),         // Random UUID tạo trên client, lưu localStorage
    flagged: v.optional(v.boolean()),         // Có dấu hiệu bất thường (đổi thiết bị giữa chừng v.v.)
    flagReason: v.optional(v.string()),       // Lý do để giảng viên xem
    deviceChangeCount: v.optional(v.number()),// Số lần đổi thiết bị

    // === Phiên (run) — participant join trong phiên nào ===
    run: v.optional(v.number()),

    // === Điểm danh ===
    // Auto-compute khi join: present (≤T0+ngưỡng), late (>T0+ngưỡng).
    // GV override thủ công: excused, absent, early_leave.
    attendanceStatus: v.optional(v.union(
      v.literal("present"),     // Có mặt
      v.literal("late"),        // Đi muộn
      v.literal("excused"),     // Vắng có phép
      v.literal("absent"),      // Vắng không phép (auto khi kết thúc buổi, hoặc GV đánh tay)
      v.literal("early_leave")  // Về sớm
    )),
    // GV đã chỉnh tay → action tự động không override lại
    attendanceManualOverride: v.optional(v.boolean()),
    // Ghi chú (vd lý do vắng có phép)
    attendanceNote: v.optional(v.string()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_student", ["sessionId", "studentCode"])
    .index("by_session_and_device", ["sessionId", "deviceId"])
    .index("by_student", ["studentCode"]),

  // Hoạt động trong buổi giảng (Poll, Board, Q&A...)
  activities: defineTable({
    sessionId: v.id("sessions"),
    type: v.union(
      v.literal("poll"),
      v.literal("wordcloud"),
      v.literal("rating"),
      v.literal("board"),
      v.literal("qa"),
      v.literal("opentext")
    ),
    title: v.string(),                    // Tiêu đề hoạt động
    config: v.any(),                      // Cấu hình chi tiết (câu hỏi, lựa chọn, thang điểm...)
    
    requiresStudentCode: v.boolean(),     // Hoạt động này có yêu cầu mã sinh viên không
    timeLimit: v.optional(v.number()),    // Thời gian trả lời (tính bằng phút), null = không giới hạn

    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("closed"),
      v.literal("expired")
    ),

    order: v.number(),                    // Thứ tự trong kịch bản
    slideCue: v.optional(v.string()),     // Mốc slide PowerPoint (ví dụ: "Slide 7", "Sau slide 12")
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_order", ["sessionId", "order"]),

  // Phản hồi của sinh viên cho hoạt động
  responses: defineTable({
    activityId: v.id("activities"),
    sessionId: v.id("sessions"),
    studentCode: v.optional(v.string()),   // null nếu hoạt động không yêu cầu danh tính
    value: v.any(),                        // Dữ liệu trả lời (tùy loại activity)
    status: v.union(
      v.literal("answered"),
      v.literal("no_response")             // Tự động ghi nhận khi hết giờ
    ),
    submittedAt: v.number(),
    deviceId: v.optional(v.string()),      // Thiết bị submit — để chống làm bài hộ
    deviceMismatch: v.optional(v.boolean()),// Khác device của participant → flag

    // === Phiên (run) — response thuộc phiên nào ===
    run: v.optional(v.number()),

    // === AI chấm tự động cho opentext (config.referenceAnswer + enableAiGrading) ===
    aiGrade: v.optional(v.union(
      v.literal("correct"),
      v.literal("partial"),
      v.literal("wrong")
    )),
    aiGradeReason: v.optional(v.string()),   // 1 câu giải thích từ AI
    aiGradeModel: v.optional(v.string()),    // model nào chấm
    manualGrade: v.optional(v.boolean()),    // GV đã override grade
  })
    .index("by_activity", ["activityId"])
    .index("by_session_and_student", ["sessionId", "studentCode"]),

  // Bài đăng trên Board (kiểu Padlet) - tách riêng để hỗ trợ ảnh + cột + kéo thả sau này
  boardPosts: defineTable({
    activityId: v.id("activities"),
    sessionId: v.id("sessions"),
    studentCode: v.optional(v.string()),
    content: v.string(),                   // Nội dung text
    imageUrl: v.optional(v.string()),      // URL ảnh đã upload (Convex storage hoặc external)
    columnId: v.string(),                  // ID cột (ví dụ: "col1", "understood", ...)
    likes: v.number(),                     // Số lượt like
    status: v.union(v.literal("visible"), v.literal("hidden")),
    createdAt: v.number(),

    // === Phiên (run) — bài đăng thuộc phiên nào ===
    run: v.optional(v.number()),
  })
    .index("by_activity", ["activityId"])
    .index("by_activity_and_column", ["activityId", "columnId"]),

  // Web Push subscriptions — để gửi notification khi giảng viên kích hoạt activity
  pushSubscriptions: defineTable({
    sessionId: v.id("sessions"),
    studentCode: v.optional(v.string()),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_endpoint", ["endpoint"]),

  // Kịch bản mẫu (lưu để tái sử dụng cho các buổi sau)
  scriptTemplates: defineTable({
    name: v.string(),
    hostId: v.optional(v.string()), // để sau này lọc theo người tạo
    activitiesSnapshot: v.array(v.any()), // snapshot các hoạt động (type, title, config, slideCue, timeLimit, requiresStudentCode, order)
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"]),
});