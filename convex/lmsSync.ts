"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Gửi webhook attendance tới LMS Supabase edge function.
 *
 * Trigger từ joinSession qua scheduler (fire-and-forget — không block SV).
 * Auth qua header `x-presenter-secret` (env LMS_SHARED_SECRET, set giống bên LMS).
 *
 * Edge function code: xem docs/lms-integration.md
 */
export const sendAttendanceToLms = internalAction({
  args: {
    webhookUrl: v.optional(v.string()),  // Optional — fallback env LMS_SYNC_URL nếu không truyền
    lmsSessionId: v.string(),
    studentId: v.string(),
    studentName: v.string(),
    attendanceStatus: v.union(
      v.literal("present"),
      v.literal("late"),
      v.literal("excused"),
      v.literal("absent"),
      v.literal("early_leave")
    ),
    checkinTime: v.number(),
  },
  handler: async (_ctx, args) => {
    const secret = process.env.LMS_SHARED_SECRET ?? process.env.LMS_SYNC_SECRET;
    if (!secret) {
      console.warn("[lmsSync] LMS_SHARED_SECRET / LMS_SYNC_SECRET chưa cấu hình — bỏ qua webhook");
      return { sent: false, reason: "no_secret" };
    }

    // Resolve URL: arg trước, fallback env
    const url = args.webhookUrl || process.env.LMS_SYNC_URL;
    if (!url || !args.lmsSessionId) {
      console.warn("[lmsSync] Không có webhookUrl + không có env LMS_SYNC_URL — bỏ qua");
      return { sent: false, reason: "no_url" };
    }

    // Map internal status → LMS status code (LMS DB dùng left_early, không phải early_leave)
    const lmsStatus = args.attendanceStatus === "early_leave" ? "left_early" : args.attendanceStatus;
    const body = JSON.stringify({
      lms_session_id: args.lmsSessionId,
      student_id: args.studentId,
      student_name: args.studentName,
      attendance_status: lmsStatus,
      checkin_time: new Date(args.checkinTime).toISOString(),
    });

    // Retry exponential backoff: 1s → 3s → 10s. 4 attempts max.
    // CHỈ retry cho network error + 5xx (LMS-side tạm trục trặc).
    // KHÔNG retry cho 4xx (sai body/auth → retry cũng vô ích, có thể spam log).
    const delays = [0, 1000, 3000, 10000];
    let lastError: { status?: number; body?: string; error?: string } | null = null;

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-presenter-secret": secret,
          },
          body,
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return { sent: true, response: data, attempts: attempt + 1 };
        }

        const text = await res.text();
        lastError = { status: res.status, body: text.slice(0, 200) };

        // 4xx (auth/bad request): không retry, fail luôn
        if (res.status >= 400 && res.status < 500) {
          console.error(
            `[lmsSync] LMS webhook 4xx (${res.status}) — không retry: ${text.slice(0, 200)}`
          );
          return { sent: false, ...lastError, attempts: attempt + 1 };
        }

        // 5xx: log + retry
        console.warn(
          `[lmsSync] LMS webhook 5xx attempt ${attempt + 1}/${delays.length} (${res.status})`
        );
      } catch (e: unknown) {
        // Network error → retry
        const msg = e instanceof Error ? e.message : String(e);
        lastError = { error: msg };
        console.warn(
          `[lmsSync] LMS webhook network err attempt ${attempt + 1}/${delays.length}: ${msg}`
        );
      }
    }

    console.error(
      `[lmsSync] LMS webhook FAILED sau ${delays.length} attempt:`,
      lastError
    );
    return { sent: false, ...(lastError ?? {}), attempts: delays.length };
  },
});
