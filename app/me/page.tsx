"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Logo } from "@/components/Logo";

const GLOBAL_IDENTITY_KEY = "student_identity_global";

function readSavedStudentCode(): string {
  if (typeof window === "undefined") return "";
  try {
    const saved = localStorage.getItem(GLOBAL_IDENTITY_KEY);
    if (!saved) return "";
    const parsed = JSON.parse(saved) as { studentCode?: string };
    return parsed.studentCode?.trim() || "";
  } catch {
    return "";
  }
}

function formatTimeMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s}s`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function StudentHistoryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <StudentHistoryView />
    </Suspense>
  );
}

function StudentHistoryView() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Nếu URL có ?clear=1 thì bỏ qua localStorage fallback (SV đã chủ động "đổi mã")
  const cleared = searchParams.get("clear") === "1";
  const queryCode = (searchParams.get("code") || "").trim();

  // Fallback từ localStorage — đọc lazy 1 lần. Không thay đổi sau initial render.
  const [savedCode] = useState<string>(() =>
    cleared ? "" : readSavedStudentCode()
  );

  const studentCode = queryCode || savedCode;

  const history = useQuery(
    api.leaderboard.getStudentHistory,
    studentCode ? { studentCode } : "skip"
  );

  const handleSubmit = (code: string) => {
    const next = code.trim();
    if (!next) return;
    router.replace(`/me?code=${encodeURIComponent(next)}`);
  };

  const handleClear = () => {
    router.replace("/me?clear=1");
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-6">
          <Logo size="sm" />
          <Link
            href="/join"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Vào phòng
          </Link>
        </div>

        <div className="text-center mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">
            Thành tích của tôi
          </h1>
          <p className="text-zinc-600 mt-2">
            Tổng hợp điểm tham gia qua các buổi giảng
          </p>
        </div>

        {!studentCode && <LookupForm onSubmit={handleSubmit} />}

        {studentCode && history === undefined && (
          <div className="text-center py-16 text-zinc-500">Đang tải...</div>
        )}

        {studentCode && history && history.sessions.length === 0 && (
          <Card className="max-w-md mx-auto">
            <CardContent className="py-8 text-center space-y-4">
              <div className="text-5xl">📭</div>
              <div>
                <div className="font-medium text-zinc-800">
                  Không tìm thấy lịch sử cho mã{" "}
                  <span className="font-mono">{studentCode}</span>
                </div>
                <div className="text-sm text-zinc-500 mt-1">
                  Kiểm tra lại mã sinh viên, hoặc bạn chưa từng tham gia buổi
                  giảng nào.
                </div>
              </div>
              <Button variant="outline" onClick={handleClear}>
                Đổi mã sinh viên
              </Button>
            </CardContent>
          </Card>
        )}

        {studentCode && history && history.sessions.length > 0 && (
          <div className="space-y-6">
            <div className="bg-white border border-zinc-200 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-xs text-zinc-500 tracking-wider">
                    SINH VIÊN
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 mt-0.5">
                    {history.fullName ?? "—"}
                  </div>
                  <div className="text-sm text-zinc-600 mt-0.5">
                    <span className="font-mono">{history.studentCode}</span>
                    {history.className && (
                      <span className="ml-2 text-zinc-400">
                        · Lớp {history.className}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="shrink-0"
                >
                  Đổi mã
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Tổng điểm"
                value={history.aggregate.totalScore.toString()}
                accent="emerald"
              />
              <StatCard
                label="Số phiên"
                value={history.aggregate.runCount.toString()}
                hint={
                  history.aggregate.sessionCount !== history.aggregate.runCount
                    ? `${history.aggregate.sessionCount} buổi`
                    : undefined
                }
              />
              <StatCard
                label="Lượt trả lời"
                value={history.aggregate.answeredTotal.toString()}
              />
              {history.aggregate.answeredTotal > 0 ? (
                <StatCard
                  label="Top 10"
                  value={history.aggregate.topTenCount.toString()}
                  hint={
                    history.aggregate.goldCount +
                      history.aggregate.silverCount +
                      history.aggregate.bronzeCount >
                    0
                      ? `🥇${history.aggregate.goldCount} 🥈${history.aggregate.silverCount} 🥉${history.aggregate.bronzeCount}`
                      : undefined
                  }
                />
              ) : (
                <StatCard label="Top 10" value="—" hint="Chưa tham gia hoạt động nào" />
              )}
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-200">
                <div className="text-sm font-semibold text-zinc-800">
                  Lịch sử các buổi
                </div>
                <div className="text-xs text-zinc-500">
                  Hiển thị {history.sessions.length} mục mới nhất
                </div>
              </div>
              <ul className="divide-y divide-zinc-100">
                {history.sessions.map((s) => {
                  const medal =
                    s.rank === 1
                      ? "🥇"
                      : s.rank === 2
                        ? "🥈"
                        : s.rank === 3
                          ? "🥉"
                          : s.rank <= 10
                            ? "⭐"
                            : null;
                  const showRunBadge = s.currentRun > 1;
                  return (
                    <li key={`${s.sessionId}-${s.run}`} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-zinc-900 truncate">
                              {s.sessionTitle}
                            </span>
                            {showRunBadge && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 tabular-nums">
                                Phiên {s.run}
                              </span>
                            )}
                            {s.sessionStatus === "ended" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                                Đã kết thúc
                              </span>
                            )}
                            {s.flagged && (
                              <span
                                title="Có dấu hiệu bất thường về thiết bị"
                                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                              >
                                ⚠ flag
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">
                            <span className="font-mono">{s.sessionCode}</span>
                            {s.hostName && (
                              <span className="ml-2">· {s.hostName}</span>
                            )}
                            <span className="ml-2">
                              · {formatDate(s.joinedAt)}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>
                              Trả lời:{" "}
                              <span className="text-zinc-700 font-medium">
                                {s.answeredCount}
                              </span>
                            </span>
                            {s.avgResponseMs !== null && (
                              <span>
                                ⚡ TB {formatTimeMs(s.avgResponseMs)}
                              </span>
                            )}
                            {s.fastestResponseMs !== null && (
                              <span>
                                Nhanh nhất {formatTimeMs(s.fastestResponseMs)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {s.answeredCount > 0 ? (
                            <>
                              <div className="text-lg font-bold text-emerald-700 tabular-nums">
                                {s.score} đ
                              </div>
                              <div className="text-xs text-zinc-500 tabular-nums">
                                {medal && <span className="mr-1">{medal}</span>}#
                                {s.rank}/{s.totalParticipants}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-zinc-400 italic">
                              Có mặt · không tham gia hoạt động
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="text-xs text-center text-zinc-400">
              Điểm = số hoạt động giảng viên đã bật ghi nhận điểm danh. Mỗi
              phiên dạy lại được tính riêng.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LookupForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [inputCode, setInputCode] = useState("");
  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Nhập mã sinh viên</CardTitle>
        <CardDescription>
          Xem lịch sử thành tích qua các buổi đã tham gia
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="VD: 2351150001"
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(inputCode);
          }}
        />
        <Button
          onClick={() => onSubmit(inputCode)}
          disabled={!inputCode.trim()}
          className="w-full"
        >
          Xem thành tích
        </Button>
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "emerald";
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <div className="text-[10px] tracking-wider text-zinc-500 font-medium">
        {label.toUpperCase()}
      </div>
      <div
        className={`text-2xl font-bold tabular-nums mt-0.5 ${accent === "emerald" ? "text-emerald-700" : "text-zinc-900"}`}
      >
        {value}
      </div>
      {hint && (
        <div className="text-xs text-zinc-500 mt-0.5 truncate">{hint}</div>
      )}
    </div>
  );
}
