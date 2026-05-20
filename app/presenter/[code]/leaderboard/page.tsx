"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type LeaderboardRow = {
  rank: number;
  studentCode: string;
  fullName: string;
  className: string;
  score: number;
  answeredCount: number;
  avgResponseMs: number | null;
  fastestResponseMs: number | null;
  flagged: boolean;
  flagReason?: string;
};

function formatMs(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}p${rem.toString().padStart(2, "0")}s`;
}

export default function LeaderboardPage() {
  const { code } = useParams<{ code: string }>();
  const upperCode = code?.toUpperCase();

  const session = useQuery(
    api.sessions.getSessionByCode,
    upperCode ? { code: upperCode } : "skip"
  );

  const leaderboard = useQuery(
    api.leaderboard.getParticipationLeaderboard,
    session?._id ? { sessionId: session._id } : "skip"
  );

  const data = leaderboard as {
    leaderboard: LeaderboardRow[];
    totalParticipants: number;
    participantsWithScore: number;
    flaggedCount: number;
  } | undefined;
  const displayData: LeaderboardRow[] = data?.leaderboard || [];
  const total = data?.totalParticipants || 0;
  const withScore = data?.participantsWithScore || 0;
  const flaggedCount = data?.flaggedCount || 0;

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🏆</div>
          <div className="text-2xl">Đang tải Bảng thành tích...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <span className="text-6xl">🏆</span>
            <div>
              <h1 className="text-5xl font-bold tracking-[-2px]">Bảng thành tích</h1>
              <p className="text-xl text-zinc-400 mt-1">{session.title}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-emerald-400 text-sm font-mono tracking-widest">TOP 10 · REALTIME</div>
            <div className="text-sm text-zinc-400 mt-1">
              {withScore} / {total} người có điểm
            </div>
            {flaggedCount > 0 && (
              <div className="text-xs text-red-400 mt-1">🚩 {flaggedCount} dấu hiệu bất thường</div>
            )}
          </div>
        </div>

        {/* Leaderboard table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 text-left font-medium text-zinc-400 w-20">Hạng</th>
                <th className="px-6 py-4 text-left font-medium text-zinc-400">Sinh viên</th>
                <th className="px-6 py-4 text-left font-medium text-zinc-400">Mã SV</th>
                <th className="px-6 py-4 text-center font-medium text-zinc-400 w-24">Số HĐ</th>
                <th className="px-6 py-4 text-center font-medium text-zinc-400 w-32">⚡ TB</th>
                <th className="px-6 py-4 text-center font-medium text-zinc-400 w-32">🏃 Nhanh nhất</th>
                <th className="px-6 py-4 text-right font-medium text-zinc-400 w-32">Điểm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-base">
              {displayData.length > 0 ? (
                displayData.map((student) => (
                  <tr
                    key={student.studentCode}
                    className={`transition-colors ${student.rank <= 3 ? "bg-zinc-950/50" : "hover:bg-zinc-950/30"} ${student.flagged ? "ring-1 ring-red-500/30" : ""}`}
                  >
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center justify-center w-11 h-11 rounded-2xl font-bold text-xl ${
                        student.rank === 1 ? "bg-yellow-500 text-black" :
                        student.rank === 2 ? "bg-zinc-300 text-black" :
                        student.rank === 3 ? "bg-amber-600 text-white" :
                        "bg-zinc-700 text-white"
                      }`}>
                        {student.rank}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-semibold flex items-center gap-2">
                      {student.fullName}
                      {student.flagged && (
                        <span title={student.flagReason || "Có dấu hiệu bất thường"} className="text-red-400 text-sm">🚩</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-zinc-500 font-mono text-sm">{student.studentCode}</td>
                    <td className="px-6 py-4 text-center text-zinc-300 tabular-nums">{student.answeredCount}</td>
                    <td className="px-6 py-4 text-center text-zinc-300 tabular-nums font-mono text-sm">{formatMs(student.avgResponseMs)}</td>
                    <td className="px-6 py-4 text-center text-emerald-400 tabular-nums font-mono text-sm">{formatMs(student.fastestResponseMs)}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="font-bold text-3xl text-emerald-400 tabular-nums">{student.score}</span>
                      <span className="text-xs text-zinc-500 ml-1">đ</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-10 py-12 text-center text-zinc-400">
                    Chưa có sinh viên nào tham gia hoạt động tính điểm.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-5 text-center text-sm text-zinc-500 space-y-1">
          <div>Điểm gồm: trả lời hoạt động + đăng bài Board + Quiz đúng (+50%) + bonus tốc độ (lên đến +50%)</div>
          <div>⚡ TB = thời gian phản hồi trung bình · 🏃 Nhanh nhất = lần phản hồi nhanh nhất · 🚩 = nghi vấn gian lận (giảng viên kiểm tra)</div>
        </div>
      </div>
    </div>
  );
}
