import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

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

http.route({
  path: "/lms/create-room",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // Verify shared secret
    const expected = process.env.LMS_PROVISIONING_SECRET;
    if (!expected) {
      return jsonResp(
        { error: "Server chưa cấu hình LMS_PROVISIONING_SECRET" },
        500
      );
    }
    const secret = req.headers.get("x-lms-secret");
    if (secret !== expected) {
      return jsonResp({ error: "Unauthorized: sai secret" }, 401);
    }

    // Parse body
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
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // 4xx-style errors (user-fixable) đi vào 400
      const status =
        msg.includes("không tìm thấy") ||
        msg.includes("chưa được") ||
        msg.includes("đã bị khoá")
          ? 400
          : 500;
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
