"use client";

/**
 * Lưới thumbnail tất cả slide — mở nhanh để nhảy đến trang bất kỳ (phím O / nút "Tất cả slide").
 * Thay cho việc phải nhớ số trang rồi gõ số. Render lazy bằng IntersectionObserver
 * để deck nhiều trang vẫn mượt; click thumbnail → nhảy + đóng.
 */

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const THUMB_W = 230;

function Thumb({
  page,
  isCurrent,
  isSelected,
  onJump,
  selectRef,
}: {
  page: number;
  isCurrent: boolean;
  isSelected: boolean;
  onJump: (p: number) => void;
  selectRef: React.RefObject<HTMLButtonElement | null> | null;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: el.closest("[data-thumb-scroll]"), rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <button
      ref={(node) => {
        ref.current = node;
        if (selectRef) selectRef.current = node;
      }}
      onClick={() => onJump(page)}
      className={`group relative rounded-lg overflow-hidden border-2 transition bg-zinc-900 ${
        isCurrent
          ? "border-emerald-500"
          : isSelected
            ? "border-amber-400"
            : "border-zinc-700 hover:border-zinc-500"
      }`}
      style={{ width: THUMB_W }}
      title={`Slide ${page}`}
    >
      <div className="flex items-center justify-center" style={{ width: THUMB_W, minHeight: THUMB_W * 0.6 }}>
        {visible ? (
          <Page
            pageNumber={page}
            width={THUMB_W}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={<div className="text-zinc-600 text-xs py-10">…</div>}
          />
        ) : (
          <div className="text-zinc-600 text-3xl font-bold py-10">{page}</div>
        )}
      </div>
      <div
        className={`absolute bottom-0 left-0 right-0 px-2 py-1 text-[11px] font-mono flex items-center justify-between ${
          isCurrent ? "bg-emerald-600 text-white" : "bg-black/70 text-zinc-300"
        }`}
      >
        <span>Slide {page}</span>
        {isCurrent && <span className="text-[9px] tracking-wider">ĐANG CHIẾU</span>}
      </div>
    </button>
  );
}

export function SlideThumbnailGrid({
  fileUrl,
  totalPages,
  currentPage,
  onJump,
  onClose,
}: {
  fileUrl: string;
  totalPages: number;
  currentPage: number;
  onJump: (page: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(currentPage);
  const [cols, setCols] = useState(4);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Số cột theo bề rộng (ước lượng từ window)
  useEffect(() => {
    const calc = () => setCols(Math.max(2, Math.floor((window.innerWidth - 80) / (THUMB_W + 16))));
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  // Điều hướng bàn phím (capture để chặn handler đóng overlay của trang)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onJump(selected);
        return;
      }
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        let n = selected;
        if (e.key === "Home") n = 1;
        else if (e.key === "End") n = totalPages;
        else if (e.key === "ArrowRight") n = selected + 1;
        else if (e.key === "ArrowLeft") n = selected - 1;
        else if (e.key === "ArrowDown") n = selected + cols;
        else if (e.key === "ArrowUp") n = selected - cols;
        setSelected(Math.min(totalPages, Math.max(1, n)));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cols, totalPages, onJump, onClose, selected]);

  // Cuộn ô đang chọn vào tầm nhìn
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="fixed inset-0 z-[160] bg-black/92 backdrop-blur-sm flex flex-col text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">▦</span>
          <span className="text-sm font-semibold">Tất cả slide</span>
          <span className="text-xs text-zinc-500">({totalPages} trang)</span>
        </div>
        <div className="text-[11px] text-zinc-500 hidden sm:flex items-center gap-3">
          <span>← ↑ ↓ → chọn</span>
          <span>↵ nhảy</span>
          <span>Esc đóng</span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-white text-sm leading-none px-2 py-1"
          title="Đóng (Esc / O)"
        >
          ✕
        </button>
      </div>

      {/* Grid */}
      <div ref={scrollRef} data-thumb-scroll className="flex-1 overflow-y-auto p-5">
        <Document
          file={fileUrl}
          loading={<div className="text-zinc-400 text-center py-20">Đang tải slide…</div>}
          error={<div className="text-red-400 text-center py-20">Không mở được PDF.</div>}
        >
          <div
            className="grid gap-4 justify-center"
            style={{ gridTemplateColumns: `repeat(${cols}, ${THUMB_W}px)` }}
          >
            {pages.map((p) => (
              <Thumb
                key={p}
                page={p}
                isCurrent={p === currentPage}
                isSelected={p === selected}
                onJump={onJump}
                selectRef={p === selected ? selectedRef : null}
              />
            ))}
          </div>
        </Document>
      </div>
    </div>
  );
}
