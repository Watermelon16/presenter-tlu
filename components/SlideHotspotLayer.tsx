"use client";

/**
 * Lớp hotspot trên slide PDF — kiểu PPT Action.
 * Mode "edit": GV kéo chuột để vẽ vùng chữ nhật, chọn trang đích.
 *              Hotspot hiện viền đứt mờ, click vào để sửa/xoá.
 * Mode "present": vùng vô hình, click → onJump(targetPage).
 *                 Con trỏ đổi `pointer` khi rê vào vùng.
 * Toạ độ x/y/w/h ở dạng tỉ lệ 0..1 so với khung slide.
 */

import { useEffect, useRef, useState } from "react";

export type Hotspot = {
  _id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  targetPage: number;
  label?: string;
};

type Props = {
  mode: "edit" | "present";
  currentPage: number;
  totalPages: number;
  hotspots: Hotspot[]; // tất cả hotspots của PDF — component tự lọc theo page
  onJump?: (targetPage: number) => void;
  onCreate?: (rect: { x: number; y: number; w: number; h: number; targetPage: number }) => void;
  onUpdate?: (id: string, patch: { x?: number; y?: number; w?: number; h?: number; targetPage?: number; label?: string }) => void;
  onRemove?: (id: string) => void;
};

const MIN_RECT_FRAC = 0.015; // tránh hotspot quá nhỏ do click nhầm

export function SlideHotspotLayer({
  mode, currentPage, totalPages, hotspots,
  onJump, onCreate, onUpdate, onRemove,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingRect, setPendingRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [targetInput, setTargetInput] = useState<string>("");

  // Lọc hotspot thuộc trang đang chiếu
  const pageHotspots = hotspots.filter((h) => h.page === currentPage);

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

  const getNorm = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  };

  // === Edit mode: vẽ chữ nhật mới ===
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "edit") return;
    // Bỏ qua nếu click vào popup edit (đang mở)
    if ((e.target as HTMLElement).closest("[data-hotspot-popup]")) return;
    // Bỏ qua nếu click vào hotspot có sẵn (để mở popup, không vẽ đè)
    if ((e.target as HTMLElement).closest("[data-hotspot-existing]")) return;
    const [x, y] = getNorm(e);
    setDrawing({ x, y, w: 0, h: 0 });
    setEditingId(null);
    setPendingRect(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode !== "edit" || !drawing) return;
    const [nx, ny] = getNorm(e);
    setDrawing({
      x: Math.min(drawing.x, nx),
      y: Math.min(drawing.y, ny),
      w: Math.abs(nx - drawing.x),
      h: Math.abs(ny - drawing.y),
    });
  };

  const onPointerUp = () => {
    if (mode !== "edit" || !drawing) return;
    const finished = drawing;
    setDrawing(null);
    if (finished.w >= MIN_RECT_FRAC && finished.h >= MIN_RECT_FRAC) {
      // Mở popup nhập trang đích
      setPendingRect(finished);
      setEditingId(null);
      setTargetInput("");
    }
  };

  const confirmCreate = () => {
    if (!pendingRect) return;
    const tp = parseInt(targetInput, 10);
    if (!Number.isFinite(tp) || tp < 1 || tp > totalPages) return;
    onCreate?.({ ...pendingRect, targetPage: tp });
    setPendingRect(null);
    setTargetInput("");
  };

  const cancelPending = () => {
    setPendingRect(null);
    setTargetInput("");
  };

  // === Click hotspot có sẵn ===
  const handleHotspotClick = (h: Hotspot, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "present") {
      onJump?.(h.targetPage);
      return;
    }
    setEditingId(h._id);
    setTargetInput(String(h.targetPage));
    setPendingRect(null);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const tp = parseInt(targetInput, 10);
    if (!Number.isFinite(tp) || tp < 1 || tp > totalPages) return;
    onUpdate?.(editingId, { targetPage: tp });
    setEditingId(null);
  };

  const removeEdit = () => {
    if (!editingId) return;
    onRemove?.(editingId);
    setEditingId(null);
  };

  // Trong present mode: layer chỉ "bắt event" trên vùng hotspot (pointer-events trên từng box)
  // để không chặn click trên các overlay khác (drawing).
  const layerPointerEvents = mode === "edit" ? "auto" : "none";

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[25]"
      style={{
        cursor: mode === "edit" ? "crosshair" : "default",
        pointerEvents: layerPointerEvents,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrawing(null)}
    >
      {/* Render hotspots hiện có */}
      {size.w > 0 && pageHotspots.map((h) => {
        const left = h.x * size.w;
        const top = h.y * size.h;
        const width = h.w * size.w;
        const height = h.h * size.h;
        const isEditingThis = editingId === h._id;
        return (
          <div
            key={h._id}
            data-hotspot-existing
            onClick={(e) => handleHotspotClick(h, e)}
            className="absolute"
            style={{
              left, top, width, height,
              pointerEvents: "auto",
              cursor: "pointer",
              background: mode === "edit"
                ? (isEditingThis ? "rgba(245,158,11,0.18)" : "rgba(59,130,246,0.10)")
                : "transparent",
              border: mode === "edit"
                ? (isEditingThis ? "2px solid #f59e0b" : "2px dashed rgba(59,130,246,0.75)")
                : "none",
              borderRadius: 4,
            }}
            title={mode === "present"
              ? `→ Slide ${h.targetPage}${h.label ? ` (${h.label})` : ""}`
              : `Hotspot → trang ${h.targetPage}`
            }
          >
            {mode === "edit" && (
              <div className="absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-600 text-white whitespace-nowrap">
                →{h.targetPage}
              </div>
            )}
          </div>
        );
      })}

      {/* Đang vẽ chữ nhật mới */}
      {drawing && size.w > 0 && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: drawing.x * size.w,
            top: drawing.y * size.h,
            width: drawing.w * size.w,
            height: drawing.h * size.h,
            background: "rgba(245,158,11,0.20)",
            border: "2px dashed #f59e0b",
            borderRadius: 4,
          }}
        />
      )}

      {/* Popup tạo hotspot mới */}
      {pendingRect && size.w > 0 && (
        <HotspotPopup
          left={pendingRect.x * size.w}
          top={(pendingRect.y + pendingRect.h) * size.h + 6}
          containerWidth={size.w}
          title="Hotspot mới"
          subtitle="Click vào slide khi trình chiếu sẽ nhảy đến trang số:"
          totalPages={totalPages}
          value={targetInput}
          onChange={setTargetInput}
          onSave={confirmCreate}
          onCancel={cancelPending}
          saveLabel="Tạo"
        />
      )}

      {/* Popup sửa hotspot có sẵn */}
      {editingId && size.w > 0 && (() => {
        const h = pageHotspots.find((x) => x._id === editingId);
        if (!h) return null;
        return (
          <HotspotPopup
            left={h.x * size.w}
            top={(h.y + h.h) * size.h + 6}
            containerWidth={size.w}
            title={`Hotspot trang ${h.page} → ${h.targetPage}`}
            subtitle="Đổi trang đích:"
            totalPages={totalPages}
            value={targetInput}
            onChange={setTargetInput}
            onSave={saveEdit}
            onCancel={() => setEditingId(null)}
            onRemove={removeEdit}
            saveLabel="Lưu"
          />
        );
      })()}
    </div>
  );
}

function HotspotPopup({
  left, top, containerWidth, title, subtitle, totalPages,
  value, onChange, onSave, onCancel, onRemove, saveLabel,
}: {
  left: number; top: number; containerWidth: number;
  title: string; subtitle: string; totalPages: number;
  value: string; onChange: (v: string) => void;
  onSave: () => void; onCancel: () => void; onRemove?: () => void;
  saveLabel: string;
}) {
  const POPUP_W = 240;
  // Tránh tràn mép phải
  const clampedLeft = Math.max(8, Math.min(left, containerWidth - POPUP_W - 8));
  return (
    <div
      data-hotspot-popup
      className="absolute z-50 bg-zinc-900/98 border border-zinc-700 rounded-xl shadow-2xl text-white p-3"
      style={{ left: clampedLeft, top, width: POPUP_W, pointerEvents: "auto" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-semibold mb-1">{title}</div>
      <div className="text-[11px] text-zinc-400 mb-2">{subtitle}</div>
      <div className="flex items-center gap-1.5 mb-3">
        <input
          type="number"
          min={1}
          max={totalPages}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
          autoFocus
          placeholder="VD: 12"
          className="flex-1 min-w-0 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-white focus:outline-none focus:border-amber-500"
        />
        <span className="text-[10px] text-zinc-500">/ {totalPages}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {onRemove ? (
          <button
            onClick={onRemove}
            className="px-2 py-1 text-xs rounded-md bg-red-600/80 hover:bg-red-600 text-white"
            title="Xoá hotspot"
          >
            Xoá
          </button>
        ) : <div />}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            Huỷ
          </button>
          <button
            onClick={onSave}
            className="px-2.5 py-1 text-xs rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
