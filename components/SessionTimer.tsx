"use client";

/**
 * Đồng hồ phiên — chip nổi giúp giảng viên quản lý nhịp tiết giảng.
 * - Giờ thực (HH:MM) để liếc nhanh.
 * - Bấm giờ trôi (MM:SS) chạy/tạm dừng/đặt lại; có thể đặt mốc nhắc (vd 45') → đổi màu khi cháy giờ.
 * Trạng thái lưu localStorage theo mã phòng nên sống qua reload / nhiều tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type TimerState = { startedAt: number | null; accumulatedMs: number; goalMin: number };

function load(key: string): TimerState {
  if (typeof window === "undefined") return { startedAt: null, accumulatedMs: 0, goalMin: 0 };
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as TimerState;
  } catch {}
  return { startedAt: null, accumulatedMs: 0, goalMin: 0 };
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

export function SessionTimer({ storageKey, onClose }: { storageKey: string; onClose: () => void }) {
  const [state, setState] = useState<TimerState>(() => load(storageKey));
  const [now, setNow] = useState(0); // mốc thời gian hiện tại, cập nhật mỗi giây trong interval
  const [clock, setClock] = useState("");

  // Lưu lại khi state đổi
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }, [state, storageKey]);

  // Tick 1s: cập nhật bấm giờ trôi + giờ thực
  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      const d = new Date(t);
      setClock(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
      setNow(t);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const running = state.startedAt !== null;
  const elapsedMs = state.accumulatedMs + (state.startedAt ? Math.max(0, now - state.startedAt) : 0);
  const overGoal = state.goalMin > 0 && elapsedMs >= state.goalMin * 60_000;

  const toggle = useCallback(() => {
    setState((s) =>
      s.startedAt
        ? { ...s, startedAt: null, accumulatedMs: s.accumulatedMs + (Date.now() - s.startedAt) }
        : { ...s, startedAt: Date.now() }
    );
  }, []);

  const reset = useCallback(() => {
    setState((s) => ({ ...s, startedAt: null, accumulatedMs: 0 }));
  }, []);

  const cycleGoal = useCallback(() => {
    // 0 → 30' → 45' → 50' → 90' → 0
    const seq = [0, 30, 45, 50, 90];
    setState((s) => {
      const i = seq.indexOf(s.goalMin);
      return { ...s, goalMin: seq[(i + 1) % seq.length] };
    });
  }, []);

  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const onDragStart = (e: React.MouseEvent) => {
    const el = (e.currentTarget as HTMLElement).parentElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ left: ev.clientX - dragRef.current.dx, top: ev.clientY - dragRef.current.dy });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="fixed z-[150] w-[182px] rounded-xl bg-zinc-950/95 border border-zinc-700 shadow-2xl text-white overflow-hidden"
      style={pos ? { left: pos.left, top: pos.top } : { left: 16, bottom: 16 }}
    >
      {/* Header kéo thả */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900/80 border-b border-zinc-800 cursor-move select-none"
      >
        <span className="text-[11px] text-zinc-400 font-mono tracking-wider">🕒 {clock}</span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white text-xs leading-none"
          title="Đóng (J)"
        >
          ✕
        </button>
      </div>

      {/* Bấm giờ trôi */}
      <div className="px-3 py-2 text-center">
        <div
          className={`text-3xl font-bold font-mono tabular-nums leading-none ${
            overGoal ? "text-red-400 animate-pulse" : running ? "text-emerald-400" : "text-zinc-200"
          }`}
        >
          {fmt(elapsedMs)}
        </div>
        {state.goalMin > 0 && (
          <div className={`text-[10px] mt-1 ${overGoal ? "text-red-400" : "text-zinc-500"}`}>
            {overGoal ? "⚠ Cháy giờ" : "Mốc"} {state.goalMin}′
          </div>
        )}
      </div>

      {/* Nút điều khiển */}
      <div className="flex items-stretch border-t border-zinc-800 text-xs">
        <button
          onClick={toggle}
          className={`flex-1 py-1.5 font-semibold transition ${
            running ? "text-amber-300 hover:bg-zinc-800" : "text-emerald-400 hover:bg-zinc-800"
          }`}
        >
          {running ? "⏸ Dừng" : "▶ Chạy"}
        </button>
        <button onClick={reset} className="flex-1 py-1.5 text-zinc-400 hover:bg-zinc-800 border-x border-zinc-800" title="Đặt lại 00:00">
          ↺
        </button>
        <button onClick={cycleGoal} className="flex-1 py-1.5 text-zinc-400 hover:bg-zinc-800" title="Đặt mốc nhắc giờ">
          ⏱{state.goalMin > 0 ? state.goalMin : ""}
        </button>
      </div>
    </div>
  );
}
