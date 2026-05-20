"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

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

  const data = leaderboard as any;
  const displayData = data?.leaderboard || [];
  const total = data?.totalParticipants || 0;
  const withScore = data?.participantsWithScore || 0;

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
      <div className="max-w-5xl mx-auto">
        {/* Header - tối ưu cho màn hình lớn */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-4">
              <span className="text-6xl">🏆</span>
              <div>
                <h1 className="text-6xl font-bold tracking-[-2px]">Bảng thành tích</h1>
                <p className="text-2xl text-zinc-400 mt-1">{session.title}</p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-emerald-400 text-sm font-mono tracking-widest">TOP 10</div>
            <div className="text-sm text-zinc-400">
              {withScore} / {total} người đã có điểm
            </div>
            <div className="text-xs text-zinc-500">Cập nhật realtime</div>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800">
                <th className="px-10 py-6 text-left text-sm font-medium text-zinc-400 w-24">Hạng</th>
                <th className="px-8 py-6 text-left text-sm font-medium text-zinc-400">Sinh viên</th>
                <th className="px-8 py-6 text-left text-sm font-medium text-zinc-400">Lớp</th>
                <th className="px-10 py-6 text-right text-sm font-medium text-zinc-400">Điểm tích lũy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-lg">
              {displayData.length > 0 ? (
                displayData.map((student: any, index: number) => (
                  <tr 
                    key={index} 
                    className={`transition-colors ${index < 3 ? "bg-zinc-950/50" : "hover:bg-zinc-950/30"}`}
                  >
                    <td className="px-10 py-5">
                      <div className={`inline-flex items-center justify-center w-11 h-11 rounded-2xl font-bold text-2xl ${
                        student.rank === 1 ? "bg-yellow-500 text-black" :
                        student.rank === 2 ? "bg-zinc-300 text-black" :
                        student.rank === 3 ? "bg-amber-600 text-white" :
                        "bg-zinc-700 text-white"
                      }`}>
                        {student.rank}
                      </div>
                    </td>
                    <td className="px-8 py-5 font-semibold">{student.fullName}</td>
                    <td className="px-8 py-5 text-zinc-400 font-mono text-base">{student.studentCode}</td>
                    <td className="px-10 py-5 text-right">
                      <span className="font-bold text-3xl text-emerald-400 tabular-nums">{student.score}</span>
                      <span className="text-sm text-zinc-500 ml-2">điểm</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-10 py-12 text-center text-zinc-400">
                    Chưa có sinh viên nào tham gia hoạt động.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-5 text-center text-sm text-zinc-500">
          Điểm được tính dựa trên sự tham gia và đóng góp trong các hoạt động của buổi học
        </div>
      </div>
    </div>
  );
}
