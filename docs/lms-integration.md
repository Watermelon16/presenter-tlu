# Đồng bộ Presenter TLU ↔ LMS (lephuong-tlu)

## Tổng quan

LMS dùng Supabase, schema chính cho điểm danh (đã verify từ codebase Lovable):
- `attendance_sessions` (id, class_id, status, qr_secret, qr_enabled, qr_refresh_seconds, start_time)
- `attendance_records` (session_id, class_id, student_id, status_code, source, checkin_time, notes, flags, ip_address, user_agent)
- `class_roster` (class_id, student_id, student_name)
- `attendance_audit_logs`

LMS Supabase project: **`eivzlyfazixnkucnoyzu`**
- URL: `https://eivzlyfazixnkucnoyzu.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/eivzlyfazixnkucnoyzu

LMS đã có sẵn function `attendance-qr` (cho QR rotate 20s nội bộ LMS) — **KHÔNG reuse được vì cần HMAC token**.
→ Phải deploy thêm function mới `presenter-sync` (dưới đây).

## Workflow

1. **GV tạo `attendance_session` trên LMS** trước buổi học (UI có sẵn).
2. **Copy UUID** của session đó từ LMS.
3. **Trên Presenter**, mở modal Điểm danh → ⚙️ Cài đặt → dán webhook URL + LMS session ID.
4. **SV quét QR Presenter** → join → Presenter POST `presenter-sync` → tự tạo `attendance_record` với `source: "presenter"`.
5. GV có thể vào LMS xem lại, chỉnh tay (sẽ thành `source: "manual"` → Presenter không override).

## Bước 1 — Deploy edge function `presenter-sync` lên Supabase LMS

### Cách A: Qua Supabase Dashboard (low-code, khuyên dùng)

1. Vào https://supabase.com/dashboard/project/eivzlyfazixnkucnoyzu
2. Sidebar trái → ⚡ **Edge Functions** → **Deploy a new function**
3. **Function name**: `presenter-sync`
4. **Verify JWT**: **TẮT** (toggle off — vì Presenter không có Supabase JWT)
5. Xóa code mẫu, paste toàn bộ code dưới đây
6. Click **Deploy function**

### Code function `presenter-sync/index.ts`

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

// Map Presenter status → LMS status_code
const STATUS_MAP: Record<string, string> = {
  present: "present",
  late: "late",
  excused: "excused",
  absent: "absent",
  early_leave: "early_leave",
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

    // Verify SV có trong roster của class này (khớp với attendance-qr logic)
    const { data: roster } = await admin
      .from("class_roster")
      .select("student_id, student_name")
      .eq("class_id", session.class_id)
      .eq("student_id", studentId)
      .maybeSingle();
    if (!roster) {
      return json({ error: "Student not in class roster", student_id: studentId }, 403);
    }

    // Tên không khớp roster → flag để GV review
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
    const nameMismatch = roster.student_name && norm(studentName) !== norm(roster.student_name);
    const notes = nameMismatch
      ? `Presenter TLU — Tên khai: ${studentName} (roster: ${roster.student_name})`
      : `Presenter TLU — ${studentName}`;
    const flags = nameMismatch ? { name_mismatch: true, submitted_name: studentName } : {};

    // Upsert attendance_record
    const { data: existing } = await admin
      .from("attendance_records")
      .select("id, source")
      .eq("session_id", lmsSessionId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (existing) {
      // Không override nếu GV đã chỉnh tay trong LMS
      if (existing.source === "manual") {
        return json({ ok: true, skipped: "manual_override" });
      }
      const { error: updErr } = await admin
        .from("attendance_records")
        .update({
          status_code: statusCode,
          source: "presenter",
          checkin_time: checkinTime,
          notes,
          flags,
        })
        .eq("id", existing.id);
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true, updated: true, status_code: statusCode });
    }

    const { error: insErr } = await admin.from("attendance_records").insert({
      session_id: lmsSessionId,
      class_id: session.class_id,
      student_id: studentId,
      status_code: statusCode,
      source: "presenter",
      checkin_time: checkinTime,
      notes,
      flags,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    // Audit log (giống pattern của attendance-qr)
    await admin.from("attendance_audit_logs").insert({
      entity_type: "attendance_record",
      action: "presenter_sync",
      class_id: session.class_id,
      entity_id: lmsSessionId,
      new_value: { student_id: studentId, status_code: statusCode, source: "presenter" },
    });

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

## Bước 2 — Set shared secret trên Supabase

1. Tạo random secret. Trên máy bạn mở Terminal (macOS):
   ```bash
   openssl rand -hex 32
   ```
   Copy chuỗi 64 ký tự hex ra (vd: `a3f8b1c9...`).

2. Vào Supabase Dashboard → **Project Settings** (⚙️ góc dưới sidebar) → **Edge Functions** → tab **Secrets** → **Add new secret**:
   - Name: `PRESENTER_SHARED_SECRET`
   - Value: chuỗi vừa tạo
   - **Save**

3. **Lấy function URL**: trở lại tab Edge Functions → click vào `presenter-sync` → copy URL có dạng:
   ```
   https://eivzlyfazixnkucnoyzu.supabase.co/functions/v1/presenter-sync
   ```

## Bước 3 — Set secret trên Convex (Presenter)

Trên máy bạn (trong thư mục `tkbaigiang`), mở Terminal chạy:
```bash
npx convex env set --prod LMS_SHARED_SECRET <chuỗi-secret-giống-Supabase>
```

(Hoặc bảo Claude làm giúp — Claude có quyền chạy Convex CLI.)

## Bước 4 — Cấu hình Presenter

Trong modal "📋 Điểm danh" → ⚙️ Cài đặt:
- **Ngưỡng đi muộn**: 10 phút (default)
- **LMS Webhook URL**: dán URL ở Bước 2.3
- **LMS Session ID**: UUID của `attendance_sessions` đã tạo trên LMS cho buổi này
  - Lấy UUID: vào LMS → trang attendance session → URL có dạng `/sessions/<uuid>` → copy phần `<uuid>`
- Bấm **Lưu cài đặt**

## Bước 5 — Test end-to-end

1. Mở Presenter → tạo session → mở Điểm danh → cấu hình như Bước 4
2. SV quét QR Presenter → nhập MSV + tên
3. Sau ~1 giây vào LMS → trang attendance session → record SV hiện ra với `source: presenter`, `status_code: present` (hoặc `late` nếu quét sau ngưỡng)
4. Nếu KHÔNG hiện → check Convex logs (`npx convex logs --prod`) tìm dòng `[lmsSync]` để xem lỗi (401 = sai secret, 403 = SV không có trong roster, 404 = sai UUID session)

## Mapping status codes

| Presenter | LMS `status_code` |
|---|---|
| `present` (≤T₀+10p) | `present` |
| `late` (>T₀+10p) | `late` |
| `excused` (GV chỉnh) | `excused` |
| `absent` (GV chỉnh) | `absent` |
| `early_leave` (GV chỉnh) | `early_leave` |

Đảm bảo LMS `attendance_status_configs` của class có 5 status code này.

## Lưu ý quan trọng

- Edge function dùng `service_role` key → bypass RLS, không cần GV login.
- Auth qua `x-presenter-secret` header — đừng commit secret vào git.
- SV phải có trong `class_roster` của lớp đó, nếu không sẽ bị reject 403.
- Tên SV khai không khớp roster → vẫn record nhưng có `flags.name_mismatch=true` để GV review.
- Nếu GV vào LMS chỉnh tay → record có `source='manual'` → Presenter không override khi sync lại.
- Function này độc lập với `attendance-qr` của LMS — không xung đột.
