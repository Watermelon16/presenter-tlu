import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
  isAuthenticatedNextjs,
} from "@convex-dev/auth/nextjs/server";

/**
 * Route protection:
 * - PUBLIC (SV): /login, /join, /room/*, /me, /sw.js, static
 * - PROTECTED (GV): / (home), /presenter/*, /admin
 *
 * Middleware redirect protected route → /login nếu chưa auth.
 */
const isPublicRoute = createRouteMatcher([
  "/login",
  "/join",
  "/room/(.*)",
  "/me",
  "/sw.js",
]);

export default convexAuthNextjsMiddleware(async (request) => {
  const isPublic = isPublicRoute(request);
  if (isPublic) return;
  const authed = await isAuthenticatedNextjs();
  if (!authed) {
    // Lưu URL gốc (path + query) vào ?next= để login xong redirect đúng chỗ.
    // Tránh redirect-loop khi đã ở /login (không vào nhánh này vì isPublic).
    const url = new URL(request.url);
    const next = url.pathname + url.search;
    // Chỉ giữ next nếu là internal path (an toàn, không phải URL ngoài)
    const safe = next.startsWith("/") && !next.startsWith("//") && next !== "/login";
    const target = safe ? `/login?next=${encodeURIComponent(next)}` : "/login";
    return nextjsMiddlewareRedirect(request, target);
  }
});

export const config = {
  // Match all routes except next internals + files with extensions
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
