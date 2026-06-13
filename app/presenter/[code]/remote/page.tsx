"use client";

/**
 * REMOTE ĐIỀU KHIỂN BẰNG ĐIỆN THOẠI — /presenter/[code]/remote
 *
 * Giảng viên mở trên điện thoại (đăng nhập 1 lần) để điều khiển buổi học khi đi lại trong lớp:
 * - Chuyển slide trước/sau/đầu/cuối → đồng bộ realtime sang máy chiếu (setPdfCurrentPage).
 * - Bắt đầu / Đóng hoạt động → gọi thẳng mutation Convex (không cần đứng ở máy tính).
 *
 * Mobile-first: nút to, bấm bằng ngón cái. Mọi thao tác đi qua Convex nên main presenter
 * tự cập nhật mà không cần kênh riêng.
 */

import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { toast } from "sonner";

const TYPE_LABEL: Record<string, string> = {
  poll: "Trắc nghiệm",
  wordcloud: "Word Cloud",
  rating: "Đánh giá",
  board: "Bảng tương tác",
  qa: "Hỏi đáp",
  opentext: "Câu hỏi mở",
  video: "Video",
};

export default function RemotePage() {
  const { code } = useParams<{ code: string }>();
  const upperCode = code?.toUpperCase();

  const session = useQuery(api.sessions.getSessionByCode, upperCode ? { code: upperCode } : "skip");
  const activities = useQuery(
    api.activities.listActivities,
    session?._id ? { sessionId: session._id } : "skip"
  );

  const setPdfCurrentPage = useMutation(api.sessions.setPdfCurrentPage);
  const startActivity = useMutation(api.activities.startActivity);
  const closeActivity = useMutation(api.activities.closeActivity);

  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-5xl mb-3">📡</div>
          <div className="text-xl font-semibold">Đang kết nối phòng {upperCode}…</div>
        </div>
      </div>
    );
  }

  const totalPages = session.pdfNumPages ?? 0;
  const currentPage = session.pdfCurrentPage ?? 1;
  const hasPdf = !!session.pdfStorageId && totalPages > 0;

  const sorted = [...(activities ?? [])].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const active = sorted.find((a) => a.status === "active");
  const nextDraft = sorted.find((a) => a.status === "draft");

  const goPage = (p: number) => {
    if (!session._id) return;
    const clamped = Math.min(totalPages, Math.max(1, p));
    setPdfCurrentPage({ sessionId: session._id, page: clamped });
  };

  const onStart = async (id: Id<"activities">, title: string) => {
    setBusy(true);
    try {
      await startActivity({ activityId: id });
      toast.success(`Đã bắt đầu: ${title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi bắt đầu hoạt động");
    } finally {
      setBusy(false);
    }
  };

  const onClose = async (id: Id<"activities">) => {
    setBusy(true);
    try {
      await closeActivity({ activityId: id });
      toast.success("Đã đóng hoạt động");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi đóng hoạt động");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col select-none">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between sticky top-0 bg-zinc-950/95 backdrop-blur z-10">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="font-mono font-bold tracking-widest text-lg">{session.code}</span>
        </div>
        <span className="text-xs text-zinc-500">Remote điều khiển</span>
      </div>

      <div className="flex-1 p-4 space-y-5 max-w-md w-full mx-auto">
        {/* Điều khiển slide */}
        <section>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Slide</div>
          {hasPdf ? (
            <>
              <div className="text-center mb-3">
                <span className="text-4xl font-bold tabular-nums">{currentPage}</span>
                <span className="text-xl text-zinc-500"> / {totalPages}</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => goPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="flex-1 h-20 rounded-2xl bg-zinc-800 active:bg-zinc-700 disabled:opacity-30 text-2xl font-bold flex items-center justify-center"
                >
                  ←
                </button>
                <button
                  onClick={() => goPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="flex-[2] h-20 rounded-2xl bg-sky-600 active:bg-sky-500 disabled:opacity-30 text-2xl font-bold flex items-center justify-center"
                >
                  Tiếp →
                </button>
              </div>
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => goPage(1)}
                  disabled={currentPage <= 1}
                  className="flex-1 h-12 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 disabled:opacity-30 text-sm"
                >
                  ⤒ Đầu
                </button>
                <button
                  onClick={() => goPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="flex-1 h-12 rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 disabled:opacity-30 text-sm"
                >
                  Cuối ⤓
                </button>
              </div>
            </>
          ) : (
            <div className="text-sm text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
              Buổi này chưa có slide PDF trong app.
            </div>
          )}
        </section>

        {/* Hoạt động đang chạy */}
        <section>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Hoạt động</div>
          {active ? (
            <div className="rounded-2xl bg-emerald-950/40 border border-emerald-800 p-4">
              <div className="text-[11px] text-emerald-400 tracking-wider mb-0.5">
                ● ĐANG CHẠY · {TYPE_LABEL[active.type] ?? active.type}
              </div>
              <div className="text-lg font-semibold mb-3 leading-snug">{active.title}</div>
              <button
                onClick={() => onClose(active._id)}
                disabled={busy}
                className="w-full h-14 rounded-xl bg-red-600 active:bg-red-500 disabled:opacity-50 text-lg font-semibold"
              >
                ■ Đóng hoạt động
              </button>
            </div>
          ) : nextDraft ? (
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
              <div className="text-[11px] text-zinc-500 tracking-wider mb-0.5">
                KẾ TIẾP · {TYPE_LABEL[nextDraft.type] ?? nextDraft.type}
              </div>
              <div className="text-lg font-semibold mb-3 leading-snug">{nextDraft.title}</div>
              <button
                onClick={() => onStart(nextDraft._id, nextDraft.title)}
                disabled={busy}
                className="w-full h-14 rounded-xl bg-emerald-600 active:bg-emerald-500 disabled:opacity-50 text-lg font-semibold"
              >
                ▶ Bắt đầu
              </button>
            </div>
          ) : (
            <div className="text-sm text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
              Không còn hoạt động nháp.
            </div>
          )}
        </section>

        {/* Danh sách hoạt động nháp còn lại */}
        {!active && sorted.filter((a) => a.status === "draft" && a._id !== nextDraft?._id).length > 0 && (
          <section>
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Các hoạt động khác</div>
            <div className="space-y-2">
              {sorted
                .filter((a) => a.status === "draft" && a._id !== nextDraft?._id)
                .map((a) => (
                  <button
                    key={a._id}
                    onClick={() => onStart(a._id, a.title)}
                    disabled={busy}
                    className="w-full text-left rounded-xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 disabled:opacity-50 p-3 flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{a.title}</span>
                      <span className="block text-[11px] text-zinc-500">{TYPE_LABEL[a.type] ?? a.type}</span>
                    </span>
                    <span className="shrink-0 text-emerald-400 text-sm font-semibold">▶</span>
                  </button>
                ))}
            </div>
          </section>
        )}
      </div>

      <div className="px-4 py-3 text-center text-[11px] text-zinc-600 border-t border-zinc-900">
        Mọi thao tác đồng bộ ngay sang máy chiếu
      </div>
    </div>
  );
}
