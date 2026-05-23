import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

// Helper: extract clean message + status from caught error.
// ConvexError (thrown từ internal mutation) → message ở .data, dùng 404 nếu nói "Không tìm thấy".
// Raw Error → message ở .message.
function errorResponse(e: unknown): { msg: string; status: number } {
  if (e instanceof ConvexError) {
    const msg = String(e.data ?? "Lỗi máy chủ");
    return { msg, status: msg.includes("Không tìm thấy") ? 404 : 400 };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { msg, status: 500 };
}

const http = httpRouter();

// Wire OAuth callback + /.well-known/jwks.json + /.well-known/openid-configuration
// LƯU Ý: KHÔNG tạo convex/auth.config.ts — file đó là pattern cũ, conflict với @convex-dev/auth.
auth.addHttpRoutes(http);

// ============================================================
// LMS Integration — LMS gọi endpoint này để auto-provision Presenter room
// khi GV tạo attendance_session bên LMS.
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-lms-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

http.route({
  path: "/lms/create-room",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

function checkSecret(req: Request): { ok: true } | { ok: false; res: Response } {
  const expected = process.env.LMS_PROVISIONING_SECRET;
  if (!expected) {
    return { ok: false, res: jsonResp({ error: "Server chưa cấu hình LMS_PROVISIONING_SECRET" }, 500) };
  }
  const secret = req.headers.get("x-lms-secret");
  if (secret !== expected) {
    return { ok: false, res: jsonResp({ error: "Unauthorized: sai secret" }, 401) };
  }
  return { ok: true };
}

function parseRoster(raw: unknown): Array<{ studentCode: string; fullName: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = (item ?? {}) as Record<string, unknown>;
      return {
        studentCode: String(r.student_code ?? r.studentCode ?? "").trim(),
        fullName: String(r.full_name ?? r.fullName ?? r.student_name ?? "").trim(),
      };
    })
    .filter((r) => !!r.studentCode);
}

http.route({
  path: "/lms/create-room",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = checkSecret(req);
    if (!auth.ok) return auth.res;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResp({ error: "Invalid JSON body" }, 400);
    }
    const b = body as Record<string, unknown>;
    const lmsSessionId = String(b.lms_session_id || "").trim();
    const title = String(b.title || "").trim();
    const hostEmail = String(b.host_email || "")
      .trim()
      .toLowerCase();
    if (!lmsSessionId || !title || !hostEmail) {
      return jsonResp(
        { error: "Thiếu lms_session_id / title / host_email" },
        400
      );
    }

    try {
      const result = await ctx.runMutation(
        internal.lmsProvisioning.createSessionFromLms,
        {
          lmsSessionId,
          title,
          hostEmail,
          hostName: b.host_name ? String(b.host_name).trim() : undefined,
          className: b.class_name ? String(b.class_name).trim() : undefined,
          lmsClassId: b.lms_class_id ? String(b.lms_class_id).trim() : undefined,
          roster: parseRoster(b.roster),
        }
      );

      const publicUrl =
        process.env.PRESENTER_PUBLIC_URL || "https://presenter-tlu.vercel.app";

      return jsonResp({
        ok: true,
        code: result.code,
        url: `${publicUrl}/room/${result.code}`,
        session_id: result.sessionId,
        created: result.created,
        roster_count: result.rosterCount,
      });
    } catch (e: unknown) {
      const { msg } = errorResponse(e);
      // 4xx-style errors (user-fixable) đi vào 400, còn lại 500
      const status =
        msg.includes("không tìm thấy") ||
        msg.includes("chưa được") ||
        msg.includes("đã bị khoá") ||
        msg.includes("Không tìm thấy")
          ? 400
          : 500;
      return jsonResp({ error: msg }, status);
    }
  }),
});

// ─── /lms/session-opened ───────────────────────────────────────────────────
http.route({
  path: "/lms/session-opened",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});
http.route({
  path: "/lms/session-opened",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = checkSecret(req);
    if (!auth.ok) return auth.res;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const lmsSessionId = String(body.lms_session_id ?? "").trim();
      if (!lmsSessionId) return jsonResp({ error: "Thiếu lms_session_id" }, 400);
      const openAt = body.start_time ? new Date(String(body.start_time)).getTime() : Date.now();
      if (!Number.isFinite(openAt)) return jsonResp({ error: "start_time không hợp lệ" }, 400);
      const result = await ctx.runMutation(internal.lms.setAttendanceOpenAt, {
        lmsSessionId,
        openAt,
        lateCutoffMinutes: body.late_cutoff_minutes ? Number(body.late_cutoff_minutes) : undefined,
        absentAfterMinutes: body.absent_after_minutes ? Number(body.absent_after_minutes) : undefined,
      });
      return jsonResp({ ok: true, ...result });
    } catch (e) {
      const { msg, status } = errorResponse(e);
      return jsonResp({ error: msg }, status);
    }
  }),
});

// ─── /lms/student-checkin (SV scan QR LMS → mirror sang Presenter) ─────────
http.route({
  path: "/lms/student-checkin",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});
http.route({
  path: "/lms/student-checkin",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = checkSecret(req);
    if (!auth.ok) return auth.res;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const lmsSessionId = String(body.lms_session_id ?? "").trim();
      const studentCode = String(body.student_id ?? "").trim();
      const fullName = String(body.student_name ?? "").trim();
      if (!lmsSessionId || !studentCode) {
        return jsonResp({ error: "Thiếu lms_session_id hoặc student_id" }, 400);
      }
      const checkinAt = body.checkin_time ? new Date(String(body.checkin_time)).getTime() : Date.now();
      const statusFromLms = typeof body.status_code === "string" ? body.status_code : undefined;

      const result = await ctx.runMutation(internal.lms.upsertParticipantFromLms, {
        lmsSessionId,
        studentCode,
        fullName: fullName || studentCode,
        checkinAt,
        statusFromLms,
      });
      return jsonResp({ ok: true, ...result });
    } catch (e) {
      const { msg, status } = errorResponse(e);
      return jsonResp({ error: msg }, status);
    }
  }),
});

// ─── /lms/sync-roster ──────────────────────────────────────────────────────
http.route({
  path: "/lms/sync-roster",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});
http.route({
  path: "/lms/sync-roster",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = checkSecret(req);
    if (!auth.ok) return auth.res;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const lmsSessionId = String(body.lms_session_id ?? "").trim();
      if (!lmsSessionId) return jsonResp({ error: "Thiếu lms_session_id" }, 400);
      const roster = parseRoster(body.roster);
      const result = await ctx.runMutation(internal.lms.syncRosterFromLms, {
        lmsSessionId,
        roster,
      });
      return jsonResp({ ok: true, ...result });
    } catch (e) {
      const { msg, status } = errorResponse(e);
      return jsonResp({ error: msg }, status);
    }
  }),
});

// ─── /lms/session-deleted ─────────────────────────────────────────────────
// LMS gọi khi GV xóa attendance_session → Presenter cascade delete toàn bộ data.
http.route({
  path: "/lms/session-deleted",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});
http.route({
  path: "/lms/session-deleted",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = checkSecret(req);
    if (!auth.ok) return auth.res;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const lmsSessionId = String(body.lms_session_id ?? "").trim();
      if (!lmsSessionId) return jsonResp({ error: "Thiếu lms_session_id" }, 400);
      const result = await ctx.runMutation(internal.lms.deleteSessionByLmsId, { lmsSessionId });
      return jsonResp(result);
    } catch (e) {
      const { msg, status } = errorResponse(e);
      return jsonResp({ error: msg }, status);
    }
  }),
});

// ─── /lms/session-closed ───────────────────────────────────────────────────
http.route({
  path: "/lms/session-closed",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});
http.route({
  path: "/lms/session-closed",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = checkSecret(req);
    if (!auth.ok) return auth.res;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const lmsSessionId = String(body.lms_session_id ?? "").trim();
      if (!lmsSessionId) return jsonResp({ error: "Thiếu lms_session_id" }, 400);
      const closedAt = body.closed_at ? new Date(String(body.closed_at)).getTime() : Date.now();
      const result = await ctx.runMutation(internal.lms.finalizeAttendance, {
        lmsSessionId,
        closedAt,
      });
      return jsonResp({ ok: true, ...result });
    } catch (e) {
      const { msg, status } = errorResponse(e);
      return jsonResp({ error: msg }, status);
    }
  }),
});

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export default http;
