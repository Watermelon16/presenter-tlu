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

export function EngagementHeatmap({
  sessionId,
  open,
  onClose,
  onDisable,
}: {
  sessionId: Id<"sessions">;
  open: boolean;
  onClose: () => void;
  /** Nếu cung cấp: hiện nút "Tắt nhịp lớp" ở footer để GV tắt hẳn tính năng. */
  onDisable?: () => void;
}) {
  const data = useQuery(api.engagement.getEngagementHeatmap, open ? { sessionId } : "skip");

  // Tick mỗi 10s để extend series tới phút hiện tại khi xem live
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [open]);

  // ESC để đóng
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const maxVal = useMemo(() => {
    if (!data) return 0;
    return data.series.reduce((m, s) => (s.total > m ? s.total : m), 0);
  }, [data]);

  if (!open) return null;

  if (!data) {
    return (
      <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl px-6 py-8 text-zinc-500" onClick={(e) => e.stopPropagation()}>
          Đang tải...
        </div>
      </div>
    );
  }

  const { summary, series, startAt } = data;
  const endTs = series.length > 0 ? series[series.length - 1].timestamp : startAt;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-6 flex flex-col max-h-[calc(100vh-3rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              📊 Nhịp lớp theo phút
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">LIVE</span>
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              <strong className="text-zinc-700">{summary.totalEngagement}</strong> hoạt động qua <strong>{series.length} phút</strong> kể từ {fmt(startAt)}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none shrink-0" aria-label="Đóng">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {series.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <div className="text-3xl mb-2">📊</div>
              <div className="text-sm">Chưa có hoạt động nào. Heatmap sẽ hiện khi SV bắt đầu trả lời.</div>
            </div>
          ) : (
            <>
              {/* Insights */}
              <div className="flex items-center gap-3 flex-wrap mb-4">
                {summary.peakCount > 0 && summary.peakAt && (
                  <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                    📈 <strong>Đỉnh</strong>: {fmt(summary.peakAt)} · <strong>{summary.peakCount}</strong> hoạt động/phút
                  </div>
                )}
                {summary.longestDropLen > 0 && summary.longestDropStartMinute != null && (
                  <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                    📉 <strong>Lặng dài nhất</strong>: {summary.longestDropLen}p từ {fmt(startAt + summary.longestDropStartMinute * 60_000)}
                  </div>
                )}
                {summary.totalEngagement > 0 && !summary.longestDropLen && (
                  <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-sm text-zinc-700">
                    👏 Lớp tham gia đều, không có khoảng lặng đáng kể
                  </div>
                )}
              </div>

              {/* Heatmap strip — lớn hơn modal */}
              <div className="flex gap-[2px] items-end h-20 bg-zinc-50 rounded-lg p-1.5">
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
                          ? ` — ${Object.entries(s.byType).map(([t, c]) => `${typeLabel(t)} ${c}`).join(", ")}`
                          : ""
                      }`}
                    />
                  );
                })}
              </div>

              {/* Time axis labels */}
              <div className="flex justify-between text-[11px] text-zinc-400 mt-2 px-1.5">
                <span>{fmt(startAt)}</span>
                {series.length > 20 && (
                  <span>{fmt(startAt + Math.floor(series.length / 2) * 60_000)}</span>
                )}
                <span>{fmt(endTs)}{data.endAt ? "" : " (now)"}</span>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-2 mt-4 text-xs text-zinc-500">
                <span>Ít</span>
                <div className="flex gap-[2px]">
                  <div className="w-4 h-4 rounded-sm bg-zinc-100" />
                  <div className="w-4 h-4 rounded-sm bg-emerald-200" />
                  <div className="w-4 h-4 rounded-sm bg-emerald-400" />
                  <div className="w-4 h-4 rounded-sm bg-emerald-500" />
                  <div className="w-4 h-4 rounded-sm bg-emerald-600" />
                </div>
                <span>Nhiều</span>
                <span className="ml-2 text-zinc-400">· Hover cột để xem chi tiết phút đó</span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-zinc-500 flex-1 min-w-0">
            Cập nhật mỗi 10 giây · Dùng để phát hiện lúc lớp drop và điều chỉnh nhịp giảng.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onDisable && (
              <button
                onClick={onDisable}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-700 text-zinc-600 font-medium transition-colors"
                title="Tắt hẳn tính năng Nhịp lớp — không tự cập nhật nữa. Có thể bật lại từ topbar."
              >
                🔕 Tắt nhịp lớp
              </button>
            )}
            <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100 font-medium">
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
