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
const MIN_HOTSPOT_FRAC = 0.02; // tối thiểu sau resize (2% chiều slide)
const DRAG_THRESHOLD_FRAC = 0.005; // di chuyển > 0.5% slide mới tính là drag (không phải click)
// Khi trình chiếu: nới vùng bấm tối thiểu để các node/hotspot nhỏ (vd thanh
// stepper, vòng tròn số) dễ click trúng. Chỉ ảnh hưởng vùng bấm vô hình,
// không đổi dữ liệu lưu hay hiển thị edit mode.
const MIN_HIT_FRAC = 0.04;

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

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
  // Drag state — move hoặc resize 1 hotspot có sẵn
  const [drag, setDrag] = useState<null | {
    id: string;
    dragMode: DragMode;
    startNx: number;
    startNy: number;
    orig: { x: number; y: number; w: number; h: number };
    moved: boolean;
  }>(null);
  const [dragPreview, setDragPreview] = useState<null | { id: string; x: number; y: number; w: number; h: number }>(null);

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

  // === Click present mode ===
  const handlePresentClick = (h: Hotspot, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode !== "present") return;
    onJump?.(h.targetPage);
  };

  // === Drag/resize hotspot có sẵn (chỉ edit mode) ===
  const startDrag = (h: Hotspot, dragMode: DragMode, e: React.PointerEvent) => {
    if (mode !== "edit") return;
    e.stopPropagation();
    e.preventDefault();
    const [nx, ny] = getNorm(e);
    setDrag({
      id: h._id,
      dragMode,
      startNx: nx,
      startNy: ny,
      orig: { x: h.x, y: h.y, w: h.w, h: h.h },
      moved: false,
    });
    setDragPreview({ id: h._id, x: h.x, y: h.y, w: h.w, h: h.h });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const continueDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const [nx, ny] = getNorm(e);
    const dx = nx - drag.startNx;
    const dy = ny - drag.startNy;
    const movedNow = Math.abs(dx) > DRAG_THRESHOLD_FRAC || Math.abs(dy) > DRAG_THRESHOLD_FRAC;
    if (movedNow && !drag.moved) setDrag({ ...drag, moved: true });

    const o = drag.orig;
    let x = o.x, y = o.y, w = o.w, h = o.h;
    if (drag.dragMode === "move") {
      x = Math.max(0, Math.min(1 - o.w, o.x + dx));
      y = Math.max(0, Math.min(1 - o.h, o.y + dy));
    } else {
      // Resize: tính theo 2 cạnh đối — góc đối diện cố định
      const right = o.x + o.w;
      const bottom = o.y + o.h;
      if (drag.dragMode === "nw" || drag.dragMode === "sw") {
        const newX = Math.max(0, Math.min(right - MIN_HOTSPOT_FRAC, o.x + dx));
        x = newX;
        w = right - newX;
      } else { // ne | se
        const newRight = Math.max(o.x + MIN_HOTSPOT_FRAC, Math.min(1, right + dx));
        w = newRight - o.x;
      }
      if (drag.dragMode === "nw" || drag.dragMode === "ne") {
        const newY = Math.max(0, Math.min(bottom - MIN_HOTSPOT_FRAC, o.y + dy));
        y = newY;
        h = bottom - newY;
      } else { // sw | se
        const newBottom = Math.max(o.y + MIN_HOTSPOT_FRAC, Math.min(1, bottom + dy));
        h = newBottom - o.y;
      }
    }
    setDragPreview({ id: drag.id, x, y, w, h });
  };

  const endDrag = (h: Hotspot) => {
    if (!drag || drag.id !== h._id) return;
    const moved = drag.moved;
    const preview = dragPreview;
    setDrag(null);
    setDragPreview(null);
    if (moved && preview) {
      onUpdate?.(h._id, { x: preview.x, y: preview.y, w: preview.w, h: preview.h });
    } else {
      // Click không drag → mở popup edit (đổi target / xoá)
      setEditingId(h._id);
      setTargetInput(String(h.targetPage));
      setPendingRect(null);
    }
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
        // Nếu đang drag hotspot này → render rect preview thay vì rect gốc
        const useRect = dragPreview && dragPreview.id === h._id ? dragPreview : h;
        let left = useRect.x * size.w;
        let top = useRect.y * size.h;
        let width = useRect.w * size.w;
        let height = useRect.h * size.h;
        // Present mode: nới vùng bấm tối thiểu (giữ tâm), kẹp trong khung slide.
        if (mode === "present") {
          const minW = MIN_HIT_FRAC * size.w;
          const minH = MIN_HIT_FRAC * size.h;
          if (width < minW) { left -= (minW - width) / 2; width = minW; }
          if (height < minH) { top -= (minH - height) / 2; height = minH; }
          left = Math.max(0, Math.min(left, size.w - width));
          top = Math.max(0, Math.min(top, size.h - height));
        }
        const isEditingThis = editingId === h._id;
        const isDraggingThis = drag?.id === h._id;
        return (
          <div
            key={h._id}
            data-hotspot-existing
            onPointerDown={(e) => {
              if (mode === "edit") startDrag(h, "move", e);
            }}
            onPointerMove={continueDrag}
            onPointerUp={(e) => {
              if (mode === "edit") {
                endDrag(h);
              } else {
                handlePresentClick(h, e);
              }
            }}
            onPointerCancel={() => { setDrag(null); setDragPreview(null); }}
            onClick={(e) => e.stopPropagation()}
            className="absolute"
            style={{
              left, top, width, height,
              pointerEvents: "auto",
              cursor: mode === "edit" ? "move" : "pointer",
              background: mode === "edit"
                ? (isEditingThis || isDraggingThis ? "rgba(245,158,11,0.18)" : "rgba(59,130,246,0.10)")
                : "transparent",
              border: mode === "edit"
                ? (isEditingThis || isDraggingThis ? "2px solid #f59e0b" : "2px dashed rgba(59,130,246,0.75)")
                : "none",
              borderRadius: 4,
              touchAction: mode === "edit" ? "none" : undefined,
            }}
            title={mode === "present"
              ? `→ Slide ${h.targetPage}${h.label ? ` (${h.label})` : ""}`
              : `Kéo để di chuyển · Kéo góc để resize · Click để đổi trang đích`
            }
          >
            {mode === "edit" && (
              <>
                <div className="absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-600 text-white whitespace-nowrap pointer-events-none">
                  →{h.targetPage}
                </div>
                {/* 4 corner resize handles */}
                <ResizeHandle pos="nw" onPointerDown={(e) => startDrag(h, "nw", e)} onPointerMove={continueDrag} onPointerUp={() => endDrag(h)} />
                <ResizeHandle pos="ne" onPointerDown={(e) => startDrag(h, "ne", e)} onPointerMove={continueDrag} onPointerUp={() => endDrag(h)} />
                <ResizeHandle pos="sw" onPointerDown={(e) => startDrag(h, "sw", e)} onPointerMove={continueDrag} onPointerUp={() => endDrag(h)} />
                <ResizeHandle pos="se" onPointerDown={(e) => startDrag(h, "se", e)} onPointerMove={continueDrag} onPointerUp={() => endDrag(h)} />
              </>
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

function ResizeHandle({
  pos, onPointerDown, onPointerMove, onPointerUp,
}: {
  pos: "nw" | "ne" | "sw" | "se";
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}) {
  // Vị trí + cursor tương ứng góc
  const styleByPos: Record<typeof pos, React.CSSProperties> = {
    nw: { left: -6, top: -6, cursor: "nwse-resize" },
    ne: { right: -6, top: -6, cursor: "nesw-resize" },
    sw: { left: -6, bottom: -6, cursor: "nesw-resize" },
    se: { right: -6, bottom: -6, cursor: "nwse-resize" },
  };
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      className="absolute w-3 h-3 bg-white border-2 border-amber-500 rounded-sm shadow"
      style={{ ...styleByPos[pos], touchAction: "none" }}
    />
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
