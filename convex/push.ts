"use node";

import webPush from "web-push";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

/**
 * Web Push notification cho SV — gửi qua browser push service (FCM/Mozilla, FREE).
 *
 * Cần VAPID keys: chạy `npx web-push generate-vapid-keys` (1 lần).
 * Set env qua: `npx convex env set VAPID_PUBLIC_KEY ...`,
 *              `npx convex env set VAPID_PRIVATE_KEY ...`,
 *              `npx convex env set VAPID_SUBJECT mailto:you@example.com`.
 *
 * Public key cũng phải set ở Next.js env (NEXT_PUBLIC_VAPID_PUBLIC_KEY) để client subscribe.
 */

type PayloadInput = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export const sendActivityNotification = internalAction({
  args: {
    sessionId: v.id("sessions"),
    activityId: v.id("activities"),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sent: number; failed?: number; total?: number; skipped?: boolean }> => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@example.com";

    if (!publicKey || !privateKey) {
      console.warn(
        "[push] VAPID keys chưa cấu hình — bỏ qua notification. Chạy: npx web-push generate-vapid-keys"
      );
      return { sent: 0, skipped: true };
    }

    webPush.setVapidDetails(subject, publicKey, privateKey);

    const subscriptions: Doc<"pushSubscriptions">[] = await ctx.runQuery(
      api.pushSubscriptions.listSubscriptionsForSession,
      { sessionId: args.sessionId }
    );

    if (subscriptions.length === 0) {
      return { sent: 0, total: 0 };
    }

    const payload: PayloadInput = {
      title: args.title,
      body: args.body,
      url: args.url,
      tag: `activity-${args.activityId}`,
    };

    let sent = 0;
    let failed = 0;
    const goneIds: string[] = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
            { TTL: 60 }
          );
          sent++;
        } catch (e: unknown) {
          failed++;
          const status =
            e && typeof e === "object" && "statusCode" in e
              ? (e as { statusCode?: number }).statusCode
              : undefined;
          // 404/410 = subscription đã bị huỷ → xoá khỏi DB
          if (status === 404 || status === 410) {
            goneIds.push(sub._id);
          }
        }
      })
    );

    if (goneIds.length > 0) {
      await ctx.runMutation(internal.pushSubscriptions.deleteSubscriptionsByIds, {
        ids: goneIds.map((id) => id as unknown as never),
      });
    }

    return { sent, failed, total: subscriptions.length };
  },
});
