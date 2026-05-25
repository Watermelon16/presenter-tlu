"use client";

/**
 * Lớp vẽ + toolbar nổi, đè lên slide PDF hoặc bảng trắng.
 * Tool: trỏ / laser / pen / highlighter / eraser (xoá từng nét).
 * Toolbar vertical strip mỏng bên trái, có thể collapse thành 1 pill nhỏ.
 * Strokes lưu toạ độ chuẩn hoá 0-1 → tự scale khi resize.
 */

import { useEffect, useRef, useState } from "react";

export type DrawTool = "none" | "laser" | "pen" | "highlighter" | "eraser";

export type Stroke = {
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  points: [number, number][]; // normalized 0..1
};

const COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ffffff", "#000000"];
const ERASER_RADIUS_PX = 24;

type Props = {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  color: string;
  setColor: (c: string) => void;
  strokes: Stroke[];
  onAddStroke: (s: Stroke) => void;
  onRemoveStrokeAt: (idx: number) => void;
  onClear: () => void;
  onUndo: () => void;
  whiteboardActive: boolean;
  onToggleWhiteboard: () => void;
  surfaceLabel: string;
};

// Khoảng cách (px) từ point đến segment ab — dùng cho hit test eraser.
function distPointSegmentSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

function strokeNearPoint(
  stroke: Stroke,
  p: [number, number],
  radiusPx: number,
  w: number,
  h: number,
): boolean {
  const px = p[0] * w;
  const py = p[1] * h;
  const r2 = radiusPx * radiusPx;
  if (stroke.points.length === 1) {
    const a = stroke.points[0];
    const dx = a[0] * w - px;
    const dy = a[1] * h - py;
    return dx * dx + dy * dy < r2;
  }
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    if (distPointSegmentSq(px, py, a[0] * w, a[1] * h, b[0] * w, b[1] * h) < r2) {
      return true;
    }
  }
  return false;
}

export function SlideDrawingLayer({
  tool, setTool, color, setColor,
  strokes, onAddStroke, onRemoveStrokeAt, onClear, onUndo,
  whiteboardActive, onToggleWhiteboard, surfaceLabel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState<[number, number][]>([]);
  const [laserPos, setLaserPos] = useState<[number, number] | null>(null);
  const [eraserPos, setEraserPos] = useState<[number, number] | null>(null);

  // UI: collapse toolbar + color popout
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (tool !== "laser" || !laserPos) return;
    const t = setTimeout(() => setLaserPos(null), 2000);
    return () => clearTimeout(t);
  }, [laserPos, tool]);

  const active = tool !== "none";

  const getPos = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  };

  const handleErase = (p: [number, number]) => {
    if (size.w === 0) return;
    // Tìm stroke đầu tiên giao với eraser → xoá. Lặp pointer move sẽ xoá tiếp.
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokeNearPoint(strokes[i], p, ERASER_RADIUS_PX, size.w, size.h)) {
        onRemoveStrokeAt(i);
        return;
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    const p = getPos(e);
    if (tool === "laser") { setLaserPos(p); return; }
    if (tool === "eraser") {
      setEraserPos(p);
      handleErase(p);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    setCurrent([p]);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!active) return;
    const p = getPos(e);
    if (tool === "laser") { setLaserPos(p); return; }
    if (tool === "eraser") {
      setEraserPos(p);
      // Pointer button is held → xoá liên tục khi drag
      if (e.buttons === 1) handleErase(p);
      return;
    }
    if (current.length > 0) {
      const last = current[current.length - 1];
      const dx = (p[0] - last[0]) * size.w;
      const dy = (p[1] - last[1]) * size.h;
      if (dx * dx + dy * dy > 4) {
        setCurrent((prev) => [...prev, p]);
      }
    }
  };

  const finish = () => {
    if (current.length > 1 && (tool === "pen" || tool === "highlighter")) {
      const width = tool === "highlighter" ? 18 : 4;
      onAddStroke({ tool, color, width, points: current });
    }
    setCurrent([]);
  };

  const pathFor = (points: [number, number][]) => {
    if (points.length === 0) return "";
    return (
      "M " +
      points
        .map(([x, y]) => `${(x * size.w).toFixed(1)} ${(y * size.h).toFixed(1)}`)
        .join(" L ")
    );
  };

  return (
    <>
      {/* Drawing surface — overlay trong suốt, chỉ bắt event khi active */}
      <div
        ref={ref}
        className="absolute inset-0 z-30"
        style={{
          cursor: active && tool !== "laser" && tool !== "eraser" ? "crosshair" : "default",
          pointerEvents: active ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerLeave={() => { finish(); setEraserPos(null); }}
        onPointerCancel={finish}
      >
        {size.w > 0 && (
          <svg
            width={size.w}
            height={size.h}
            className="block absolute inset-0 pointer-events-none"
          >
            {strokes.map((s, i) => (
              <path
                key={i}
                d={pathFor(s.points)}
                stroke={s.color}
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={s.tool === "highlighter" ? 0.4 : 1}
              />
            ))}
            {current.length > 0 && tool !== "laser" && tool !== "eraser" && (
              <path
                d={pathFor(current)}
                stroke={color}
                strokeWidth={tool === "highlighter" ? 18 : 4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={tool === "highlighter" ? 0.4 : 1}
              />
            )}
          </svg>
        )}
        {/* Laser dot */}
        {tool === "laser" && laserPos && size.w > 0 && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: laserPos[0] * size.w - 14,
              top: laserPos[1] * size.h - 14,
              width: 28, height: 28, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(239,68,68,0.95) 0%, rgba(239,68,68,0.55) 40%, transparent 72%)",
              boxShadow: "0 0 24px 10px rgba(239,68,68,0.6), 0 0 6px 2px rgba(255,255,255,0.5) inset",
            }}
          />
        )}
        {/* Eraser circle indicator */}
        {tool === "eraser" && eraserPos && size.w > 0 && (
          <div
            className="absolute pointer-events-none border-2 border-white rounded-full"
            style={{
              left: eraserPos[0] * size.w - ERASER_RADIUS_PX,
              top: eraserPos[1] * size.h - ERASER_RADIUS_PX,
              width: ERASER_RADIUS_PX * 2,
              height: ERASER_RADIUS_PX * 2,
              background: "rgba(255,255,255,0.15)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            }}
          />
        )}
      </div>

      {/* === Toolbar — vertical strip mỏng bên trái, gọn === */}
      {toolbarCollapsed ? (
        <button
          onClick={() => setToolbarCollapsed(false)}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-40 w-7 h-12 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 rounded-r-lg shadow-lg text-zinc-300 text-xs flex items-center justify-center"
          title="Hiện thanh công cụ vẽ"
        >
          ▶
        </button>
      ) : (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 z-40 flex flex-col items-stretch gap-0.5 bg-zinc-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-zinc-700 p-1 w-11">
          <IconBtn icon="↖" label="Trỏ" active={tool === "none"} hotkey="Esc" onClick={() => setTool("none")} />
          <Sep />
          <IconBtn icon="🔴" label="Laser" active={tool === "laser"} hotkey="L" onClick={() => setTool("laser")} />
          <IconBtn icon="✒" label="Bút" active={tool === "pen"} hotkey="P" onClick={() => setTool("pen")} />
          <IconBtn icon="🖍" label="Highlight" active={tool === "highlighter"} hotkey="Y" onClick={() => setTool("highlighter")} />
          <IconBtn icon="🧽" label="Gôm tẩy" active={tool === "eraser"} hotkey="G" onClick={() => setTool("eraser")} />
          <IconBtn icon="⬜" label="B.trắng" active={whiteboardActive} hotkey="W" onClick={onToggleWhiteboard} />

          {(tool === "pen" || tool === "highlighter") && (
            <>
              <Sep />
              <button
                onClick={() => setShowColorPicker((v) => !v)}
                className="relative w-9 h-9 mx-auto rounded-md border-2 border-zinc-600 hover:border-zinc-400 transition flex items-center justify-center"
                style={{ backgroundColor: color }}
                title="Đổi màu"
              >
                {showColorPicker && (
                  <div
                    className="absolute left-full ml-2 top-0 z-50 flex flex-col gap-1 bg-zinc-900 border border-zinc-700 rounded-lg p-1.5 shadow-2xl"
                    onMouseLeave={() => setShowColorPicker(false)}
                  >
                    {COLORS.map((c) => (
                      <div
                        key={c}
                        onClick={(e) => {
                          e.stopPropagation();
                          setColor(c);
                          setShowColorPicker(false);
                        }}
                        className={`w-7 h-7 rounded-md border-2 cursor-pointer transition ${
                          color === c ? "border-white scale-110" : "border-zinc-600 hover:border-zinc-400"
                        }`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                )}
              </button>
            </>
          )}

          <Sep />
          <IconBtn icon="↶" label="Hoàn tác" hotkey="Z" onClick={onUndo} disabled={strokes.length === 0} />
          <IconBtn icon="🗑" label="Xoá hết" hotkey="⇧D" onClick={onClear} disabled={strokes.length === 0} />
          <Sep />
          <button
            onClick={() => setToolbarCollapsed(true)}
            className="w-9 h-7 mx-auto text-zinc-500 hover:text-zinc-200 text-[10px] leading-none flex items-center justify-center hover:bg-zinc-800 rounded"
            title="Ẩn thanh công cụ"
          >
            ◀
          </button>
          <div className="text-[9px] text-zinc-500 text-center leading-tight px-0.5 pt-0.5">
            <div className="truncate" title={surfaceLabel}>{surfaceLabel.replace(/^Slide /, "Sl ")}</div>
            <div>{strokes.length}</div>
          </div>
        </div>
      )}
    </>
  );
}

function Sep() {
  return <div className="h-px bg-zinc-700/60 my-0.5 mx-1" />;
}

function IconBtn({
  icon, label, active, hotkey, onClick, disabled,
}: {
  icon: string; label: string; active?: boolean; hotkey?: string;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-9 h-9 mx-auto rounded-md flex items-center justify-center text-base transition ${
        active
          ? "bg-amber-500 text-black ring-1 ring-amber-300"
          : disabled
            ? "text-zinc-600 cursor-not-allowed"
            : "text-zinc-200 hover:bg-zinc-700"
      }`}
      title={`${label}${hotkey ? ` (${hotkey})` : ""}`}
    >
      {icon}
    </button>
  );
}
