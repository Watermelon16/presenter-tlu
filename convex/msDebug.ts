// Debug helpers — có thể xóa sau khi MS auth ổn định.
// Giữ tạm để check env / token exchange nếu cần troubleshoot.
"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const debugMsTokenExchange = internalAction({
  args: { code: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID || "";
    const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET || "";
    const issuer =
      process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ||
      "https://login.microsoftonline.com/common/v2.0";
    const tenantMatch = issuer.match(/microsoftonline\.com\/([^/]+)\/v2\.0/);
    const tenantId = tenantMatch?.[1] || "common";
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const redirectUri =
      "https://chatty-hornet-671.convex.site/api/auth/callback/microsoft-entra-id";

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: args.code || "FAKE_CODE",
      redirect_uri: redirectUri,
      scope: "openid profile email User.Read",
    });
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return {
      tokenUrl,
      redirectUri,
      clientIdLen: clientId.length,
      clientSecretLen: clientSecret.length,
      status: res.status,
      body: parsed,
    };
  },
});
