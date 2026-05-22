import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Wire auth routes: /api/auth/signin, /api/auth/callback/google, /api/auth/signout, ...
auth.addHttpRoutes(http);

export default http;
