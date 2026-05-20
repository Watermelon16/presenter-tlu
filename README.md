# Presenter TLU

**Công cụ tương tác 2 chiều với sinh viên trong lúc giảng — Đại học Thủy Lợi.**

Một web app realtime đơn giản giúp giảng viên tạo Poll, Word Cloud, Q&A, Board cộng tác… ngay trong lúc giảng bài, sinh viên tham gia bằng QR code trên điện thoại. Mọi kết quả được lưu tự động, xuất Excel/PDF để đẩy lên LMS chấm điểm.

---

## Tính năng chính

- **Tạo phòng nhanh** — Mã phòng 6 ký tự + QR code, không cần tài khoản
- **Thu thập danh tính sinh viên** — Mã SV + Họ tên + Lớp (khớp với LMS)
- **5 loại hoạt động realtime**:
  - 📊 **Poll** (trắc nghiệm single/multi)
  - 💬 **Word Cloud** (xu hướng trả lời)
  - ⭐ **Rating** (thang điểm 1–5)
  - ❓ **Q&A** (upvote + moderation)
  - 📌 **Board** (Padlet-style, hỗ trợ ảnh + cột)
- **Kịch bản (Scripted Workflow)** — Tạo chuỗi hoạt động có thứ tự, mỗi hoạt động gắn mốc slide PPT, bấm `Space` để chuyển
- **Trợ lý Kịch bản (Companion)** — Cửa sổ nhỏ trên laptop để điều khiển khi PPT chiếu fullscreen
- **Chiếu kết quả nhanh (F-hotkey)** — Bấm `F` trong tab presenter → kết quả fullscreen, projector-friendly. Alt+Tab về PPT, Alt+Tab sang web là thấy ngay
- **Chiếu mã phòng/QR (Q-hotkey)** — Bấm `Q` để chiếu QR + mã phòng to lên màn hình
- **Bảng thành tích** — Tính điểm tham gia, hiển thị Top 10 (cấu hình điểm tuỳ chỉnh)
- **Xuất kết quả** — CSV, Excel (.xlsx, nhiều sheet), PDF báo cáo
- **Kịch bản mẫu** — Lưu kịch bản hiện tại, tái sử dụng cho buổi sau

---

## Phím tắt (Presenter)

| Phím | Hành động |
|---|---|
| `Space` / `→` | Tiếp theo trong kịch bản (hoặc next slide khi đang chiếu PDF) |
| `←` | Quay lại (kịch bản hoặc slide) |
| `F` | Bật/tắt **chiếu kết quả** fullscreen |
| `Q` | Bật/tắt **chiếu QR + mã phòng** fullscreen |
| `S` | Bật/tắt **chiếu slide PDF** fullscreen (thay PPT) |
| `Esc` | Đóng overlay fullscreen |

### Hai cách chiếu mượt

**Cách 1 — Vẫn dùng PPT, web app là phụ:**
1. PPT fullscreen trên máy chiếu (mirror).
2. Tab presenter trên cùng laptop. Cần chiếu kết quả → Alt+Tab → `F` → Alt+Tab về PPT.
3. Hoặc dùng **Trợ lý Kịch bản (PiP)** — cửa sổ nhỏ góc màn hình.

**Cách 2 — Upload PDF, không cần PPT (1 cửa sổ duy nhất):**
1. Trước buổi: export PPTX → PDF (PowerPoint: File → Save As → PDF). Upload qua nút **📑 Upload PDF** trên top bar.
2. Trong buổi: bấm `S` → slide hiện fullscreen. `← →` để chuyển slide.
3. Khi chạy activity: bấm `F` để chiếu kết quả, `S` để quay lại slide. Toàn bộ trong 1 tab — **không cần Alt+Tab**.
4. Mã phòng vẫn hiện nhỏ ở góc khi đang chiếu slide → SV vẫn join được.

---

## Chạy thử trên máy local

### Yêu cầu

- Node.js 20+
- Tài khoản Convex miễn phí (https://convex.dev)

### Cài đặt

```bash
git clone <repo-url>
cd tkbaigiang
npm install
```

### Setup Convex (database realtime)

```bash
npx convex dev
```

Lần đầu chạy sẽ:
- Mở browser đăng nhập Convex
- Tự tạo project mới
- Sinh `.env.local` với `NEXT_PUBLIC_CONVEX_URL`
- Push schema + functions lên Convex Cloud

Giữ terminal này chạy (Convex dev server theo dõi thay đổi file `convex/`).

### Chạy Next.js dev server

Mở terminal thứ 2:

```bash
npm run dev
```

Truy cập `http://localhost:3000` → tạo phòng đầu tiên.

---

## Deploy lên Internet (free, $0)

### Bước 1: Convex Cloud Production

Trong terminal:

```bash
npx convex deploy
```

Lệnh này:
- Push convex functions lên môi trường production
- In ra `Convex deployment URL` (production) — copy lại

### Bước 2: Push code lên GitHub

```bash
git add -A
git commit -m "Ready for deploy"
git push origin main
```

### Bước 3: Deploy Next.js lên Vercel

1. Vào https://vercel.com/new
2. Import GitHub repo `tkbaigiang`
3. Trong "Environment Variables", thêm:
   - `NEXT_PUBLIC_CONVEX_URL` = `<URL production từ bước 1>`
4. Bấm **Deploy**

Vài phút sau Vercel sẽ in ra URL dạng `tkbaigiang.vercel.app`. Vào URL đó → tạo phòng → chia sẻ QR cho sinh viên.

### Chi phí

| Dịch vụ | Free tier | Đủ cho |
|---|---|---|
| **Vercel** | 100GB bandwidth/tháng | Hàng nghìn buổi giảng/tháng |
| **Convex** | 1M function calls/tháng + 1GB storage | ~100 buổi 50 SV/tháng |

→ Tổng chi phí: **$0**.

---

## Tích hợp với LMS

App này **chỉ bổ trợ trong buổi giảng**, không quản lý lớp/sinh viên dài hạn. Quy trình tích hợp với LMS riêng:

1. Trước buổi → tạo phòng trên Presenter TLU, lấy mã + QR
2. Trong buổi → sinh viên quét QR, nhập **Mã SV + Họ tên + Lớp** (khớp định danh trong LMS)
3. Sau buổi → bấm **Xuất Excel** → file `.xlsx` có 3 sheet:
   - **Chi tiết**: từng SV × từng hoạt động (đầy đủ trả lời)
   - **Chấm điểm**: gợi ý điểm thang 10, copy-paste vào cột điểm LMS
   - **Thông tin**: metadata buổi giảng

---

## Cấu trúc dự án

```
app/
├── page.tsx                       # Tạo phòng mới
├── join/page.tsx                  # Sinh viên tham gia (hỗ trợ ?code= từ QR)
├── room/[code]/page.tsx           # View của sinh viên trong phòng
└── presenter/[code]/
    ├── page.tsx                   # Dashboard giảng viên
    ├── companion/page.tsx         # Trợ lý kịch bản (cửa sổ phụ)
    └── leaderboard/page.tsx       # Bảng thành tích chiếu

convex/
├── schema.ts                      # Schema 6 bảng
├── sessions.ts                    # Phòng + script runner
├── activities.ts                  # Hoạt động + advanceInScript
├── responses.ts                   # Trả lời + export query
├── board.ts                       # Board Padlet-style
├── participants.ts                # Sinh viên trong phòng
├── leaderboard.ts                 # Tính điểm thành tích
├── scriptTemplates.ts             # Lưu/áp dụng kịch bản mẫu
└── files.ts                       # Upload ảnh Board
```

---

## License

MIT — dùng tự do cho mục đích giảng dạy.
