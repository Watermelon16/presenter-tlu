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

    try {
      // Map internal status → LMS status code (LMS DB dùng left_early, không phải early_leave)
      const lmsStatus = args.attendanceStatus === "early_leave" ? "left_early" : args.attendanceStatus;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-presenter-secret": secret,
        },
        body: JSON.stringify({
          lms_session_id: args.lmsSessionId,
          student_id: args.studentId,
          student_name: args.studentName,
          attendance_status: lmsStatus,
          checkin_time: new Date(args.checkinTime).toISOString(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(
          `[lmsSync] LMS webhook lỗi (${res.status}): ${text.slice(0, 200)}`
        );
        return { sent: false, status: res.status, body: text.slice(0, 200) };
      }

      const data = await res.json().catch(() => ({}));
      return { sent: true, response: data };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[lmsSync] Webhook fetch failed:", msg);
      return { sent: false, error: msg };
    }
  },
});
