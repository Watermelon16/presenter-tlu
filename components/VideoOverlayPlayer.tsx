"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface VideoOverlayPlayerProps {
  storageId: Id<"_storage">;
  title?: string;
  autoplay?: boolean;
  loop?: boolean;
  mute?: boolean;
  onClose: () => void;
  onEnded?: () => void;
}

/**
 * Video overlay phủ kín khu vực slide PDF. Chỉ chiếu trên màn presenter.
 * Esc / nút × để đóng. Khi video kết thúc → gọi onEnded (GV có thể tự đóng activity).
 */
export function VideoOverlayPlayer({
  storageId,
  title,
  autoplay = true,
  loop = false,
  mute = false,
  onClose,
  onEnded,
}: VideoOverlayPlayerProps) {
  const url = useQuery(api.files.getStorageUrl, { storageId });
  const videoRef = useRef<HTMLVideoElement>(null);

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
      {/* Header gọn — tiêu đề + nút đóng */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-black/80 text-white border-b border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">🎬</span>
          <span className="text-sm font-medium truncate" title={title}>
            {title || "Video"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 text-xs rounded-lg bg-red-600 hover:bg-red-500 font-semibold"
          title="Đóng video (Esc)"
        >
          ✕ Đóng (Esc)
        </button>
      </div>

      {/* Video area — fit, giữ tỉ lệ */}
      <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
        {url === undefined ? (
          <div className="text-zinc-400 text-xl">Đang tải video…</div>
        ) : url === null ? (
          <div className="text-red-400 text-center px-6">
            <div className="text-2xl mb-2">⚠️ Không tìm thấy video</div>
            <div className="text-sm text-zinc-400">File có thể đã bị xóa khỏi storage.</div>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={url}
            className="w-full h-full object-contain"
            controls
            autoPlay={autoplay}
            loop={loop}
            muted={mute}
            playsInline
            onEnded={onEnded}
          />
        )}
      </div>
    </div>
  );
}
