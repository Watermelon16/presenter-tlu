"use client";

/**
 * Presenter View cho cửa sổ companion — kiểu PowerPoint/Keynote.
 * Hiển thị: slide đang chiếu (lớn) · slide kế tiếp (preview) · ghi chú giảng (theo trang) ·
 * giờ thực + bấm giờ tiết giảng (đọc chung localStorage với đồng hồ phiên ở presenter chính).
 * Nút ← / → và phím mũi tên/Space đổi trang, đồng bộ realtime qua Convex (setPdfCurrentPage).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type TimerState = { startedAt: number | null; accumulatedMs: number; goalMin: number };

/** Ghi chú giảng theo trang — lazy-init từ localStorage; parent đặt key để remount khi đổi trang. */
function SlideNotes({ notesKey, page }: { notesKey: string; page: number }) {
  const [note, setNote] = useState<string>(() => {
    try {
      return window.localStorage.getItem(notesKey) ?? "";
    } catch {
      return "";
    }
  });
  const onChange = (v: string) => {
    setNote(v);
    try {
      window.localStorage.setItem(notesKey, v);
    } catch {}
  };
  return (
    <>
      <div className="px-2.5 pt-3 pb-1 text-[10px] tracking-widest text-zinc-500">GHI CHÚ — SLIDE {page}</div>
      <div className="px-2.5 pb-2 flex-1 min-h-0">
        <textarea
          value={note}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Gõ ghi chú giảng cho slide này… (chỉ bạn thấy, lưu trên máy)"
          className="w-full h-full min-h-[80px] resize-none rounded-lg bg-zinc-900 border border-zinc-700 p-2 text-sm text-zinc-200 outline-none focus:border-sky-600 placeholder:text-zinc-600"
        />
      </div>
    </>
  );
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function PresenterCompanionView({
  sessionId,
  code,
  pdfUrl,
  totalPages,
  currentPage,
  currentActivityTitle,
}: {
  sessionId: Id<"sessions">;
  code: string;
  pdfUrl: string;
  totalPages: number;
  currentPage: number;
  currentActivityTitle?: string;
}) {
  const setPdfCurrentPage = useMutation(api.sessions.setPdfCurrentPage);

  const goPage = useCallback(
    (p: number) => {
      const clamped = Math.min(totalPages, Math.max(1, p));
      setPdfCurrentPage({ sessionId, page: clamped });
    },
    [sessionId, totalPages, setPdfCurrentPage]
  );

  // Phím mũi tên / Space đổi trang
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goPage(currentPage + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goPage(currentPage - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goPage(1);
      } else if (e.key === "End") {
        e.preventDefault();
        goPage(totalPages);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPage, currentPage, totalPages]);

  const notesKey = `tk-notes-${code}-${currentPage}`;

  // === Giờ thực + bấm giờ tiết giảng (đọc chung tk-timer-<code>) ===
  const [clock, setClock] = useState("");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      const d = new Date(t);
      setClock(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
      try {
        const raw = window.localStorage.getItem(`tk-timer-${code}`);
        if (raw) {
          const s = JSON.parse(raw) as TimerState;
          setElapsed(s.accumulatedMs + (s.startedAt ? t - s.startedAt : 0));
        } else {
          setElapsed(0);
        }
      } catch {
        setElapsed(0);
      }
    };
    const t0 = setTimeout(tick, 0); // hoãn tick đầu ra khỏi effect body (tránh setState đồng bộ)
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, [code]);

  // Đo bề rộng vùng slide lớn để render Page vừa khít
  const bigRef = useRef<HTMLDivElement>(null);
  const [bigW, setBigW] = useState(0);
  useEffect(() => {
    const el = bigRef.current;
    if (!el) return;
    // RO báo kích thước ngay lần observe đầu → không cần set thủ công (tránh setState trong effect body)
    const ro = new ResizeObserver(() => setBigW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasNext = currentPage < totalPages;

  return (
    <div className="min-h-screen h-screen bg-black text-white flex flex-col select-none">
      {/* Header: nhãn + giờ thực + bấm giờ */}
      <div className="h-9 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-3 text-xs shrink-0">
        <div className="flex items-center gap-2 text-sky-400 font-mono tracking-[2px]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
          </span>
          PRESENTER VIEW
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span className="text-zinc-400">🕒 {clock}</span>
          <span className="text-emerald-400 tabular-nums">⏱ {fmt(elapsed)}</span>
        </div>
      </div>

      <Document
        file={pdfUrl}
        loading={<div className="flex-1 flex items-center justify-center text-zinc-500">Đang tải slide…</div>}
        error={<div className="flex-1 flex items-center justify-center text-red-400">Không mở được PDF.</div>}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex-1 flex min-h-0">
          {/* Slide hiện tại — lớn */}
          <div ref={bigRef} className="flex-1 min-w-0 flex items-center justify-center bg-black p-2 overflow-hidden">
            {bigW > 0 && (
              <Page
                key={`cur-${currentPage}`}
                pageNumber={currentPage}
                width={bigW - 8}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                className="shadow-2xl max-h-full"
              />
            )}
          </div>

          {/* Cột phải: slide kế + ghi chú */}
          <div className="w-[210px] shrink-0 border-l border-zinc-800 flex flex-col bg-zinc-950">
            <div className="px-2.5 pt-2 pb-1 text-[10px] tracking-widest text-zinc-500">SLIDE KẾ TIẾP</div>
            <div className="px-2.5">
              {hasNext ? (
                <div className="rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900 flex items-center justify-center">
                  <Page
                    key={`next-${currentPage + 1}`}
                    pageNumber={currentPage + 1}
                    width={186}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-600 text-xs text-center py-8">
                  Slide cuối
                </div>
              )}
            </div>

            <SlideNotes key={notesKey} notesKey={notesKey} page={currentPage} />
          </div>
        </div>
      </Document>

      {/* Hoạt động hiện tại (nếu có) */}
      {currentActivityTitle && (
        <div className="px-3 py-1.5 bg-emerald-950/40 border-t border-emerald-900/50 text-center text-sm text-emerald-300 shrink-0 truncate">
          ● Đang chạy: <span className="font-semibold">{currentActivityTitle}</span>
        </div>
      )}

      {/* Footer điều khiển trang */}
      <div className="h-14 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between px-4 shrink-0">
        <button
          onClick={() => goPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="px-5 py-2 text-base rounded-xl border border-zinc-700 disabled:opacity-30 hover:bg-zinc-900 active:scale-95 transition"
        >
          ← Trước
        </button>
        <div className="text-sm font-mono text-zinc-400 tabular-nums">
          {currentPage} / {totalPages}
        </div>
        <button
          onClick={() => goPage(currentPage + 1)}
          disabled={!hasNext}
          className="px-6 py-2 text-base font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500 active:scale-95 transition"
        >
          Tiếp → <span className="text-xs opacity-70">(Space)</span>
        </button>
      </div>
    </div>
  );
}
