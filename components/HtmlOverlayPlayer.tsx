"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface HtmlOverlayPlayerProps {
  /** File HTML đã upload lên storage (nếu nguồn là upload) */
  storageId?: Id<"_storage"> | null;
  /** Link nhúng trực tiếp (nếu nguồn là URL) */
  embedUrl?: string | null;
  title?: string;
  onClose: () => void;
}

/**
 * Overlay nhúng HTML/animation phủ kín khu vực slide — chỉ chiếu trên màn presenter.
 * Nguồn có thể là file .html đã upload (storageId) hoặc một link nhúng (embedUrl).
 * Esc / nút × để đóng. Nội dung chạy trong iframe sandbox (cross-origin → cách ly an toàn).
 */
export function HtmlOverlayPlayer({
  storageId,
  embedUrl,
  title,
  onClose,
}: HtmlOverlayPlayerProps) {
  // Chỉ query storage khi thực sự có file upload (không có embedUrl)
  const storageUrl = useQuery(
    api.files.getStorageUrl,
    storageId && !embedUrl ? { storageId } : "skip"
  );

  // URL cuối: ưu tiên embedUrl; nếu không thì dùng URL của file đã upload.
  const url = embedUrl || storageUrl;
  const isLoading = !embedUrl && storageId && storageUrl === undefined;
  const notFound = !embedUrl && storageId && storageUrl === null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[105] bg-black flex flex-col">
      {/* Header gọn — tiêu đề + mở tab mới + nút đóng */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-black/80 text-white border-b border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">✨</span>
          <span className="text-sm font-medium truncate" title={title}>
            {title || "HTML / Animation"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 font-medium"
              title="Mở trong tab mới (dùng khi trang chặn nhúng)"
            >
              ↗ Mở tab mới
            </a>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded-lg bg-red-600 hover:bg-red-500 font-semibold"
            title="Đóng (Esc)"
          >
            ✕ Đóng (Esc)
          </button>
        </div>
      </div>

      {/* Khu vực nội dung — phủ kín, nền trắng để animation nền trong hiển thị đúng */}
      <div className="flex-1 flex items-center justify-center bg-white overflow-hidden">
        {isLoading ? (
          <div className="text-zinc-500 text-xl">Đang tải nội dung…</div>
        ) : notFound ? (
          <div className="text-red-500 text-center px-6">
            <div className="text-2xl mb-2">⚠️ Không tìm thấy file HTML</div>
            <div className="text-sm text-zinc-500">File có thể đã bị xóa khỏi storage.</div>
          </div>
        ) : url ? (
          <iframe
            src={url}
            title={title || "HTML / Animation"}
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-presentation"
            allow="autoplay; fullscreen; encrypted-media; gyroscope; accelerometer; clipboard-read; clipboard-write"
          />
        ) : (
          <div className="text-zinc-500 text-center px-6">
            <div className="text-2xl mb-2">⚠️ Chưa có nội dung</div>
            <div className="text-sm text-zinc-500">Hoạt động này chưa được cấu hình file HTML hoặc link.</div>
          </div>
        )}
      </div>
    </div>
  );
}
