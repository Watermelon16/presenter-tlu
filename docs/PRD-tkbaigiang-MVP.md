# PRD – TK Bài Giảng (MVP)

**Phiên bản:** 1.0  
**Ngày:** Tháng 4/2026  
**Trạng thái:** Đã tổng hợp từ kế hoạch đã phê duyệt + tất cả phản hồi người dùng  
**Quy trình:** Vibe-Coding Workflow (Bước 2 – PRD)  
**Ngôn ngữ:** Tiếng Việt (tuân thủ PROJECT_RULES.md)

---

## 1. Product Overview (Tổng quan sản phẩm)

### Tên sản phẩm
**TK Bài Giảng** (Toolkit Bài Giảng / Tương Tác Bài Giảng)

### Tagline
Công cụ tương tác giảng dạy thời gian thực – kết hợp Mentimeter + Padlet, hỗ trợ workflow kịch bản với bài giảng PowerPoint, dễ dàng tùy chỉnh và tự động hóa đánh giá điểm cho giảng viên Việt Nam.

### Mục tiêu chính của MVP
Xây dựng một nền tảng web cho phép giảng viên:
- Tạo buổi giảng tương tác với nhiều công cụ (Poll, Board, Q&A, Word Cloud...).
- Thiết kế **kịch bản (scripted workflow)** có thứ tự logic, kết hợp mượt mà với bài giảng PowerPoint.
- Thu thập thông tin sinh viên (Mã sinh viên + Họ tên + Lớp) một cách dễ dàng.
- Tự động lưu toàn bộ hoạt động và hỗ trợ **đánh giá điểm / phản hồi** thuận tiện, tự động hóa cao.
- Tùy chỉnh mạnh (đặc biệt custom activity templates).
- Chạy ổn định cho lớp dưới 50 người, trên môi trường học thuật.

### Timeline mục tiêu MVP
8–12 tuần (sử dụng Vibe-Coding Workflow + AI agent hỗ trợ).

### Giá trị cốt lõi
- Toàn quyền kiểm soát và tùy chỉnh cao.
- Tiếng Việt 100%.
- Tự động hóa tối đa cho giảng viên (giảm thủ công).
- Dễ chạy local/demo trước khi quyết định triển khai rộng.
- Chi phí gần như miễn phí ở giai đoạn đầu (Convex Free tier).

---

## 2. Target Users & Persona (Người dùng mục tiêu)

### Persona chính (Primary)
**Giảng viên đại học / cao đẳng** (30–45 tuổi)
- Dạy 1–2 lớp lớn (30–50 sinh viên) mỗi học kỳ.
- Thường sử dụng PowerPoint làm nền tảng chính cho bài giảng.
- Đang gặp khó khăn với các công cụ hiện tại:
  - Mentimeter, Wooclap, Slido: Đắt, ít tùy chỉnh, không hỗ trợ tốt board + workflow kịch bản.
  - Padlet: Board đẹp nhưng thiếu poll mạnh và công cụ đánh giá điểm.
  - Không có công cụ nào hỗ trợ tốt việc **kết hợp PPT + nhiều hoạt động tương tác theo kịch bản có thứ tự**.
  - Khó theo dõi và đánh giá điểm/reaction của từng sinh viên sau buổi.

**Nhu cầu cốt lõi:**
- Muốn có **nhiều công cụ tương tác** (poll, word cloud xem xu hướng, board, Q&A...).
- Muốn **dễ dàng tạo kịch bản** để hoạt động diễn ra trơn tru mà không phải chuyển nền tảng liên tục.
- Muốn **tự động lưu mọi hoạt động** và có giao diện đánh giá điểm thuận tiện, ít làm thủ công.
- Muốn **tùy chỉnh** hoạt động theo đúng phong cách giảng dạy của mình.
- Phong cách sử dụng: Học thuật, chuyên nghiệp, rõ ràng.

### Persona phụ
- Trợ giảng, giáo viên THPT tổ chức hoạt động nhóm.
- Trainer nội bộ doanh nghiệp (ít ưu tiên hơn ở MVP).

---

## 3. Problem Statement (Vấn đề cần giải quyết)

Giảng viên Việt Nam cần một công cụ **lai ghép mạnh** giữa các tính năng của Mentimeter (realtime poll + word cloud) và Padlet (board cộng tác), nhưng vượt trội ở các điểm sau:

- Hỗ trợ tạo **kịch bản (scripted workflow)** có thứ tự để kết hợp mượt mà với bài giảng PowerPoint, giảm tối đa việc chuyển đổi nền tảng.
- **Tự động lưu toàn bộ hoạt động** và hỗ trợ đánh giá điểm / phản hồi sinh viên một cách thuận tiện, tự động hóa cao.
- Bắt buộc thu thập thông tin sinh viên (Mã SV + Họ tên + Lớp) một cách dễ dàng và logic.
- Mức độ tùy chỉnh thực sự cao (đặc biệt custom activity templates).
- Giao diện tiếng Việt, phong cách học thuật, phù hợp môi trường đại học.
- Dễ chạy local, chi phí thấp.

Các giải pháp hiện tại đều thiếu một hoặc nhiều yếu tố trên.

---

## 4. User Journey (Hành trình người dùng – Happy Path MVP)

1. **Giảng viên** truy cập → Đăng nhập (email/magic link) → Tạo phòng mới (đặt tên buổi, chọn theme cơ bản).
2. Nhận **mã phòng 6-8 ký tự + QR code** → Chiếu QR lên màn hình máy chiếu.
3. **Sinh viên** quét QR bằng điện thoại → Nhập nhanh **Mã sinh viên + Họ tên + Lớp** (form đơn giản, lần sau có thể tự động điền) → Vào phòng.
4. **Giảng viên** tạo **kịch bản (scripted workflow)** có thứ tự logic:
   - Ví dụ: Slide 5 PPT → Word Cloud (xem xu hướng trả lời) → Slide 12 PPT → Board phản hồi nhanh → Q&A tổng hợp.
5. Trong buổi giảng: Chạy kịch bản → Chuyển hoạt động theo thứ tự (có gợi ý mốc slide PPT) → Sinh viên tham gia realtime → Kết quả hiện ngay.
6. Mọi hoạt động (poll, board posts, Q&A, phản hồi) được **tự động lưu đầy đủ**, gắn với từng sinh viên.
7. Kết thúc buổi: Giảng viên vào giao diện đánh giá → Xem, lọc, chấm điểm / nhận xét nhanh → Export PDF (báo cáo đẹp) + Excel (dữ liệu điểm thô).
8. Lưu các hoạt động thành **Template tùy chỉnh** để tái sử dụng cho các buổi sau.

---

## 5. MVP Features (Tính năng MVP – MoSCoW)

### Must Have (P0 – Bắt buộc cho MVP)

- Tạo/Tham gia phòng với mã + QR.
- **Thu thập danh tính sinh viên**: Bắt buộc nhập Mã sinh viên + Họ tên + Lớp khi tham gia (dễ dùng, có thể lưu lần sau).
- **Nhiều công cụ tương tác realtime**:
  - Poll: Trắc nghiệm (single/multi), Thang điểm, **Word Cloud (xem xu hướng trả lời nổi bật)**, Trả lời mở.
  - Board cộng tác: Text + ảnh, like/reaction, hiển thị theo cột/list, realtime.
  - Live Q&A với upvote + moderation cơ bản.
- **Workflow Kịch bản (Scripted Sequence)**: Tạo kịch bản có thứ tự, kết hợp mượt với bài giảng PPT (gợi ý mốc slide). Đây là tính năng then chốt để giảm chuyển đổi nền tảng.
- **Lưu trữ & Đánh giá tự động**: Tất cả hoạt động được tự động lưu đầy đủ theo từng sinh viên. Giảng viên có giao diện xem, lọc, đánh giá điểm thuận tiện, tối đa tự động hóa (ít làm thủ công).
- Presenter dashboard đầy đủ: Danh sách hoạt động + kịch bản, chuyển theo thứ tự, lock/reset, hide/show kết quả, fullscreen (cho máy chiếu).
- Theme cơ bản per session (màu, logo, background, header).
- Export kết quả: PDF (báo cáo + biểu đồ) + Excel (dữ liệu thô + điểm).
- **Custom Activity Template** (ưu tiên cao nhất): Giảng viên dễ dàng tạo, lưu, chỉnh sửa và tái sử dụng các mẫu hoạt động theo phong cách riêng (hỗ trợ nhiều loại công cụ tương tác).

### Should Have (P1)

- Lịch sử các buổi giảng trước (dễ xem lại và đánh giá).
- Bộ 5–7 templates mẫu sẵn phù hợp môi trường học thuật.
- PWA (cài như app trên điện thoại sinh viên).

### Could Have (P2 – Sau MVP)

- Free canvas kéo thả cho Board.
- Hàng chờ phê duyệt nội dung (moderation queue).
- Tích hợp sâu PowerPoint (embed/overlay slide trực tiếp).
- Inject custom CSS nâng cao.

### Won't Have (MVP)

- Hoàn toàn anonymous (theo yêu cầu: phải thu thập thông tin sinh viên).
- Tích hợp sâu slide PPT (chỉ hỗ trợ kịch bản + gợi ý mốc ở MVP).
- AI tự động tóm tắt hoặc chấm điểm (có thể thêm sau).

---

## 6. Success Metrics (Chỉ số thành công)

- **Activation**: ≥ 80% sinh viên tham gia thành công (quét QR → nhập thông tin nhanh) trong < 45 giây.
- **Engagement**: Trung bình > 70% sinh viên tham gia ít nhất 1 hoạt động trong buổi mẫu.
- **Grading Convenience (quan trọng nhất)**: Giảng viên đánh giá được điểm / phản hồi của sinh viên một cách thuận tiện, tự động hóa cao, ít thao tác thủ công.
- **Workflow Smoothness**: Giảng viên cảm thấy kịch bản + PPT kết hợp trơn tru, giảm rõ rệt việc chuyển nền tảng.
- **Customization Proof**: Có ít nhất 2 custom template được tạo và tái sử dụng thành công.
- **Qualitative feedback**:
  - "Tự động lưu và xem điểm rất tiện"
  - "Kịch bản giúp buổi giảng mượt mà hơn"
  - "Dễ tùy chỉnh theo cách mình dạy"
  - "Phù hợp môi trường học thuật"

---

## 7. Design Direction & Vibe (Hướng thiết kế)

**Vibe tổng thể (3–5 từ)**:  
Chuyên nghiệp – Sạch sẽ – Dễ dùng – Học thuật – Tiếng Việt

**Nguyên tắc thiết kế**:
- **Participant (sinh viên)**: Mobile-first cực mạnh. Form nhập thông tin nhanh, big tap targets, optimistic UI, ít text thừa.
- **Presenter (giảng viên)**: Desktop tối ưu cho máy chiếu. Giao diện đánh giá điểm rõ ràng, hỗ trợ lọc và xuất nhanh.
- Phong cách tổng thể: Học thuật, trang trọng vừa phải, không lòe loẹt, dễ nhìn khi chiếu.
- Hỗ trợ tốt tiếng Việt (font, dấu, bố cục).
- Tránh "AI slop": Không gradient tím lòe loẹt, không bo góc đồng đều quá mức.

**Key Screens**:
- Dashboard host (danh sách phòng + lịch sử).
- Tạo phòng + Theme + Bắt đầu tạo kịch bản.
- Participant: Màn hình nhập thông tin → Chờ → Hoạt động đang diễn ra.
- Presenter: Kịch bản + Activity queue + Live results + Giao diện đánh giá sau buổi.
- Template builder (form linh hoạt theo loại hoạt động).

---

## 8. Technical Considerations (Cân nhắc kỹ thuật)

- **Stack khuyến nghị mạnh**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui + Framer Motion + **Convex** (realtime reactive database).
- Lý do chọn Convex: DX realtime xuất sắc (đã có ví dụ PollUP), optimistic updates mạnh, local dev rất tốt, type-safe end-to-end, Free tier đủ cho quy mô <50 người.
- Auth: Convex Auth (anonymous + thu thập thông tin sinh viên nhẹ).
- Lưu trữ: Convex File Storage cho ảnh trong Board.
- Realtime: Dựa hoàn toàn vào reactive queries của Convex.
- Export: jsPDF + xlsx.
- Testing: Playwright E2E cho các flow chính.

---

## 9. Constraints & Assumptions (Ràng buộc & Giả định)

- Ngân sách: Gần như $0 cho hosting 6–12 tháng đầu.
- Timeline: Muốn có phiên bản có thể demo và sử dụng thực tế sau 8–12 tuần.
- Kỹ năng người dùng: Đang học stack hiện đại → cần tài liệu, comment code và AGENTS.md rất chi tiết.
- Quy mô: < 50 người/buổi (ưu tiên UX và tự động hóa hơn scale cực lớn).
- Yêu cầu bắt buộc: 100% tiếng Việt (UI + tài liệu), phong cách học thuật.
- Triển khai ban đầu: Local dev trước, sau đó mới cân nhắc cloud hoặc self-host.

---

## 10. Definition of Done (Tiêu chí hoàn thành MVP)

- [ ] Có thể chạy một buổi giảng mẫu 30–40 phút thực tế (tạo phòng → tạo kịch bản → chạy nhiều công cụ → sinh viên nhập thông tin → export + đánh giá điểm).
- [ ] ≥ 80% sinh viên join thành công với thông tin đầy đủ (Mã SV + Họ tên + Lớp).
- [ ] Giảng viên có thể xem và đánh giá điểm/reaction của sinh viên một cách thuận tiện, tự động hóa cao.
- [ ] Có ít nhất 3 custom template được tạo và tái sử dụng.
- [ ] Export PDF + Excel hoạt động tốt.
- [ ] Toàn bộ giao diện tiếng Việt, phong cách học thuật.
- [ ] Playwright E2E test pass cho các flow chính.
- [ ] README + hướng dẫn sử dụng tiếng Việt rõ ràng.
- [ ] Đã qua code review và verification.

---

**Tài liệu này được tổng hợp trực tiếp từ Kế hoạch đã phê duyệt + tất cả phản hồi của người dùng.**

**Next step theo kế hoạch**: Chuyển sang Bước 3 – Technical Design (sẽ chi tiết schema Convex, cách lưu kịch bản, luồng thu thập danh tính sinh viên, custom template engine, v.v.).

---

*PRD-tkbaigiang-MVP.md – Phiên bản 1.0 – Đã sẵn sàng để chuyển sang Tech Design sau khi người dùng xác nhận.*