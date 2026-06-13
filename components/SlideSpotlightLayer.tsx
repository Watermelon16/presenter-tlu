"use client";

/**
 * Lớp "Đèn rọi & Phóng to" động khi trình chiếu slide.
 *
 * - Đèn rọi (spotlight): làm tối toàn slide, chừa một vòng sáng đi theo con trỏ.
 *   Lăn chuột để đổi kích thước vòng sáng. Tập trung sự chú ý vào chi tiết đang nói.
 * - Phóng to (zoom): lăn chuột để phóng to/thu nhỏ ngay tại vị trí con trỏ; di chuột
 *   để "rê" vùng nhìn (như kính lúp); click để về 1x.
 *
 * Zoom được áp bằng CSS transform lên chính div vùng slide (`targetRef`) nên mọi lớp
 * con (PDF, nét vẽ, hotspot) phóng to đồng đều, không lệch. Lớp điều khiển này nằm
 * NGOÀI div đó (fixed theo bounding-rect) để toạ độ chuột luôn ổn định.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SpotlightMode = "spotlight" | "zoom";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const MIN_RADIUS = 70;
const MAX_RADIUS = 360;

type Rect = { left: number; top: number; width: number; height: number };

export function SlideSpotlightLayer({
  mode,
  onChangeMode,
  onExit,
  targetRef,
}: {
  mode: SpotlightMode;
  onChangeMode: (m: SpotlightMode) => void;
  onExit: () => void;
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [radius, setRadius] = useState(150);
  const zoomRef = useRef(1); // mức zoom hiện tại (không cần re-render)
  const [zoomLabel, setZoomLabel] = useState(1);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Đo vị trí + kích thước vùng slide để đặt overlay khớp lên trên
  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  }, [targetRef]);

  useEffect(() => {
    measure();
    const el = targetRef.current;
    const ro = el ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, targetRef]);

  // Áp transform zoom lên div vùng slide; reset khi rời chế độ zoom / unmount
  const applyZoom = useCallback(
    (z: number, cx: number, cy: number) => {
      const el = targetRef.current;
      if (!el) return;
      if (z <= 1.001) {
        el.style.transform = "";
        el.style.willChange = "";
        return;
      }
      // Giữ điểm dưới con trỏ cố định: tx = cx*(1-z), origin 0 0 → nội dung luôn lấp đầy, không hở mép đen
      const tx = cx * (1 - z);
      const ty = cy * (1 - z);
      el.style.transformOrigin = "0 0";
      el.style.willChange = "transform";
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    },
    [targetRef]
  );

  // Reset DOM-only (không setState) — dùng cho cleanup khi unmount.
  // Đổi mode = remount (parent đặt key) nên không cần effect reset theo mode.
  const resetZoomDom = useCallback(() => {
    zoomRef.current = 1;
    const el = targetRef.current;
    if (el) {
      el.style.transform = "";
      el.style.willChange = "";
    }
  }, [targetRef]);

  useEffect(() => () => resetZoomDom(), [resetZoomDom]);

  // Esc thoát; F (giữ nguyên hành vi toggle ở trang) — chỉ xử lý Esc & space ở đây để khỏi đụng overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onExit();
      }
    };
    // capture để chặn trước handler đóng overlay của trang
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onExit]);

  // Wheel gắn thủ công với passive:false (React onWheel mặc định passive → preventDefault không ăn)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !rect) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (mode === "spotlight") {
        setRadius((r) => Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r - e.deltaY * 0.4)));
      } else {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current - e.deltaY * 0.005));
        zoomRef.current = next;
        setZoomLabel(Math.round(next * 10) / 10);
        applyZoom(next, cx, cy);
      }
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [mode, rect, applyZoom]);

  if (!rect) return null;

  const relX = cursor ? cursor.x - rect.left : rect.width / 2;
  const relY = cursor ? cursor.y - rect.top : rect.height / 2;

  const onMove = (e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
    if (mode === "zoom" && zoomRef.current > 1) {
      applyZoom(zoomRef.current, e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  const onClick = () => {
    if (mode === "zoom") {
      resetZoomDom();
      setZoomLabel(1);
    }
  };

  // Mặt nạ đèn rọi: trong suốt ở vòng sáng, tối dần ra ngoài
  const spotlightBg =
    mode === "spotlight" && cursor
      ? `radial-gradient(circle ${radius}px at ${relX}px ${relY}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.82) 100%)`
      : "transparent";

  return (
    <>
      {/* Lớp bắt sự kiện + mặt nạ — fixed khớp vùng slide */}
      <div
        ref={overlayRef}
        className="fixed z-[130]"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          background: spotlightBg,
          cursor: mode === "zoom" ? (zoomLabel > 1 ? "grab" : "zoom-in") : "none",
        }}
        onMouseMove={onMove}
        onClick={onClick}
      >
        {/* Chấm tâm đèn rọi để GV biết vị trí khi nền tối */}
        {mode === "spotlight" && cursor && (
          <div
            className="absolute rounded-full border-2 border-amber-300/70 pointer-events-none"
            style={{
              left: relX - radius,
              top: relY - radius,
              width: radius * 2,
              height: radius * 2,
              boxShadow: "0 0 24px rgba(252,211,77,0.35)",
            }}
          />
        )}
      </div>

      {/* Thanh điều khiển nổi giữa-trên vùng slide */}
      <div
        className="fixed z-[131] flex items-center gap-1 rounded-xl bg-zinc-950/95 border border-zinc-700 shadow-2xl px-1.5 py-1 text-white"
        style={{ left: rect.left + rect.width / 2, top: rect.top + 10, transform: "translateX(-50%)" }}
      >
        <button
          onClick={() => onChangeMode("spotlight")}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
            mode === "spotlight" ? "bg-amber-500 text-black" : "text-zinc-300 hover:bg-zinc-800"
          }`}
          title="Đèn rọi — lăn chuột đổi cỡ vòng sáng"
        >
          🔦 Đèn rọi
        </button>
        <button
          onClick={() => onChangeMode("zoom")}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
            mode === "zoom" ? "bg-amber-500 text-black" : "text-zinc-300 hover:bg-zinc-800"
          }`}
          title="Phóng to — lăn chuột để zoom, di chuột để rê, click để về 1x"
        >
          🔍 Phóng to {mode === "zoom" && zoomLabel > 1 ? `${zoomLabel}x` : ""}
        </button>
        <div className="w-px h-5 bg-zinc-700 mx-0.5" />
        <span className="text-[10px] text-zinc-500 px-1 hidden sm:block">lăn chuột</span>
        <button
          onClick={onExit}
          className="px-2 py-1 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
          title="Thoát (Esc / F)"
        >
          ✕
        </button>
      </div>
    </>
  );
}
