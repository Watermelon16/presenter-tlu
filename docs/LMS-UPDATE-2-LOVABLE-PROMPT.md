# Lovable prompt UPDATE 2 — Đồng bộ roster + ngưỡng absent 50 phút

Paste vào Lovable. Đây là cập nhật tiếp theo của integration LMS ↔ Presenter sau lần trước.

---

## PROMPT

Cần 2 thay đổi:

### 1. Fix roster bị stale trên Presenter

Hiện tại `provision-presenter-room` chỉ gửi roster sang Presenter khi tạo phòng lần đầu. Sau đó nếu GV thêm/sửa SV trong `class_roster`, Presenter không biết. Hậu quả: SV mới scan QR Presenter bị reject "không có trong danh sách lớp" dù họ có trong LMS.

#### Sửa `supabase/functions/provision-presenter-room/index.ts`

Hiện đoạn này có early-return khi `presenter_url` đã set:
```ts
if (session.presenter_url) {
  return json({ ok: true, url: session.presenter_url, already: true });
}
```

→ Bỏ early-return này. Luôn fetch class_roster mới + POST sang Presenter, dù phòng đã tồn tại. Presenter idempotent — nhận lại payload sẽ refresh roster + trả về cùng URL.

Đoạn fetch roster + POST hiện có vẫn giữ nguyên, chỉ bỏ early-return.

#### Hoặc (tốt hơn): thêm button "Đồng bộ roster" trên frontend

Trong trang quản lý attendance_session (chỗ đang có nút "🎤 Tạo / Mở phòng giảng"), thêm nút thứ 2 **"🔄 Đồng bộ roster"**. Khi click:

```ts
const { data: roster } = await supabase
  .from("class_roster")
  .select("student_id, student_name")
  .eq("class_id", classId);

const res = await fetch(
  "https://chatty-hornet-671.convex.site/lms/sync-roster",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-lms-secret": "(read from PRESENTER_PROVISIONING_SECRET env via supabase.functions.invoke wrapper)",
    },
    body: JSON.stringify({
      lms_session_id: sessionId,
      roster: (roster ?? []).map((r) => ({
        student_code: r.student_id,
        full_name: r.student_name,
      })),
    }),
  }
);
```

**Lưu ý**: Frontend không thể đọc env secret. Cách an toàn: tạo edge function mới `sync-roster-to-presenter` nhận `session_id`, query roster, gọi Presenter `/lms/sync-roster` với secret. Frontend gọi edge function này qua `supabase.functions.invoke`.

```ts
// supabase/functions/sync-roster-to-presenter/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SECRET = Deno.env.get("PRESENTER_PROVISIONING_SECRET")!;
const PRESENTER_URL = "https://chatty-hornet-671.convex.site/lms/sync-roster";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  // Verify teacher auth (giống provision-presenter-room)
  // ...
  const { session_id } = await req.json();
  const { data: session } = await admin
    .from("attendance_sessions")
    .select("id, class_id")
    .eq("id", session_id)
    .maybeSingle();
  if (!session) return json({ error: "Session không tồn tại" }, 404);

  const { data: rosterRows } = await admin
    .from("class_roster")
    .select("student_id, student_name")
    .eq("class_id", session.class_id);

  const res = await fetch(PRESENTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-lms-secret": SECRET },
    body: JSON.stringify({
      lms_session_id: session_id,
      roster: (rosterRows ?? []).map((r) => ({
        student_code: r.student_id,
        full_name: r.student_name,
      })),
    }),
  });
  const body = await res.json().catch(() => ({}));
  return json({ ok: res.ok, count: rosterRows?.length ?? 0, presenter: body });
});
```

`verify_jwt = true` cho function này trong `config.toml`.

### 2. Cập nhật ngưỡng late/absent trong `attendance-qr/checkin`

Hiện logic chỉ tính `present | late` với 1 ngưỡng (10 phút). Đổi sang 3 trạng thái:

- 0..10 phút sau `start_time` → `present`
- 10..50 phút → `late`
- > 50 phút → `absent` (tự động; GV có thể chỉnh sang excused/late/present sau)

Sửa đoạn tính status trong `attendance-qr/index.ts`:

```ts
let statusCode: "present" | "late" | "absent" = "present";
if (session.start_time) {
  const elapsedMin = (Date.now() - new Date(session.start_time).getTime()) / 60_000;
  const LATE_AT = 10;
  const ABSENT_AT = 50;
  if (elapsedMin > ABSENT_AT) statusCode = "absent";
  else if (elapsedMin > LATE_AT) statusCode = "late";
}
```

Dòng insert `attendance_records` sửa dùng `statusCode` (đã hỗ trợ rồi).

Body gửi Presenter `/lms/student-checkin` cũng gửi đúng `status_code` này — Presenter sẽ tôn trọng.

### 3. Optional: gửi `absent_after_minutes` khi notify-presenter-session-opened

Trong `notify-presenter-session-opened`, body POST tới `/lms/session-opened` thêm field:

```ts
body: JSON.stringify({
  lms_session_id: session_id,
  start_time: session.start_time,
  late_cutoff_minutes: 10,
  absent_after_minutes: 50,
}),
```

---

## Test sau khi xong

1. Vào LMS một class, thêm 1 SV mới vào class_roster (vd MSV "54321")
2. Mở attendance_session đã tạo phòng từ trước → bấm "🔄 Đồng bộ roster"
3. Trên Presenter `/presenter/{code}`: panel "Điểm danh" cuộn list roster → thấy SV mới
4. SV "54321" scan QR Presenter → cho vào phòng (không reject nữa)
5. Test logic late/absent: SV scan ở phút 5 → present, phút 15 → late, phút 60 → absent
