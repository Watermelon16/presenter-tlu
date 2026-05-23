"use client";

import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

export default function AdminPage() {
  const me = useQuery(api.userProfiles.me);
  const users = useQuery(api.userProfiles.listUsers);
  const setStatus = useMutation(api.userProfiles.setUserStatus);
  const setRole = useMutation(api.userProfiles.setUserRole);
  const wipeAll = useMutation(api.userProfiles.adminWipeAllSessions);
  const usage = useQuery(api.userProfiles.getResourceUsage);
  const deleteSession = useMutation(api.sessions.deleteSession);

  // Loading
  if (me === undefined || users === undefined) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center text-zinc-500">
        Đang tải...
      </div>
    );
  }
  // Not admin → access denied
  if (!me?.profile || me.profile.role !== "admin" || users === null) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center max-w-md">
          <div className="text-5xl mb-3">🔒</div>
          <div className="text-lg font-semibold mb-1">Cần quyền admin</div>
          <div className="text-sm text-zinc-600 mb-4">
            Trang này chỉ dành cho admin của hệ thống.
          </div>
          <Link href="/" className="text-emerald-700 hover:underline text-sm">
            ← Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  const handleStatus = async (
    profileId: Id<"userProfiles">,
    status: "pending" | "approved" | "banned",
    email: string
  ) => {
    if (status === "banned") {
      if (!confirm(`KHOÁ tài khoản ${email}? User sẽ không thể đăng nhập.`)) return;
    }
    try {
      await setStatus({ profileId, status });
      toast.success(`Đã ${status === "approved" ? "duyệt" : status === "banned" ? "khoá" : "đặt pending"} ${email}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  };

  const handleRole = async (
    profileId: Id<"userProfiles">,
    role: "admin" | "lecturer",
    email: string
  ) => {
    if (role === "admin") {
      if (!confirm(`Cấp quyền ADMIN cho ${email}? User này sẽ quản lý được mọi người.`)) return;
    }
    try {
      await setRole({ profileId, role });
      toast.success(`Đã đặt role = ${role} cho ${email}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  };

  const handleWipe = async () => {
    if (
      !confirm(
        "⚠ XOÁ TẤT CẢ sessions, responses, participants, board posts, push subscriptions?\n\n" +
          "Hành động không hồi phục được. Chỉ dùng để reset dev/test data."
      )
    )
      return;
    if (!confirm("Xác nhận lần 2: BẠN CHẮC CHẮN MUỐN XOÁ TẤT CẢ?")) return;
    try {
      const counts = await wipeAll();
      toast.success(
        `Đã xoá: ${counts.sessions} sessions, ${counts.activities} activities, ${counts.responses} responses, ${counts.participants} SV.`
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <Logo size="sm" />
          <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">
            ← Về trang chủ
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold">👮 Quản lý người dùng</h1>
          <p className="text-sm text-zinc-600 mt-1">
            Duyệt giảng viên mới, khoá tài khoản, cấp quyền admin.
          </p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-zinc-700">Email</th>
                <th className="text-left px-4 py-2 font-medium text-zinc-700">Tên</th>
                <th className="text-left px-4 py-2 font-medium text-zinc-700">Status</th>
                <th className="text-left px-4 py-2 font-medium text-zinc-700">Role</th>
                <th className="text-right px-4 py-2 font-medium text-zinc-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.map((u) => {
                const isMe = u.userId === me?.user?._id;
                return (
                  <tr key={u._id} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {u.email}
                      {isMe && <span className="ml-1 text-[10px] text-emerald-600">(bạn)</span>}
                    </td>
                    <td className="px-4 py-2.5">{u.displayName ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-zinc-100 text-zinc-700"
                        }`}
                      >
                        {u.role === "admin" ? "Admin" : "GV"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1 flex-wrap justify-end">
                        {u.status !== "approved" && (
                          <button
                            onClick={() => handleStatus(u._id, "approved", u.email)}
                            className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                          >
                            ✓ Duyệt
                          </button>
                        )}
                        {u.status !== "banned" && !isMe && (
                          <button
                            onClick={() => handleStatus(u._id, "banned", u.email)}
                            className="text-xs px-2 py-1 rounded bg-red-100 text-red-800 hover:bg-red-200"
                          >
                            🚫 Khoá
                          </button>
                        )}
                        {u.role !== "admin" && (
                          <button
                            onClick={() => handleRole(u._id, "admin", u.email)}
                            className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-800 hover:bg-purple-200"
                          >
                            Lên admin
                          </button>
                        )}
                        {u.role === "admin" && !isMe && (
                          <button
                            onClick={() => handleRole(u._id, "lecturer", u.email)}
                            className="text-xs px-2 py-1 rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                          >
                            Hạ về GV
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Chưa có người dùng nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ============= Tài nguyên Convex ============= */}
        <ResourcePanel
          usage={usage}
          onDeleteSession={async (sid, title) => {
            if (!confirm(`Xóa buổi "${title}"?\nToàn bộ activity, response, SV, board post, PDF, video sẽ bị xóa.`)) return;
            try {
              const r = await deleteSession({ sessionId: sid });
              toast.success(`Đã xóa "${title}" (${r.counts.responses} câu trả lời, ${r.counts.participants} SV, ${r.counts.activities} hoạt động).`);
            } catch (e: unknown) {
              toast.error(e instanceof Error ? e.message : "Lỗi");
            }
          }}
        />

        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="font-semibold text-red-900 mb-1">⚠ Danger zone</div>
          <p className="text-sm text-red-800 mb-3">
            Xoá toàn bộ sessions, responses, participants, board posts, push subscriptions trong DB.
            Profile users vẫn giữ.
          </p>
          <Button variant="outline" onClick={handleWipe} className="border-red-300 text-red-700 hover:bg-red-100">
            🗑 Xoá toàn bộ data sessions
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel Tài nguyên Convex ──────────────────────────────────────────────
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ResourcePanel({
  usage,
  onDeleteSession,
}: {
  usage: typeof api.userProfiles.getResourceUsage._returnType | undefined;
  onDeleteSession: (sid: Id<"sessions">, title: string) => Promise<void>;
}) {
  if (usage === undefined) {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl p-5 mb-6 text-zinc-500 text-sm">
        Đang tính tài nguyên...
      </div>
    );
  }

  const pct = usage.file.usagePercent;
  const barColor =
    pct >= 90 ? "bg-red-500"
    : pct >= 70 ? "bg-amber-500"
    : "bg-emerald-500";
  const warnTone =
    pct >= 90 ? "border-red-300 bg-red-50"
    : pct >= 70 ? "border-amber-300 bg-amber-50"
    : "border-zinc-200 bg-white";

  return (
    <div className={`border rounded-2xl p-5 mb-6 ${warnTone}`}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="font-semibold text-zinc-900 text-lg flex items-center gap-2">
            💾 Tài nguyên Convex (gói free)
            {pct >= 90 && <span className="text-xs px-2 py-0.5 rounded bg-red-600 text-white font-semibold animate-pulse">SẮP HẾT</span>}
            {pct >= 70 && pct < 90 && <span className="text-xs px-2 py-0.5 rounded bg-amber-600 text-white font-semibold">CẢNH BÁO</span>}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Cập nhật mỗi lần mở trang. Free tier giới hạn file storage 1 GiB, db ~0.5 GiB.
          </div>
        </div>
      </div>

      {/* File storage bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-medium text-zinc-800">File storage</span>
          <span className="font-mono text-zinc-700">
            {fmtBytes(usage.file.totalBytes)} / {fmtBytes(usage.limits.fileStorageBytes)}
            <span className="ml-2 text-zinc-500">({pct.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="w-full bg-zinc-200 rounded-full h-2.5 overflow-hidden">
          <div
            className={`${barColor} h-full transition-all`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-3 flex-wrap">
          <span>📑 PDF: {fmtBytes(usage.file.pdfBytes)} ({usage.file.pdfCount})</span>
          <span>🎬 Video: {fmtBytes(usage.file.videoBytes)} ({usage.file.videoCount})</span>
          <span>🖼 Ảnh: {fmtBytes(usage.file.imageBytes)} ({usage.file.imageCount})</span>
        </div>
      </div>

      {/* Doc counts */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4 text-xs">
        {[
          ["Buổi", usage.docCounts.sessions],
          ["Hoạt động", usage.docCounts.activities],
          ["Câu trả lời", usage.docCounts.responses],
          ["Board post", usage.docCounts.boardPosts],
          ["SV (rows)", usage.docCounts.participants],
          ["Roster cache", usage.docCounts.rosterCache],
          ["Push sub", usage.docCounts.pushSubscriptions],
          ["TỔNG docs", usage.docCounts.total],
        ].map(([label, n]) => (
          <div key={label as string} className="bg-white/70 border border-zinc-200 rounded-lg px-2.5 py-1.5">
            <div className="text-[10px] text-zinc-500">{label}</div>
            <div className="font-semibold text-zinc-800 tabular-nums">{n as number}</div>
          </div>
        ))}
      </div>

      {/* Top sessions to clean up */}
      {usage.topSessions.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-zinc-800 mb-2">
            Top {usage.topSessions.length} buổi tốn storage nhất {pct >= 70 && "— bấm Xóa để dọn"}
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">Mã</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">Buổi</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-600">PDF</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-600">Video</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-600">Ảnh</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-600">Tổng</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {usage.topSessions.map((s) => (
                  <tr key={s.sessionId} className="hover:bg-zinc-50/60">
                    <td className="px-3 py-2 font-mono text-zinc-700">{s.code}</td>
                    <td className="px-3 py-2 truncate max-w-xs" title={s.title}>{s.title}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-700">{s.pdf > 0 ? fmtBytes(s.pdf) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-700">{s.video > 0 ? fmtBytes(s.video) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-700">{s.image > 0 ? fmtBytes(s.image) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-zinc-900 tabular-nums">{fmtBytes(s.total)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onDeleteSession(s.sessionId, s.title)}
                        className="text-[11px] px-2 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-50 font-medium"
                      >
                        🗑 Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "pending" | "approved" | "banned" }) {
  const map = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    banned: "bg-red-100 text-red-800",
  };
  const label = {
    pending: "Chờ duyệt",
    approved: "Đã duyệt",
    banned: "Khoá",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}
