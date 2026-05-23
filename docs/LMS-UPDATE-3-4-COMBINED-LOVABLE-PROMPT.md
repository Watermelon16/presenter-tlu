# Lovable prompt — Gộp 2 thay đổi: đồng bộ xóa phòng + auto-join Presenter từ link LMS

Paste toàn bộ phần dưới vào Lovable.

---

## PROMPT

Cần 2 cải tiến đồng bộ giữa LMS này và Presenter TLU (Convex backend, repo riêng):

### Việc A — Đồng bộ xóa phòng

Khi GV xóa `attendance_session` trên LMS, phòng giảng Presenter tương ứng cũng phải bị xóa tự động (kèm participants, roster cache, responses, board posts) để 2 hệ thống không lệch dữ liệu.

### Việc B — SV scan QR LMS xong vào Presenter không phải nhập lại MSV

Sau khi SV scan QR điểm danh LMS thành công, link "Vào phòng học tương tác" cần kèm sẵn MSV trong URL. Presenter sẽ auto-join, SV không phải gõ lại.

---

### A.1. Tạo edge function `notify-presenter-session-deleted`

`supabase/functions/notify-presenter-session-deleted/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PRESENTER_URL = "https://chatty-hornet-671.convex.site/lms/session-deleted";
const SECRET = Deno.env.get("PRESENTER_PROVISIONING_SECRET")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Verify teacher auth (giống provision-presenter-room)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json({ error: "Invalid session" }, 401);
  const { data: hasRole } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "teacher" });
  if (!hasRole) return json({ error: "Not a teacher" }, 403);

  try {
    const { session_id } = await req.json();
    if (!session_id) return json({ error: "Missing session_id" }, 400);

    const res = await fetch(PRESENTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-lms-secret": SECRET },
      body: JSON.stringify({ lms_session_id: session_id }),
    });
    const body = await res.json().catch(() => ({}));
    return json({ ok: res.ok, presenter_response: body });
  } catch (e) {
    return json({ error: String((e as Error).message) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

Đặt `verify_jwt = true` cho function này trong `supabase/config.toml`.

### A.2. Sửa frontend khi GV xóa attendance_session

Trong component xóa attendance_session, gọi notify trước khi xóa DB:

```ts
async function handleDeleteAttendanceSession(session: AttendanceSession) {
  const hasPresenter = !!session.presenter_url;
  const msg = hasPresenter
    ? `Xóa buổi điểm danh "${session.title}"?\n\nPhòng giảng Presenter cũng sẽ bị xóa cùng (gồm câu trả lời SV, board posts...).`
    : `Xóa buổi điểm danh "${session.title}"?`;
  if (!confirm(msg)) return;

  // Bước 1: notify Presenter — best-effort, không block delete LMS
  if (hasPresenter) {
    try {
      await supabase.functions.invoke("notify-presenter-session-deleted", {
        body: { session_id: session.id },
      });
    } catch (e) {
      console.warn("Notify presenter failed (vẫn xóa LMS):", e);
    }
  }

  // Bước 2: xóa attendance_session trên Supabase (logic cũ đã có)
  const { error } = await supabase
    .from("attendance_sessions")
    .delete()
    .eq("id", session.id);
  if (error) toast.error(error.message);
  else toast.success("Đã xóa buổi điểm danh" + (hasPresenter ? " + phòng Presenter" : ""));
}
```

---

### B. Sửa link "Vào phòng học tương tác" để kèm MSV

Sau khi SV scan QR điểm danh LMS thành công, trang/component hiển thị link sang Presenter cần kèm MSV qua URL param. Presenter (đã update) sẽ đọc param này và auto-join.

URL format Presenter chấp nhận:

```
https://presenter-tlu.vercel.app/room/<CODE>?from_lms=1&sid=<MSV>
```

Hoặc nếu LMS có sẵn họ tên + lớp (từ `class_roster` lookup):

```
https://presenter-tlu.vercel.app/room/<CODE>?from_lms=1&sid=<MSV>&name=<encoded_name>&class=<class>
```

**Cách sửa**: tìm chỗ hiện link/button "Vào phòng học" sau khi SV checkin LMS xong. Hiện tại chắc dùng `session.presenter_url` thô. Sửa thành:

```tsx
{session.presenter_url && checkedInStudentId && (
  (() => {
    const url = new URL(session.presenter_url);
    url.searchParams.set("from_lms", "1");
    url.searchParams.set("sid", checkedInStudentId);
    if (checkedInStudentName) url.searchParams.set("name", checkedInStudentName);
    // className lấy từ classes.name nếu có
    return (
      <a
        href={url.toString()}
        target="_blank"
        rel="noopener noreferrer"
        className="..."
      >
        🎓 Vào phòng học tương tác (đã đăng nhập sẵn)
      </a>
    );
  })()
)}
```

Trong đó `checkedInStudentId` là MSV SV vừa nhập khi scan QR (từ response của `attendance-qr/checkin` hoặc form state). `checkedInStudentName` lấy từ `attendance-qr/checkin` response (đã có sẵn field `student_name`).

---

## Test sau khi xong

**Test A (đồng bộ xóa)**:
1. Tạo attendance_session mới + bấm "Tạo phòng giảng" → mở Presenter tab mới thấy phòng
2. Quay LMS, xóa attendance_session → confirm dialog hiện đúng cảnh báo "phòng Presenter cũng bị xóa"
3. Refresh Presenter trang chủ → phòng biến mất khỏi "Buổi giảng của bạn"
4. Mở URL `/presenter/CODE` cũ → "Phòng không tồn tại"

**Test B (auto-join)**:
1. Mở LMS bằng điện thoại, scan QR điểm danh → nhập MSV 12345 → checkin success
2. Bấm link "Vào phòng học tương tác" → mở Presenter tab mới
3. Auto-join trong 1-2 giây → toast "✓ Chào [Họ tên] — đã vào phòng"
4. Không hiện form yêu cầu nhập lại MSV
5. Inspect URL sau load: query params đã được clean

---

## Endpoint contracts (Presenter đã live, không cần làm gì thêm phía đó)

**A — Xóa phòng**:
```
POST https://chatty-hornet-671.convex.site/lms/session-deleted
Header: x-lms-secret: <PRESENTER_PROVISIONING_SECRET>
Body: { "lms_session_id": "<UUID>" }

Response 200: {
  "ok": true,
  "notFound": false,
  "code": "ABCDEF",
  "counts": { activities, responses, participants, boardPosts, rosterCache, images }
}
```
Idempotent — gọi lại trả `notFound: true`.

**B — Auto-join URL**:
- Tối giản: `/room/<CODE>?sid=<MSV>`
- Đầy đủ: `/room/<CODE>?from_lms=1&sid=<MSV>&name=<encoded>&class=<class>`
- Backend Presenter tự lookup roster cho phòng LMS-linked, override fullName/className nếu khớp.
