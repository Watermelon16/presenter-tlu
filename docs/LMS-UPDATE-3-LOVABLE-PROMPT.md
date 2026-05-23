# Lovable prompt UPDATE 3 — Đồng bộ xóa phòng

Paste vào Lovable.

---

## PROMPT

Cần thêm 1 đồng bộ nữa giữa LMS và Presenter:

**Khi GV xóa attendance_session trên LMS, phòng giảng tương ứng trên Presenter (nếu đã tạo) cần được xóa tự động** — để 2 hệ thống không lệch dữ liệu.

### 1. Tạo edge function mới `notify-presenter-session-deleted`

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

Đặt `verify_jwt = true` trong `supabase/config.toml` cho function này.

### 2. Sửa frontend (React) chỗ xóa attendance_session

Trong component xóa attendance_session, trước khi xóa DB, gọi notify Presenter:

```ts
async function handleDeleteAttendanceSession(session: AttendanceSession) {
  if (!confirm(`Xóa buổi điểm danh "${session.title}"? ${session.presenter_url ? "Phòng giảng Presenter cũng sẽ bị xóa cùng." : ""}`)) return;

  // Bước 1: notify Presenter (chỉ nếu có presenter_url) — best-effort, không block delete LMS
  if (session.presenter_url) {
    try {
      await supabase.functions.invoke("notify-presenter-session-deleted", {
        body: { session_id: session.id },
      });
    } catch (e) {
      console.warn("Notify presenter failed (vẫn xóa LMS):", e);
    }
  }

  // Bước 2: xóa attendance_session trên Supabase (đã có sẵn)
  const { error } = await supabase
    .from("attendance_sessions")
    .delete()
    .eq("id", session.id);
  if (error) toast.error(error.message);
  else toast.success("Đã xóa buổi điểm danh");
}
```

Hoặc nếu thầy muốn an toàn hơn: hỏi user **"Có muốn xóa phòng Presenter kèm không?"** trước, để có lựa chọn giữ data Presenter cho mục đích chấm điểm sau.

### 3. Test sau khi xong

1. Tạo attendance_session + bấm "Tạo phòng giảng" → mở Presenter ở tab mới, thấy phòng
2. Quay LMS, xóa attendance_session
3. Refresh Presenter → phòng biến mất khỏi "Buổi giảng của bạn"
4. Mở URL `/presenter/CODE` cũ → "Phòng không tồn tại"

---

## Endpoint contract Presenter

```
POST https://chatty-hornet-671.convex.site/lms/session-deleted
Header: x-lms-secret: <PRESENTER_PROVISIONING_SECRET>
Body: { "lms_session_id": "<UUID>" }

Response 200: {
  "ok": true,
  "notFound": false,           // true nếu phòng không tồn tại (idempotent)
  "code": "ABCDEF",            // code phòng đã xóa
  "counts": { activities, responses, participants, boardPosts, rosterCache, images }
}
```

Idempotent: gọi lại sau khi đã xóa → trả `{ok: true, notFound: true, counts: null}` (không error).
