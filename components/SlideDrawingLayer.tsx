"use client";

/**
 * Lớp vẽ + toolbar nổi, đè lên slide PDF hoặc bảng trắng.
 * Hỗ trợ: trỏ thường, laser pointer (dot + glow), bút, highlighter, hoàn tác, xoá.
 * Strokes lưu toạ độ chuẩn hoá 0-1 → tự scale khi slide resize.
 */

import { useEffect, useRef, useState } from "react";

export type DrawTool = "none" | "laser" | "pen" | "highlighter";

export type Stroke = {
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  points: [number, number][]; // normalized 0..1
};

const COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ffffff", "#000000"];

type Props = {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  color: string;
  setColor: (c: string) => void;
  strokes: Stroke[];
  onAddStroke: (s: Stroke) => void;
  onClear: () => void;
  onUndo: () => void;
  whiteboardActive: boolean;
  onToggleWhiteboard: () => void;
  /** Hint surface (slide:N hoặc whiteboard) — hiện trên toolbar */
  surfaceLabel: string;
};

export function SlideDrawingLayer({
  tool, setTool, color, setColor,
  strokes, onAddStroke, onClear, onUndo,
  whiteboardActive, onToggleWhiteboard, surfaceLabel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState<[number, number][]>([]);
  const [laserPos, setLaserPos] = useState<[number, number] | null>(null);

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

  // Laser fade — ẩn dot sau 2s không di chuyển
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    if (tool === "laser") {
      setLaserPos(getPos(e));
      return;
    }
    setCurrent([getPos(e)]);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!active) return;
    const p = getPos(e);
    if (tool === "laser") {
      setLaserPos(p);
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
          cursor: active ? (tool === "laser" ? "none" : "crosshair") : "default",
          pointerEvents: active ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerLeave={finish}
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
            {current.length > 0 && tool !== "laser" && (
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
            className="absolute pointer-events-none transition-opacity"
            style={{
              left: laserPos[0] * size.w - 14,
              top: laserPos[1] * size.h - 14,
              width: 28,
              height: 28,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(239,68,68,0.95) 0%, rgba(239,68,68,0.55) 40%, transparent 72%)",
              boxShadow:
                "0 0 24px 10px rgba(239,68,68,0.6), 0 0 6px 2px rgba(255,255,255,0.5) inset",
            }}
          />
        )}
      </div>

      {/* Toolbar floating bottom-center */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-zinc-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-zinc-700 px-2 py-1.5">
        <ToolBtn icon="↖" label="Trỏ" active={tool === "none"} hotkey="Esc" onClick={() => setTool("none")} />
        <Divider />
        <ToolBtn icon="🔴" label="Laser" active={tool === "laser"} hotkey="L" onClick={() => setTool("laser")} />
        <ToolBtn icon="✒" label="Bút" active={tool === "pen"} hotkey="P" onClick={() => setTool("pen")} />
        <ToolBtn icon="🖍" label="Highlight" active={tool === "highlighter"} hotkey="Y" onClick={() => setTool("highlighter")} />
        <ToolBtn icon="⬜" label="B.trắng" active={whiteboardActive} hotkey="W" onClick={onToggleWhiteboard} />
        <Divider />
        {/* Color picker — chỉ show khi pen/highlighter */}
        {(tool === "pen" || tool === "highlighter") && (
          <>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition ${
                  color === c ? "border-white scale-110" : "border-zinc-600 hover:border-zinc-400"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <Divider />
          </>
        )}
        <ToolBtn icon="↶" label="Hoàn tác" hotkey="Z" onClick={onUndo} disabled={strokes.length === 0} />
        <ToolBtn icon="🗑" label="Xoá hết" hotkey="⇧D" onClick={onClear} disabled={strokes.length === 0} />
        <Divider />
        <div className="px-2 text-[10px] text-zinc-500 leading-tight">
          <div className="text-zinc-400">{surfaceLabel}</div>
          <div>{strokes.length} nét</div>
        </div>
      </div>
    </>
  );
}

function Divider() {
  return <div className="w-px h-7 bg-zinc-700 mx-0.5" />;
}

function ToolBtn({
  icon, label, active, hotkey, onClick, disabled,
}: {
  icon: string; label: string; active?: boolean; hotkey?: string;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 rounded-lg flex flex-col items-center min-w-[46px] transition ${
        active
          ? "bg-amber-500 text-black"
          : disabled
            ? "text-zinc-600 cursor-not-allowed"
            : "text-zinc-200 hover:bg-zinc-700"
      }`}
      title={`${label}${hotkey ? ` (${hotkey})` : ""}`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="text-[9px] opacity-90 mt-0.5">{label}</span>
    </button>
  );
}
