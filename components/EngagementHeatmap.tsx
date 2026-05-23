"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function fmt(ts: number): string {
  return new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function intensityClass(v: number, max: number): string {
  if (v === 0) return "bg-zinc-100";
  const ratio = max > 0 ? v / max : 0;
  if (ratio < 0.25) return "bg-emerald-200";
  if (ratio < 0.5) return "bg-emerald-400";
  if (ratio < 0.75) return "bg-emerald-500";
  return "bg-emerald-600";
}

export function EngagementHeatmap({ sessionId }: { sessionId: Id<"sessions"> }) {
  const data = useQuery(api.engagement.getEngagementHeatmap, { sessionId });

  // Tick mỗi 10s để extend series tới phút hiện tại khi xem live
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const maxVal = useMemo(() => {
    if (!data) return 0;
    return data.series.reduce((m, s) => (s.total > m ? s.total : m), 0);
  }, [data]);

  if (!data || data.series.length === 0) return null;

  const { summary, series, startAt } = data;
  const endTs = series[series.length - 1].timestamp;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5">
            📊 Nhịp lớp theo phút
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">LIVE</span>
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {summary.totalEngagement} hoạt động · {series.length} phút từ {fmt(startAt)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {summary.peakCount > 0 && summary.peakAt && (
            <div className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">
              📈 Đỉnh: <strong>{fmt(summary.peakAt)}</strong> · {summary.peakCount} hoạt động
            </div>
          )}
          {summary.longestDropLen > 0 && summary.longestDropStartMinute != null && (
            <div className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
              📉 Lặng dài nhất: <strong>{summary.longestDropLen}p</strong> từ {fmt(startAt + summary.longestDropStartMinute * 60_000)}
            </div>
          )}
        </div>
      </div>

      {/* Heatmap strip */}
      <div className="flex gap-[2px] items-end h-12 bg-zinc-50 rounded-lg p-1.5">
        {series.map((s) => {
          const cls = intensityClass(s.total, maxVal);
          const heightPct = maxVal > 0 ? Math.max(8, (s.total / maxVal) * 100) : 8;
          return (
            <div
              key={s.minute}
              className={`flex-1 min-w-[3px] rounded-sm ${cls} transition-all hover:ring-2 hover:ring-emerald-700 hover:z-10 cursor-default`}
              style={{ height: `${heightPct}%` }}
              title={`${fmt(s.timestamp)} (phút ${s.minute}): ${s.total} hoạt động${
                s.total > 0
                  ? ` — ${Object.entries(s.byType)
                      .map(([t, c]) => `${typeLabel(t)} ${c}`)
                      .join(", ")}`
                  : ""
              }`}
            />
          );
        })}
      </div>

      {/* Time axis labels */}
      <div className="flex justify-between text-[10px] text-zinc-400 mt-1 px-1.5">
        <span>{fmt(startAt)}</span>
        {series.length > 20 && (
          <span>{fmt(startAt + Math.floor(series.length / 2) * 60_000)}</span>
        )}
        <span>{fmt(endTs)}{data.endAt ? "" : " (now)"}</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-zinc-500">
        <span>Ít</span>
        <div className="flex gap-[2px]">
          <div className="w-3 h-3 rounded-sm bg-zinc-100" />
          <div className="w-3 h-3 rounded-sm bg-emerald-200" />
          <div className="w-3 h-3 rounded-sm bg-emerald-400" />
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
          <div className="w-3 h-3 rounded-sm bg-emerald-600" />
        </div>
        <span>Nhiều</span>
        <span className="ml-2 text-zinc-400">· Hover để xem chi tiết</span>
      </div>
    </div>
  );
}

function typeLabel(t: string): string {
  return {
    poll: "Trắc nghiệm",
    wordcloud: "Word cloud",
    rating: "Rating",
    qa: "Q&A",
    opentext: "Tự luận",
    board: "Board",
  }[t] || t;
}
