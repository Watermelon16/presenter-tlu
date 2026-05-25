import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * User profile management.
 *
 * Flow:
 * - User đăng nhập Google lần đầu → Convex Auth tạo users row.
 * - `ensureProfile` được gọi từ client → tạo userProfiles row (status="pending", role="lecturer").
 * - First user ever → auto-promote thành admin + approved.
 * - Admin có thể approve/ban/promote khác.
 */

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      user: user
        ? {
            _id: user._id,
            email: user.email ?? null,
            name: user.name ?? null,
            image: user.image ?? null,
          }
        : null,
      profile: profile
        ? {
            _id: profile._id,
            status: profile.status,
            role: profile.role,
            displayName: profile.displayName ?? null,
            email: profile.email,
          }
        : null,
    };
  },
});

/**
 * Tạo profile nếu chưa có — gọi mỗi lần user load home.
 * Auto-promote thành admin nếu:
 *   - Email khớp env ADMIN_EMAIL (whitelist tuyệt đối)
 *   - HOẶC đây là user đầu tiên đăng ký (fallback)
 *
 * Đồng thời nếu user EXISTING có email khớp ADMIN_EMAIL nhưng chưa admin
 * → tự động upgrade lên admin + approved. Cho phép bootstrap kể cả khi
 * tài khoản đã đăng nhập trước đó như "lecturer".
 */
export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    const userEmail = (user.email ?? "").trim().toLowerCase();
    const isAdminByEmail = adminEmail.length > 0 && userEmail === adminEmail;

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      // Upgrade existing user nếu email khớp ADMIN_EMAIL và chưa admin/approved
      if (isAdminByEmail && (existing.role !== "admin" || existing.status !== "approved")) {
        await ctx.db.patch(existing._id, {
          role: "admin",
          status: "approved",
          approvedAt: existing.approvedAt ?? Date.now(),
          approvedBy: existing.approvedBy ?? userId,
        });
      }
      return existing._id;
    }

    // First user fallback (khi chưa cấu hình ADMIN_EMAIL)
    const allProfiles = await ctx.db.query("userProfiles").take(1);
    const isFirstUser = allProfiles.length === 0;
    const shouldBeAdmin = isAdminByEmail || isFirstUser;

    const id = await ctx.db.insert("userProfiles", {
      userId,
      email: user.email ?? "",
      displayName: user.name ?? undefined,
      status: shouldBeAdmin ? "approved" : "pending",
      role: shouldBeAdmin ? "admin" : "lecturer",
      createdAt: Date.now(),
      approvedAt: shouldBeAdmin ? Date.now() : undefined,
      approvedBy: shouldBeAdmin ? userId : undefined,
    });
    return id;
  },
});

/**
 * Internal mutation để bootstrap admin từ CLI: `npx convex run --prod userProfiles:bootstrapAdminByEmail '{"email":"x@y.com"}'`
 * KHÔNG yêu cầu auth — chỉ dùng được qua CLI có quyền admin Convex deployment.
 */
export const bootstrapAdminByEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const target = (args.email ?? "").trim().toLowerCase();
    if (!target) throw new Error("Cần email");

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim()))
      .first();

    if (!profile) {
      // Có thể email được lưu với case khác — thử tìm bằng manual scan
      const all = await ctx.db.query("userProfiles").collect();
      const found = all.find((p) => (p.email ?? "").trim().toLowerCase() === target);
      if (!found) {
        return {
          ok: false,
          message: `Không tìm thấy user với email ${args.email}. User cần đăng nhập Google ít nhất 1 lần để tạo profile trước.`,
          existingEmails: all.map((p) => p.email),
        };
      }
      await ctx.db.patch(found._id, {
        role: "admin",
        status: "approved",
        approvedAt: Date.now(),
      });
      return { ok: true, message: `Đã promote ${found.email} lên admin`, profileId: found._id };
    }

    await ctx.db.patch(profile._id, {
      role: "admin",
      status: "approved",
      approvedAt: Date.now(),
    });
    return { ok: true, message: `Đã promote ${profile.email} lên admin`, profileId: profile._id };
  },
});

/**
 * Internal query liệt kê users không cần auth — dùng cho debug CLI.
 */
export const debugListAllUsers = query({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("userProfiles").collect();
    return profiles.map((p) => ({
      profileId: p._id,
      email: p.email,
      lmsEmail: p.lmsEmail ?? null,
      displayName: p.displayName ?? null,
      role: p.role,
      status: p.status,
      createdAt: p.createdAt,
    }));
  },
});

/**
 * Helper internal — lấy profile từ ctx auth, throw nếu không có hoặc không approved.
 * Sessions/activities mutations dùng để gate access.
 */
export async function requireApprovedUser(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
  db: {
    query: (table: string) => {
      withIndex: (
        idx: string,
        cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown
      ) => { first: () => Promise<Doc<"userProfiles"> | null> };
    };
    get: (id: Id<"users">) => Promise<Doc<"users"> | null>;
  };
}): Promise<{ userId: Id<"users">; profile: Doc<"userProfiles"> }> {
  // Inline implementation — không thể import getAuthUserId vào helper signature gọn vậy.
  // Caller phải gọi getAuthUserId rồi pass userId vào — hoặc dùng requireApprovedUserInline.
  throw new Error("Dùng requireApprovedUserInline thay vì requireApprovedUser");
}

// === Admin management ===

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") return null;

    const profiles = await ctx.db.query("userProfiles").collect();
    return profiles
      .map((p) => ({
        _id: p._id,
        userId: p.userId,
        email: p.email,
        lmsEmail: p.lmsEmail ?? null,
        displayName: p.displayName ?? null,
        status: p.status,
        role: p.role,
        createdAt: p.createdAt,
        approvedAt: p.approvedAt ?? null,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const setUserStatus = mutation({
  args: {
    profileId: v.id("userProfiles"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("banned")
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") throw new Error("Cần quyền admin");

    const target = await ctx.db.get(args.profileId);
    if (!target) throw new Error("Không tìm thấy user");
    // Không cho admin tự ban chính mình
    if (target.userId === userId && args.status !== "approved") {
      throw new Error("Không thể tự thay đổi status của chính mình");
    }

    await ctx.db.patch(args.profileId, {
      status: args.status,
      approvedAt: args.status === "approved" ? Date.now() : target.approvedAt,
      approvedBy: args.status === "approved" ? userId : target.approvedBy,
    });
  },
});

export const setUserRole = mutation({
  args: {
    profileId: v.id("userProfiles"),
    role: v.union(v.literal("admin"), v.literal("lecturer")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") throw new Error("Cần quyền admin");

    const target = await ctx.db.get(args.profileId);
    if (!target) throw new Error("Không tìm thấy user");
    // Không cho hạ vai trò của chính mình (tránh lock-out)
    if (target.userId === userId && args.role !== "admin") {
      throw new Error("Không thể tự hạ vai trò của chính mình");
    }
    await ctx.db.patch(args.profileId, { role: args.role });
  },
});

/**
 * Set lmsEmail cho user — dùng khi GV có email Presenter (Google) khác với
 * email trên LMS. Ví dụ: login Presenter = phuonglh43@gmail.com nhưng tài
 * khoản LMS = phuongle@tlu.edu.vn → admin set lmsEmail của user Presenter
 * = phuongle@tlu.edu.vn để LMS provision endpoint match được.
 *
 * Quyền: admin set cho bất kỳ user nào, lecturer chỉ set cho chính mình.
 */
export const setLmsEmail = mutation({
  args: {
    profileId: v.id("userProfiles"),
    lmsEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me) throw new Error("Profile chưa khởi tạo");

    const target = await ctx.db.get(args.profileId);
    if (!target) throw new Error("Không tìm thấy user");

    // Lecturer chỉ set cho chính mình; admin set cho ai cũng được
    if (me.role !== "admin" && target.userId !== userId) {
      throw new Error("Bạn chỉ có thể chỉnh lmsEmail của chính mình");
    }

    const normalized = args.lmsEmail.trim().toLowerCase();
    if (!normalized) {
      await ctx.db.patch(args.profileId, { lmsEmail: undefined });
      return { cleared: true };
    }

    // Check unique — không cho 2 user dùng cùng 1 lmsEmail
    const collision = await ctx.db
      .query("userProfiles")
      .withIndex("by_lms_email", (q) => q.eq("lmsEmail", normalized))
      .first();
    if (collision && collision._id !== args.profileId) {
      throw new Error(
        `Email LMS "${normalized}" đã được gán cho user khác (${collision.email})`
      );
    }

    await ctx.db.patch(args.profileId, { lmsEmail: normalized });
    return { ok: true, lmsEmail: normalized };
  },
});

/**
 * Bootstrap-only: set lmsEmail từ Convex CLI (không auth).
 * Dùng 1 lần khi setup tích hợp LMS lần đầu. Sau đó dùng `setLmsEmail` qua UI admin.
 */
export const _bootstrapSetLmsEmail = mutation({
  args: {
    email: v.string(),      // Email Presenter (Google login)
    lmsEmail: v.string(),   // Email LMS
  },
  handler: async (ctx, args) => {
    const emailLower = args.email.trim().toLowerCase();
    const lmsEmailLower = args.lmsEmail.trim().toLowerCase();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", emailLower))
      .first();
    if (!profile) throw new Error(`Không có user ${emailLower}`);
    await ctx.db.patch(profile._id, { lmsEmail: lmsEmailLower });
    return { ok: true, email: emailLower, lmsEmail: lmsEmailLower };
  },
});

// === Internal wipe data — admin gọi để reset toàn bộ ===

export const adminWipeAllSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") throw new Error("Cần quyền admin");

    const counts = { sessions: 0, activities: 0, responses: 0, participants: 0, boardPosts: 0, push: 0 };

    const sessions = await ctx.db.query("sessions").collect();
    for (const s of sessions) {
      // Cascade delete
      const acts = await ctx.db
        .query("activities")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const a of acts) {
        if (a.type === "video" && a.config?.videoStorageId) {
          try { await ctx.storage.delete(a.config.videoStorageId); } catch { /* ignore */ }
        }
        await ctx.db.delete(a._id);
        counts.activities++;
      }
      const parts = await ctx.db
        .query("participants")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const p of parts) {
        await ctx.db.delete(p._id);
        counts.participants++;
      }
      const resps = await ctx.db
        .query("responses")
        .withIndex("by_session_and_student", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const r of resps) {
        await ctx.db.delete(r._id);
        counts.responses++;
      }
      const posts = await ctx.db
        .query("boardPosts")
        .filter((q) => q.eq(q.field("sessionId"), s._id))
        .collect();
      for (const p of posts) {
        if (p.imageStorageId) {
          try { await ctx.storage.delete(p.imageStorageId); } catch { /* ignore */ }
        }
        await ctx.db.delete(p._id);
        counts.boardPosts++;
      }
      const subs = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const sub of subs) {
        await ctx.db.delete(sub._id);
        counts.push++;
      }
      if (s.pdfStorageId) {
        try {
          await ctx.storage.delete(s.pdfStorageId);
        } catch {}
      }
      await ctx.db.delete(s._id);
      counts.sessions++;
    }
    return counts;
  },
});

/** Lấy size 1 file từ Convex _storage. Trả 0 nếu không tìm thấy. */
async function getStorageSize(
  ctx: { db: { system: { get: (id: Id<"_storage">) => Promise<{ size: number } | { size?: undefined } | null> } } },
  storageId: Id<"_storage">
): Promise<number> {
  const meta = await ctx.db.system.get(storageId);
  return meta && "size" in meta && typeof meta.size === "number" ? meta.size : 0;
}

/**
 * Báo cáo dùng tài nguyên Convex (admin-only): file storage + document counts.
 * Free tier giới hạn: file storage 1 GiB, database storage ~0.5 GiB, function
 * call 1M/tháng, document ~100k. Query này iterate tất cả docs có storage ref
 * + gọi ctx.db.system.get(storageId) để lấy size từng file.
 *
 * Chi phí: O(N_sessions + N_videoActivities + N_boardImages) reads + getMetadata
 * calls. Với project nhỏ (<200 sessions) chạy <2s. Project lớn cần cache/paginate.
 */
export const getResourceUsage = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") throw new Error("Cần quyền admin");

    const sessions = await ctx.db.query("sessions").collect();
    const activities = await ctx.db.query("activities").collect();
    const boardPosts = await ctx.db.query("boardPosts").collect();
    const responses = await ctx.db.query("responses").collect();
    const participants = await ctx.db.query("participants").collect();
    const rosters = await ctx.db.query("rosterCache").collect();
    const pushSubs = await ctx.db.query("pushSubscriptions").collect();

    let pdfBytes = 0, videoBytes = 0, imageBytes = 0;
    let pdfCount = 0, videoCount = 0, imageCount = 0;
    type SessBytes = { pdf: number; video: number; image: number; total: number };
    const sessionBytes = new Map<string, SessBytes>();
    const bump = (sid: string, key: keyof SessBytes, n: number) => {
      const cur = sessionBytes.get(sid) ?? { pdf: 0, video: 0, image: 0, total: 0 };
      cur[key] += n;
      cur.total += n;
      sessionBytes.set(sid, cur);
    };

    for (const s of sessions) {
      if (s.pdfStorageId) {
        const size = await getStorageSize(ctx, s.pdfStorageId);
        if (size > 0) {
          pdfBytes += size;
          pdfCount++;
          bump(s._id, "pdf", size);
        }
      }
    }

    for (const a of activities) {
      if (a.type === "video" && a.config?.videoStorageId) {
        const size = await getStorageSize(ctx, a.config.videoStorageId);
        if (size > 0) {
          videoBytes += size;
          videoCount++;
          bump(a.sessionId, "video", size);
        }
      }
    }

    for (const p of boardPosts) {
      if (p.imageStorageId) {
        const size = await getStorageSize(ctx, p.imageStorageId);
        if (size > 0) {
          imageBytes += size;
          imageCount++;
          bump(p.sessionId, "image", size);
        }
      }
    }

    const sessionMap = new Map(sessions.map((s) => [s._id, s]));
    const topSessions = Array.from(sessionBytes.entries())
      .map(([sid, b]) => {
        const s = sessionMap.get(sid as Id<"sessions">);
        return s
          ? {
              sessionId: sid as Id<"sessions">,
              code: s.code,
              title: s.title,
              createdAt: s.createdAt,
              status: s.status,
              ...b,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Free tier limits
    const FREE_FILE_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GiB
    const totalFileBytes = pdfBytes + videoBytes + imageBytes;

    return {
      computedAt: Date.now(),
      limits: { fileStorageBytes: FREE_FILE_STORAGE_BYTES },
      file: {
        totalBytes: totalFileBytes,
        pdfBytes,
        videoBytes,
        imageBytes,
        pdfCount,
        videoCount,
        imageCount,
        usagePercent: (totalFileBytes / FREE_FILE_STORAGE_BYTES) * 100,
      },
      docCounts: {
        sessions: sessions.length,
        activities: activities.length,
        responses: responses.length,
        boardPosts: boardPosts.length,
        participants: participants.length,
        rosterCache: rosters.length,
        pushSubscriptions: pushSubs.length,
        total:
          sessions.length + activities.length + responses.length + boardPosts.length +
          participants.length + rosters.length + pushSubs.length,
      },
      topSessions,
    };
  },
});

/**
 * Phiên bản nhẹ: chỉ trả % để hiện warning banner cho admin trên home,
 * không tính top sessions để query nhanh hơn.
 */
export const getResourceUsagePercent = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const me = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!me || me.role !== "admin") return null;

    const sessions = await ctx.db.query("sessions").collect();
    const activities = await ctx.db.query("activities").collect();
    const boardPosts = await ctx.db.query("boardPosts").collect();

    let totalBytes = 0;
    for (const s of sessions) {
      if (s.pdfStorageId) totalBytes += await getStorageSize(ctx, s.pdfStorageId);
    }
    for (const a of activities) {
      if (a.type === "video" && a.config?.videoStorageId) {
        totalBytes += await getStorageSize(ctx, a.config.videoStorageId);
      }
    }
    for (const p of boardPosts) {
      if (p.imageStorageId) totalBytes += await getStorageSize(ctx, p.imageStorageId);
    }

    const FREE_FILE_STORAGE_BYTES = 1024 * 1024 * 1024;
    return {
      totalBytes,
      limitBytes: FREE_FILE_STORAGE_BYTES,
      usagePercent: (totalBytes / FREE_FILE_STORAGE_BYTES) * 100,
    };
  },
});

// ============================================================================
// AI API keys — gắn với user (đăng nhập máy khác vẫn dùng được)
// ============================================================================

/**
 * Lấy API keys của user hiện tại. Trả về object map { provider: key }.
 * Chỉ owner đọc được. Không có user → trả empty {}.
 */
export const getMyAiApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return {};
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return (profile?.aiApiKeys ?? {}) as Record<string, string>;
  },
});

/**
 * Set/unset API key cho 1 provider. Key rỗng → xóa khỏi map.
 */
export const setAiApiKey = mutation({
  args: {
    provider: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Profile chưa được tạo. Vào trang chủ trước.");

    const keys: Record<string, string> = { ...(profile.aiApiKeys ?? {}) };
    const trimmed = args.apiKey.trim();
    if (trimmed) {
      keys[args.provider] = trimmed;
    } else {
      delete keys[args.provider];
    }
    await ctx.db.patch(profile._id, { aiApiKeys: keys });
    return { ok: true, providerCount: Object.keys(keys).length };
  },
});

/**
 * Bulk set nhiều keys 1 lần — dùng khi migrate từ localStorage lên DB.
 */
export const setAiApiKeysBulk = mutation({
  args: {
    keys: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Chưa đăng nhập");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Profile chưa được tạo");

    // Merge: existing keys + new keys, drop entries với value rỗng
    const merged: Record<string, string> = { ...(profile.aiApiKeys ?? {}) };
    for (const [provider, key] of Object.entries(args.keys)) {
      const trimmed = key.trim();
      if (trimmed) merged[provider] = trimmed;
    }
    await ctx.db.patch(profile._id, { aiApiKeys: merged });
    return { ok: true, providerCount: Object.keys(merged).length };
  },
});
