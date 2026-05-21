"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VnInput } from "@/components/VnInput";
import { Logo } from "@/components/Logo";
import type { Id } from "@/convex/_generated/dataModel";

const MY_SESSIONS_KEY = "my_sessions_v1";

type StoredSession = { sessionId: string; code: string; title: string; createdAt: number };

function loadMySessions(): StoredSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MY_SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as StoredSession[]) : [];
  } catch {
    return [];
  }
}

function saveMySessions(list: StoredSession[]) {
  localStorage.setItem(MY_SESSIONS_KEY, JSON.stringify(list));
}

export default function CreateRoomPage() {
  const [title, setTitle] = useState("");
  const [hostName, setHostName] = useState("");
  const [collectStudentCode, setCollectStudentCode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [mySessions, setMySessions] = useState<StoredSession[]>([]);
  const [showManager, setShowManager] = useState(false);

  const createSession = useMutation(api.sessions.createSession);
  const deleteSession = useMutation(api.sessions.deleteSession);
  const router = useRouter();

  useEffect(() => {
    setMySessions(loadMySessions());
  }, []);

  // Lấy chi tiết các session từ DB (lọc theo IDs đã track)
  const sessionDetails = useQuery(
    api.sessions.listSessionsByIds,
    mySessions.length > 0
      ? { sessionIds: mySessions.map((s) => s.sessionId as Id<"sessions">) }
      : "skip"
  );

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

      // Lưu vào localStorage để show trong "Buổi giảng đã tạo"
      const next = [
        {
          sessionId: result.sessionId,
          code: result.code,
          title: title.trim(),
          createdAt: Date.now(),
        },
        ...loadMySessions(),
      ];
      saveMySessions(next);

      router.push(`/presenter/${result.code}`);
    } catch (error) {
      console.error(error);
      toast.error("Không thể tạo phòng. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (sessionId: string, title: string) => {
    if (!confirm(`Xóa buổi giảng "${title}"?\n\nTất cả hoạt động, câu trả lời, SV, board posts sẽ bị xóa vĩnh viễn.`)) return;
    try {
      const result = await deleteSession({ sessionId: sessionId as Id<"sessions"> });
      // Xóa khỏi localStorage
      const next = loadMySessions().filter((s) => s.sessionId !== sessionId);
      saveMySessions(next);
      setMySessions(next);
      toast.success(`Đã xóa "${title}". (${result.counts.responses} câu trả lời, ${result.counts.participants} SV, ${result.counts.activities} hoạt động)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Không thể xóa buổi";
      toast.error(msg);
    }
  };

  const handleRemoveFromList = (sessionId: string) => {
    // Chỉ xóa khỏi danh sách local, không xóa data
    const next = loadMySessions().filter((s) => s.sessionId !== sessionId);
    saveMySessions(next);
    setMySessions(next);
    toast.message("Đã ẩn khỏi danh sách (data trong DB vẫn còn)");
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-start justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="flex justify-end mb-4">
          <a
            href="https://lephuong-tlu.lovable.app/dashboard/courses"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40 text-zinc-700 hover:text-emerald-700 transition-colors"
            title="Mở LMS quản lý môn học"
          >
            <span>📚</span>
            <span className="font-medium">LMS quản lý môn học</span>
            <span className="text-zinc-400">↗</span>
          </a>
        </div>
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <Logo size="xl" showText={false} href={null} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Presenter <span className="text-emerald-600">TLU</span>
          </h1>
          <p className="text-zinc-600 mt-2">Công cụ tương tác giảng dạy — Đại học Thủy Lợi</p>
          <p className="text-[11px] sm:text-xs text-zinc-500 mt-3 whitespace-nowrap overflow-hidden">
            Phát triển bởi <span className="font-medium text-zinc-700">TS. Lê Hồng Phương</span>
            <span className="text-zinc-400"> · </span>
            <span className="hidden sm:inline">Bộ môn Thủy công, </span>
            <span className="sm:hidden">BM Thủy công · </span>
            ĐH Thủy lợi
          </p>
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
                Mã phòng sẽ được tạo tự động và hiển thị sau khi tạo thành công
              </p>
            </CardContent>
          </Card>

          <div className="mt-6 text-center">
            <a
              href="/join"
              className="text-sm text-zinc-600 hover:text-zinc-900 underline underline-offset-4"
            >
              Sinh viên? Tham gia phòng tại đây
            </a>
          </div>
        </div>

        {/* ===== Quản lý buổi giảng đã tạo ===== */}
        {mySessions.length > 0 && (
          <div className="mt-10 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowManager(!showManager)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-zinc-50 transition-colors"
            >
              <div className="text-left">
                <div className="font-semibold text-zinc-900">📚 Buổi giảng đã tạo ({mySessions.length})</div>
                <div className="text-xs text-zinc-500 mt-0.5">Mở lại, xuất Excel, hoặc xóa dọn dung lượng</div>
              </div>
              <div className="text-zinc-400 text-lg">{showManager ? "▲" : "▼"}</div>
            </button>

            {showManager && (
              <div className="border-t border-zinc-200 divide-y divide-zinc-100">
                {sessionDetails === undefined ? (
                  <div className="px-5 py-8 text-center text-sm text-zinc-500">Đang tải...</div>
                ) : sessionDetails.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-zinc-500">
                    Chưa có buổi giảng nào. Tạo phòng mới ở trên để bắt đầu.
                  </div>
                ) : (
                  sessionDetails.map((s) => {
                    const localItem = mySessions.find((m) => m.sessionId === s._id);
                    return (
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
                              <span>📅 {formatDate(localItem?.createdAt ?? s.createdAt)}</span>
                              <span>👥 {s.stats.participantCount} SV</span>
                              <span>📊 {s.stats.activityCount} hoạt động</span>
                              <span>✏️ {s.stats.responseCount} câu trả lời</span>
                              {s.stats.boardPostCount > 0 && <span>📌 {s.stats.boardPostCount} bài Board</span>}
                              {s.hasPdf && <span className="text-indigo-600">📑 PDF</span>}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={`/presenter/${s.code}`}
                              className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                              title="Mở lại buổi giảng"
                            >
                              Mở
                            </a>
                            <button
                              onClick={() => handleRemoveFromList(s._id)}
                              className="px-2 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-600"
                              title="Ẩn khỏi danh sách (data trong DB vẫn còn)"
                            >
                              Ẩn
                            </button>
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
                    );
                  })
                )}

                <div className="px-5 py-3 bg-zinc-50 text-xs text-zinc-500">
                  <strong>Ẩn</strong>: chỉ xóa khỏi danh sách trên máy này (data DB còn) ·{" "}
                  <strong>Xóa</strong>: xóa vĩnh viễn data trong DB để dọn dung lượng
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
