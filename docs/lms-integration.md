# Đồng bộ Presenter TLU ↔ LMS (lephuong-tlu)

## Tổng quan

LMS dùng Supabase, schema chính cho điểm danh:
- `attendance_sessions` (buổi điểm danh)
- `attendance_records` (record per SV)
- `class_roster` (danh sách lớp)
- `attendance_status_configs` (status codes per class)

Workflow đề xuất:
1. **GV tạo `attendance_session` trên LMS** trước buổi học (như đang làm).
2. **Lấy ID** của session đó (UUID).
3. **Trên Presenter, cấu hình** webhook URL + LMS session ID + secret.
4. **Mỗi SV scan Presenter QR** → join → Presenter POST tới LMS edge function → tự tạo `attendance_record` với status auto từ time-based logic.

## Bước 1 — Deploy edge function lên Supabase LMS

Tạo file `supabase/functions/presenter-sync/index.ts` trong repo LMS:

```ts
// Public endpoint (verify_jwt=false) — nhận webhook attendance từ Presenter TLU
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-presenter-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_SECRET = Deno.env.get("PRESENTER_SHARED_SECRET")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Map Presenter status → LMS status_code (cần khớp với attendance_status_configs của class)
const STATUS_MAP: Record<string, string> = {
  present: "present",       // có mặt
  late: "late",             // đi muộn
  excused: "excused",       // vắng có phép
  absent: "absent",         // vắng không phép
  early_leave: "early_leave", // về sớm
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Verify shared secret
  const secret = req.headers.get("x-presenter-secret");
  if (secret !== SHARED_SECRET) {
    return json({ error: "Unauthorized: invalid secret" }, 401);
  }

  try {
    const body = await req.json();
    const lmsSessionId = String(body.lms_session_id || "").trim();
    const studentId = String(body.student_id || "").trim();
    const studentName = String(body.student_name || "").trim();
    const presenterStatus = String(body.attendance_status || "present");
    const checkinTime = body.checkin_time || new Date().toISOString();

    if (!lmsSessionId || !studentId || !studentName) {
      return json({ error: "Missing lms_session_id / student_id / student_name" }, 400);
    }

    // Verify LMS session exists
    const { data: session, error: sErr } = await admin
      .from("attendance_sessions")
      .select("id, class_id, status")
      .eq("id", lmsSessionId)
      .maybeSingle();
    if (sErr || !session) return json({ error: "LMS session not found" }, 404);

    const statusCode = STATUS_MAP[presenterStatus] || "present";

    // Upsert attendance_record
    const { data: existing } = await admin
      .from("attendance_records")
      .select("id")
      .eq("session_id", lmsSessionId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (existing) {
      // Update — không override nếu source='manual' (GV đã chỉnh tay trong LMS)
      const { data: current } = await admin
        .from("attendance_records")
        .select("source")
        .eq("id", existing.id)
        .maybeSingle();
      if (current?.source === "manual") {
        return json({ ok: true, skipped: "manual_override" });
      }
      await admin
        .from("attendance_records")
        .update({
          status_code: statusCode,
          source: "presenter",
          checkin_time: checkinTime,
          notes: `Synced from Presenter TLU — ${studentName}`,
        })
        .eq("id", existing.id);
      return json({ ok: true, updated: true, status_code: statusCode });
    }

    const { error: insErr } = await admin.from("attendance_records").insert({
      session_id: lmsSessionId,
      class_id: session.class_id,
      student_id: studentId,
      status_code: statusCode,
      source: "presenter",
      checkin_time: checkinTime,
      notes: `Synced from Presenter TLU — ${studentName}`,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    return json({ ok: true, created: true, status_code: statusCode });
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

## Bước 2 — Cấu hình Supabase

1. **Deploy edge function**:
   ```bash
   cd lephuong-tlu
   supabase functions deploy presenter-sync --no-verify-jwt
   ```

2. **Set shared secret** (random string dài, dùng để authenticate Presenter):
   ```bash
   supabase secrets set PRESENTER_SHARED_SECRET=<random-hex-32-bytes>
   ```
   Tạo random: `openssl rand -hex 32`

3. **Lấy function URL**: `https://<project-ref>.supabase.co/functions/v1/presenter-sync`

## Bước 3 — Cấu hình Presenter

Trong modal "📋 Điểm danh" → ⚙️ Cài đặt:
- **Webhook URL**: dán URL edge function vào ô
- **LMS session ID**: TODO (cần thêm field này) — UUID của `attendance_sessions` bạn đã tạo cho buổi tương ứng trên LMS

Presenter sẽ thêm header `x-presenter-secret` khi POST. Secret được set trên Convex env:
```bash
npx convex env set --prod LMS_SHARED_SECRET <giá-trị-giống-Supabase>
```

## Workflow hoàn chỉnh

1. **Trước buổi học**:
   - GV tạo `attendance_session` trong LMS (như đang làm)
   - Copy UUID của session đó
   - Trên Presenter: tạo buổi giảng → mở Điểm danh → ⚙️ → paste webhook URL + UUID

2. **Trong buổi**:
   - SV quét QR Presenter → nhập info → điểm danh Presenter
   - Presenter tự POST tới LMS edge function → record hiện trong LMS UI ngay

3. **Sau buổi**:
   - GV xem LMS, override manual nếu cần (vắng có phép)
   - Presenter sync tự không override `source='manual'`

## Mapping status codes

| Presenter | LMS `status_code` | Mặc định LMS |
|---|---|---|
| `present` | `present` | "Có mặt" |
| `late` | `late` | "Đi muộn" |
| `excused` | `excused` | "Vắng có phép" |
| `absent` | `absent` | "Vắng không phép" |
| `early_leave` | `early_leave` | "Về sớm" |

Đảm bảo LMS `attendance_status_configs` của class có 5 status code này. Nếu LMS dùng codes khác, sửa `STATUS_MAP` trong edge function.

## Lưu ý

- Edge function dùng `service_role` key → bypass RLS, không cần GV login.
- Auth qua `x-presenter-secret` header — đừng commit secret vào git.
- Source `presenter` để phân biệt với `qr` (LMS) hoặc `manual` (GV trong LMS).
- Nếu GV manual chỉnh trong LMS → record có `source='manual'` → Presenter không override.
