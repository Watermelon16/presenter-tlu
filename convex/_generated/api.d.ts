/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities from "../activities.js";
import type * as activityAiReview from "../activityAiReview.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as board from "../board.js";
import type * as engagement from "../engagement.js";
import type * as files from "../files.js";
import type * as grading from "../grading.js";
import type * as gradingData from "../gradingData.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as insightsData from "../insightsData.js";
import type * as leaderboard from "../leaderboard.js";
import type * as lms from "../lms.js";
import type * as lmsProvisioning from "../lmsProvisioning.js";
import type * as lmsSync from "../lmsSync.js";
import type * as msDebug from "../msDebug.js";
import type * as participants from "../participants.js";
import type * as pdfHotspots from "../pdfHotspots.js";
import type * as presence from "../presence.js";
import type * as push from "../push.js";
import type * as pushSubscriptions from "../pushSubscriptions.js";
import type * as reactions from "../reactions.js";
import type * as responses from "../responses.js";
import type * as scriptTemplates from "../scriptTemplates.js";
import type * as sessionSummary from "../sessionSummary.js";
import type * as sessions from "../sessions.js";
import type * as slideNotes from "../slideNotes.js";
import type * as userProfiles from "../userProfiles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activities: typeof activities;
  activityAiReview: typeof activityAiReview;
  ai: typeof ai;
  auth: typeof auth;
  authz: typeof authz;
  board: typeof board;
  engagement: typeof engagement;
  files: typeof files;
  grading: typeof grading;
  gradingData: typeof gradingData;
  http: typeof http;
  insights: typeof insights;
  insightsData: typeof insightsData;
  leaderboard: typeof leaderboard;
  lms: typeof lms;
  lmsProvisioning: typeof lmsProvisioning;
  lmsSync: typeof lmsSync;
  msDebug: typeof msDebug;
  participants: typeof participants;
  pdfHotspots: typeof pdfHotspots;
  presence: typeof presence;
  push: typeof push;
  pushSubscriptions: typeof pushSubscriptions;
  reactions: typeof reactions;
  responses: typeof responses;
  scriptTemplates: typeof scriptTemplates;
  sessionSummary: typeof sessionSummary;
  sessions: typeof sessions;
  slideNotes: typeof slideNotes;
  userProfiles: typeof userProfiles;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
