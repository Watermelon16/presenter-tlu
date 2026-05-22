import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Wire OAuth callback + /.well-known/jwks.json + /.well-known/openid-configuration
// LƯU Ý: KHÔNG tạo convex/auth.config.ts — file đó là pattern cũ, conflict với @convex-dev/auth.
auth.addHttpRoutes(http);

export default http;
