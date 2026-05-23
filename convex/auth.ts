import Google from "@auth/core/providers/google";
import MicrosoftEntraID from "@auth/core/providers/microsoft-entra-id";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Convex Auth — Google OAuth + Microsoft Entra ID cho giảng viên.
 *
 * 2 patches cần thiết cho MS provider:
 * 1. token_endpoint_auth_method = "client_secret_post" + bỏ PKCE:
 *    Default config (basic auth + PKCE) bị Microsoft v2.0 single-tenant
 *    reject ở token exchange. Manual test với client_secret_post (body)
 *    không PKCE đã prove hoạt động.
 * 2. Strip null image trong profile(): MS Graph trả image=null khi SV
 *    không có avatar → schema users.image v.optional(v.string()) reject
 *    null (chỉ accept undefined). Bỏ image nếu null.
 */
const msBase = MicrosoftEntraID({
  issuer:
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ||
    "https://login.microsoftonline.com/common/v2.0",
});

const originalProfile = msBase.profile;

const msProvider = {
  ...msBase,
  checks: ["state", "nonce"] as ("state" | "nonce" | "pkce")[],
  client: {
    ...(msBase as { client?: Record<string, unknown> }).client,
    token_endpoint_auth_method: "client_secret_post",
  },
  profile: async (profile: Record<string, unknown>, tokens: unknown) => {
    const result = (await originalProfile?.(
      profile as never,
      tokens as never
    )) as { id?: string; name?: string; email?: string; image?: string | null };
    if (result?.image === null) {
      delete result.image;
    }
    return result;
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, msProvider],
});
