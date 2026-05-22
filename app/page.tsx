"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VnInput } from "@/components/VnInput";
import { Logo } from "@/components/Logo";
import { Dropdown, DropdownItem, DropdownDivider } from "@/components/Dropdown";
import type { Id } from "@/convex/_generated/dataModel";

export default function CreateRoomPage() {
  const router = useRouter();
  const { signOut } = useAuthActions();

  const me = useQuery(api.userProfiles.me);
  const ensureProfile = useMutation(api.userProfiles.ensureProfile);
  const mySessions = useQuery(api.sessions.listMySessions);
  const createSession = useMutation(api.sessions.createSession);
  const deleteSession = useMutation(api.sessions.deleteSession);

  const [title, setTitle] = useState("");
  const [hostName, setHostName] = useState("");
  const [collectStudentCode, setCollectStudentCode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [profileEnsured, setProfileEnsured] = useState(false);

  // Auto-ensure profile + redirect nếu pending/banned
  useEffect(() => {
    if (me === undefined) return;
    if (!me?.user) return; // chưa load auth
    if (!me.profile && !profileEnsured) {
      setProfileEnsured(true);
      ensureProfile().catch(() => {});
      return;
    }
    if (me.profile && me.profile.status !== "approved") {
      router.replace("/pending");
    }
    // Pre-fill hostName từ tên Google nếu chưa nhập
    if (me.user?.name && !hostName) {
      setHostName(me.user.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const handleCreateRoom = async () => {
    if (!title.trim()) {
      toast.error("Vui lòng nhập tên buổi giảng");
      return;
    }
    setIsLoading(true);
    try {
      const result = await createSession({
        title: title.trim(),
        hostName: hostName.trim() || undefined,
        collectStudentCode,
      });
      router.push(`/presenter/${result.code}`);
    } catch (error: unknown) {
      console.error(error);
      const msg = error instanceof Error ? error.message : "Không thể tạo phòng. Vui lòng thử lại.";
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (sessionId: string, title: string) => {
    if (!confirm(`Xóa buổi giảng "${title}"?\n\nTất cả hoạt động, câu trả lời, SV, board posts sẽ bị xóa vĩnh viễn.`)) return;
    try {
      const result = await deleteSession({ sessionId: sessionId as Id<"sessions"> });
      toast.success(`Đã xóa "${title}". (${result.counts.responses} câu trả lời, ${result.counts.participants} SV, ${result.counts.activities} hoạt động)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Không thể xóa buổi";
      toast.error(msg);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // Loading state — middleware đã đảm bảo authed
  if (me === undefined) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center text-zinc-500">
        Đang tải...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Topbar */}
      <div className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <Logo size="sm" href={null} />
          <div className="flex items-center gap-2">
            <a
              href="https://lephuong-tlu.lovable.app/dashboard/courses"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40 text-zinc-700 hover:text-emerald-700 transition-colors"
              title="Mở LMS quản lý môn học"
            >
              <span>📚</span>
              <span className="font-medium">LMS</span>
              <span className="text-zinc-400">↗</span>
            </a>
            <Dropdown
              align="right"
              width="w-64"
              trigger={
                <span className="inline-flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-100 cursor-pointer">
                  {me?.user?.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={me.user.image}
                      alt={me.user.name ?? "avatar"}
                      className="w-7 h-7 rounded-full"
                    />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs font-bold">
                      {(me?.user?.name ?? me?.user?.email ?? "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="text-xs text-zinc-600 hidden sm:inline max-w-[140px] truncate">
                    {me?.user?.name ?? me?.user?.email ?? "User"}
                  </span>
                  <span className="text-[10px] text-zinc-400">▾</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <div className="px-3 py-2 text-xs text-zinc-500">
                    <div className="font-mono truncate">{me?.user?.email}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          me?.profile?.role === "admin"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-zinc-100 text-zinc-700"
                        }`}
                      >
                        {me?.profile?.role === "admin" ? "Admin" : "GV"}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          me?.profile?.status === "approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {me?.profile?.status === "approved" ? "Đã duyệt" : me?.profile?.status ?? "?"}
                      </span>
                    </div>
                  </div>
                  <DropdownDivider />
                  {me?.profile?.role === "admin" && (
                    <DropdownItem
                      icon="👮"
                      label="Quản lý người dùng"
                      hint="Duyệt giảng viên mới, khoá tài khoản"
                      onClick={() => {
                        router.push("/admin");
                        close();
                      }}
                    />
                  )}
                  <DropdownDivider />
                  <DropdownItem
                    icon="🚪"
                    label="Đăng xuất"
                    danger
                    onClick={() => {
                      signOut();
                      close();
                    }}
                  />
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </div>

      <div className="flex items-start justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-3">
              <Logo size="xl" showText={false} href={null} />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Presenter <span className="text-emerald-600">TLU</span>
            </h1>
            <p className="text-zinc-600 mt-2">Công cụ tương tác giảng dạy — Đại học Thủy Lợi</p>
          </div>

          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Tạo phòng mới</CardTitle>
                <CardDescription>
                  Sinh viên sẽ tham gia bằng mã phòng hoặc quét QR
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Tên buổi giảng</label>
                  <VnInput
                    placeholder="Ví dụ: Đập và Hồ chứa - Buổi 1"
                    value={title}
                    onValueChange={setTitle}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
                    className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Tên giảng viên (tùy chọn)</label>
                  <VnInput
                    placeholder="TS. Lê Hồng Phương"
                    value={hostName}
                    onValueChange={setHostName}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
                    className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">Thu thập mã sinh viên để tính điểm</div>
                    <div className="text-xs text-zinc-500 mt-0.5">Sinh viên phải nhập Mã SV + Họ tên khi tham gia</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={collectStudentCode}
                      onChange={(e) => setCollectStudentCode(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-0 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                <Button
                  onClick={handleCreateRoom}
                  disabled={isLoading || !title.trim()}
                  className="w-full h-11 text-base"
                >
                  {isLoading ? "Đang tạo phòng..." : "Tạo phòng và bắt đầu"}
                </Button>

                <p className="text-xs text-center text-zinc-500 pt-2">
                  Mã phòng được tạo tự động sau khi tạo thành công
                </p>
              </CardContent>
            </Card>

            <div className="mt-6 text-center">
              <Link
                href="/join"
                className="text-sm text-zinc-600 hover:text-zinc-900 underline underline-offset-4"
              >
                Sinh viên? Tham gia phòng tại đây
              </Link>
            </div>
          </div>

          {/* ===== Buổi giảng của bạn (server-side, theo owner) ===== */}
          {mySessions && mySessions.length > 0 && (
            <div className="mt-10 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowManager(!showManager)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-zinc-50 transition-colors"
              >
                <div className="text-left">
                  <div className="font-semibold text-zinc-900">📚 Buổi giảng của bạn ({mySessions.length})</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Sessions gắn với tài khoản của bạn — đăng nhập máy khác vẫn thấy</div>
                </div>
                <div className="text-zinc-400 text-lg">{showManager ? "▲" : "▼"}</div>
              </button>

              {showManager && (
                <div className="border-t border-zinc-200 divide-y divide-zinc-100">
                  {mySessions.map((s) => (
                    <div key={s._id} className="px-5 py-3 hover:bg-zinc-50/50">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-base text-emerald-700">{s.code}</span>
                            <span className="font-medium text-zinc-900 truncate">{s.title}</span>
                            {s.status === "ended" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 font-medium">ĐÃ KẾT THÚC</span>
                            )}
                            {s.status === "active" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">ĐANG MỞ</span>
                            )}
                            {s.currentRun > 1 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{s.currentRun} PHIÊN</span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <span>📅 {formatDate(s.createdAt)}</span>
                            <span>👥 {s.stats.participantCount} SV</span>
                            <span>📊 {s.stats.activityCount} hoạt động</span>
                            <span>✏️ {s.stats.responseCount} câu trả lời</span>
                            {s.stats.boardPostCount > 0 && <span>📌 {s.stats.boardPostCount} bài Board</span>}
                            {s.hasPdf && <span className="text-indigo-600">📑 PDF</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Link
                            href={`/presenter/${s.code}`}
                            className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                            title="Mở lại buổi giảng"
                          >
                            Mở
                          </Link>
                          <button
                            onClick={() => handleDeleteSession(s._id, s.title)}
                            className="px-2 py-1.5 text-xs rounded-lg border border-red-300 hover:bg-red-50 text-red-600"
                            title="Xóa vĩnh viễn — dọn dung lượng"
                          >
                            🗑 Xóa
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-center text-[11px] text-zinc-500 mt-8">
            Phát triển bởi <span className="font-medium text-zinc-700">TS. Lê Hồng Phương</span>
            <span className="text-zinc-400"> · </span>
            Bộ môn Thủy công · ĐH Thủy lợi
          </div>
        </div>
      </div>
    </div>
  );
}
