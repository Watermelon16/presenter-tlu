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
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

export const config = {
  // Match all routes except next internals + files with extensions
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
