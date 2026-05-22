import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Convex Auth — Google OAuth cho giảng viên.
 *
 * Cần env vars (Convex):
 *   AUTH_GOOGLE_ID         (Google OAuth client ID)
 *   AUTH_GOOGLE_SECRET     (Google OAuth client secret)
 *   JWT_PRIVATE_KEY        (auto-gen từ `npx @convex-dev/auth`)
 *   JWKS                   (auto-gen)
 *   SITE_URL               (vd https://presenter-tlu.vercel.app)
 *
 * Setup Google OAuth: console.cloud.google.com → APIs & Services → Credentials
 *   - Authorized redirect URI: <CONVEX_SITE_URL>/api/auth/callback/google
 *     vd https://chatty-hornet-671.convex.site/api/auth/callback/google
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
});
