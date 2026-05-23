# Lovable prompt — Chống điểm danh hộ qua device binding

Paste vào Lovable.

---

## PROMPT

Hiện tại sinh viên có thể dùng 1 điện thoại scan QR điểm danh cho nhiều bạn (1 đứa cầm điện thoại quét hộ cả nhóm). Cần thêm cơ chế "1 thiết bị = 1 sinh viên / 1 buổi điểm danh" để chặn việc này, giống cách Presenter TLU đã làm.

### Cơ chế

- Mỗi browser/thiết bị có 1 `device_id` cố định (UUID lưu trong `localStorage`)
- Khi SV scan QR + điểm danh → ghi binding `(attendance_session_id, device_id, student_id)`
- Lần scan tiếp theo cùng thiết bị này:
  - Nếu cố điểm danh cho `student_id` KHÁC → reject + báo lỗi rõ
  - Nếu cùng `student_id` → cho qua (SV scan lại của chính mình thì OK)

### 1. Migration: tạo bảng `attendance_device_bindings`

```sql
CREATE TABLE public.attendance_device_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,        -- UUID random từ client localStorage
  student_id TEXT NOT NULL,       -- MSV đã bind với thiết bị này
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, device_id)   -- 1 device chỉ bind 1 lần per session
);

CREATE INDEX idx_device_bindings_session_device
  ON public.attendance_device_bindings(session_id, device_id);

ALTER TABLE public.attendance_device_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers read device_bindings" ON public.attendance_device_bindings
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'teacher'));

CREATE POLICY "System insert device_bindings" ON public.attendance_device_bindings
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Teachers delete device_bindings" ON public.attendance_device_bindings
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'teacher'));
```

### 2. Sửa edge function `attendance-qr` (action `checkin`)

Trong file `supabase/functions/attendance-qr/index.ts`, **trước khi insert `attendance_records`**, thêm device-binding check:

```ts
// Device binding check (sau khi pass roster + token validation)
const deviceId = String(body.device_id || "").trim();
if (!deviceId) {
  return json({ error: "Thiếu device_id — vui lòng tải lại trang" }, 400);
}

// Check binding cho session này
const { data: existingBinding } = await admin
  .from("attendance_device_bindings")
  .select("device_id, student_id")
  .eq("session_id", sessionId)
  .eq("device_id", deviceId)
  .maybeSingle();

if (existingBinding && existingBinding.student_id !== studentId) {
  return json({
    error: `Thiết bị này đã được dùng để điểm danh cho SV "${existingBinding.student_id}" trong buổi này. Mỗi thiết bị chỉ điểm danh 1 SV.`,
    code: "device_already_bound",
  }, 403);
}

// Nếu chưa có binding → tạo mới (best-effort, nếu trùng UNIQUE thì ignore vì có nghĩa là cùng student)
if (!existingBinding) {
  await admin.from("attendance_device_bindings").insert({
    session_id: sessionId,
    device_id: deviceId,
    student_id: studentId,
    ip_address: ip,
    user_agent: ua,
  }).select().maybeSingle();  // ignore unique violation
}
```

Lưu ý đặt đoạn này SAU phần check `existing attendance_records` (idempotent rescan của cùng SV trả về sớm) để không bị block khi SV vô tình scan lại.

### 3. Sửa frontend QR scan landing page (file React xử lý sau khi scan QR)

Đảm bảo gửi `device_id` trong body khi POST `attendance-qr/checkin`:

```tsx
// Helper: lấy hoặc tạo deviceId — lưu localStorage để cố định cho thiết bị này
function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "lms_attendance_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

// Trong handler checkin:
const { data, error } = await supabase.functions.invoke("attendance-qr", {
  body: {
    action: "checkin",
    session_id: sessionId,
    token,
    student_id: studentId,
    student_name: studentName,
    device_id: getOrCreateDeviceId(),  // <-- thêm
    note,
    latitude, longitude, accuracy,
  },
});

// Handle lỗi rõ ràng cho device-bound
if (error || data?.code === "device_already_bound") {
  toast.error(data?.error || error?.message || "Lỗi điểm danh");
  return;
}
```

### 4. (Optional) UI quản lý device binding cho GV

Trong trang chi tiết attendance_session, thêm tab/section "Thiết bị điểm danh" để GV xem + xóa binding khi cần (vd SV đổi điện thoại đúng, muốn cho phép scan lại):

```tsx
// Query bindings
const { data: bindings } = await supabase
  .from("attendance_device_bindings")
  .select("device_id, student_id, ip_address, user_agent, created_at")
  .eq("session_id", session.id)
  .order("created_at", { ascending: false });

// Render table: MSV | Device fingerprint (last 8 char) | IP | User agent | Thời gian | Action [Xóa]
```

GV bấm "Xóa binding" → DELETE row → SV đó có thể scan lại từ thiết bị mới.

---

## Test sau khi xong

1. Lấy điện thoại 1 → scan QR → nhập MSV `12345` → checkin OK (binding tạo)
2. Cùng điện thoại đó, scan lại + nhập MSV `54321` → reject với message rõ:  
   *"Thiết bị này đã được dùng để điểm danh cho SV '12345' trong buổi này..."*
3. Cùng điện thoại, scan lại + nhập `12345` lần nữa → OK (idempotent rescan)
4. Lấy điện thoại 2 → scan + nhập `54321` → OK (device khác, SV khác)

---

## Lưu ý compatibility

- Cơ chế này hoàn toàn ở phía LMS — không cần Presenter thay đổi gì. Presenter đã có cơ chế device-binding riêng (cũng dùng localStorage UUID, key khác: `presenter_tlu_device_id`).
- Edge case: SV xóa cookies/localStorage → mất binding → có thể điểm danh lại với MSV khác trên cùng thiết bị. Đây là trade-off khó tránh với device fingerprinting browser-based. Cách chống thêm: IP fingerprint (đã lưu sẵn `ip_address`) — GV review thấy nhiều SV cùng IP/ngắn thời gian → flag thủ công.
- Khi xóa attendance_session → CASCADE tự xóa device_bindings (đã có FK).
