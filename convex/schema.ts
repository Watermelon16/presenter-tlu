import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Một buổi giảng (phòng)
  sessions: defineTable({
    code: v.string(),                    // Mã phòng ngắn (6-8 ký tự), unique
    title: v.string(),                   // Tên buổi giảng
    hostName: v.optional(v.string()),    // Tên giảng viên (tạm thời)
    collectStudentCode: v.optional(v.boolean()),     // Bật/tắt thu thập mã sinh viên cho toàn buổi
    status: v.union(v.literal("active"), v.literal("ended")),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),

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
  })
    .index("by_code", ["code"])
    .index("by_created", ["createdAt"]),

  // Sinh viên tham gia phòng (danh tính)
  participants: defineTable({
    sessionId: v.id("sessions"),
    studentCode: v.string(),   // Mã sinh viên (bắt buộc khi thu thập)
    fullName: v.string(),
    className: v.string(),
    joinedAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_student", ["sessionId", "studentCode"]),

  // Hoạt động trong buổi giảng (Poll, Board, Q&A...)
  activities: defineTable({
    sessionId: v.id("sessions"),
    type: v.union(
      v.literal("poll"), 
      v.literal("wordcloud"),
      v.literal("rating"),
      v.literal("board"), 
      v.literal("qa")
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
  })
    .index("by_activity", ["activityId"])
    .index("by_activity_and_column", ["activityId", "columnId"]),

  // Kịch bản mẫu (lưu để tái sử dụng cho các buổi sau)
  scriptTemplates: defineTable({
    name: v.string(),
    hostId: v.optional(v.string()), // để sau này lọc theo người tạo
    activitiesSnapshot: v.array(v.any()), // snapshot các hoạt động (type, title, config, slideCue, timeLimit, requiresStudentCode, order)
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"]),
});