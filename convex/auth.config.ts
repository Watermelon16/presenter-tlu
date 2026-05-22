/**
 * Convex Auth config — tell Convex how to validate JWT tokens issued by @convex-dev/auth.
 *
 * Tokens có claim `iss = CONVEX_SITE_URL`, `aud = "convex"`. Convex match với
 * provider này → cho phép truy cập.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
