import Google from "@auth/core/providers/google";
import MicrosoftEntraID from "@auth/core/providers/microsoft-entra-id";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Convex Auth — Google OAuth + Microsoft Entra ID (Azure AD) cho giảng viên.
 *
 * Google: cho GV có Gmail cá nhân hoặc tài khoản Google Workspace
 * Microsoft: cho GV có email Microsoft 365 (đặc biệt @tlu.edu.vn — TLU dùng MS)
 *
 * Cần env vars (Convex):
 *   AUTH_GOOGLE_ID                       (Google OAuth client ID)
 *   AUTH_GOOGLE_SECRET                   (Google OAuth client secret)
 *   AUTH_MICROSOFT_ENTRA_ID_ID           (MS Entra app client ID)
 *   AUTH_MICROSOFT_ENTRA_ID_SECRET       (MS Entra app client secret)
 *   AUTH_MICROSOFT_ENTRA_ID_ISSUER       (optional, default common = multi-tenant)
 *   JWT_PRIVATE_KEY        (auto-gen từ `npx @convex-dev/auth`)
 *   JWKS                   (auto-gen)
 *   SITE_URL               (vd https://presenter-tlu.vercel.app)
 *
 * Setup Microsoft OAuth: portal.azure.com → App registrations → New
 *   - Supported accounts: "Accounts in any organizational directory (multi-tenant)"
 *   - Redirect URI: <CONVEX_SITE_URL>/api/auth/callback/microsoft-entra-id
 *     vd https://chatty-hornet-671.convex.site/api/auth/callback/microsoft-entra-id
 *   - Lấy Application (client) ID → set AUTH_MICROSOFT_ENTRA_ID_ID
 *   - Certificates & secrets → New client secret → set AUTH_MICROSOFT_ENTRA_ID_SECRET
 *
 * Setup Google OAuth: console.cloud.google.com → APIs & Services → Credentials
 *   - Authorized redirect URI: <CONVEX_SITE_URL>/api/auth/callback/google
 *     vd https://chatty-hornet-671.convex.site/api/auth/callback/google
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    MicrosoftEntraID({
      // tenant common = multi-tenant (chấp nhận tất cả Microsoft accounts:
      // @tlu.edu.vn, @outlook.com, @hotmail.com, work/school accounts...)
      // Nếu muốn chỉ chấp nhận @tlu.edu.vn, đặt AUTH_MICROSOFT_ENTRA_ID_ISSUER
      // = https://login.microsoftonline.com/<TLU_TENANT_ID>/v2.0
      issuer:
        process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ||
        "https://login.microsoftonline.com/common/v2.0",
    }),
  ],
});
