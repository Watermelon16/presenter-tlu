"use client";

/**
 * Floating cheatsheet phím tắt — hiện đè lên màn hình khi GV bấm H hoặc ?
 * Không phải dialog modal nặng — chỉ là overlay góc phải có thể bấm Esc/H để đóng.
 */

import { useEffect } from "react";

type Row = { keys: string[]; label: string; group?: string };

const ROWS: Row[] = [
  // === HOẠT ĐỘNG ===
  { keys: ["A"], label: "Kích hoạt hoạt động kế tiếp", group: "Hoạt động" },
  { keys: ["X"], label: "Đóng hoạt động đang chạy" },
  { keys: ["R"], label: "Xem kết quả + công bố đáp án" },
  { keys: ["⇧", "R"], label: "Chạy lại hoạt động đang focus" },
  { keys: ["T"], label: "Đổi tab Kết quả ↔ Bảng thành tích" },

  // === CHIẾU SLIDE ===
  { keys: ["S"], label: "Mở/đóng chiếu slide PDF", group: "Chiếu slide" },
  { keys: ["Q"], label: "Chiếu QR + mã phòng fullscreen" },
  { keys: ["B"], label: "Blank đen — tạm dừng slide" },
  { keys: ["C"], label: "Ẩn/hiện QR sidebar trong slide overlay" },
  { keys: ["←", "→"], label: "Slide trước / sau" },
  { keys: ["Space"], label: "Slide kế / bước script tiếp" },
  { keys: ["Home"], label: "Slide đầu" },
  { keys: ["End"], label: "Slide cuối" },
  { keys: ["0-9", "↵"], label: "Nhảy đến slide cụ thể (gõ số + Enter)" },

  // === SCRIPT ===
  { keys: [","], label: "Bước trước trong script", group: "Script" },
  { keys: ["."], label: "Bước sau trong script" },

  // === MENU ===
  { keys: ["M"], label: "Mở bảng điểm danh", group: "Menu nhanh" },
  { keys: ["N"], label: "Mở Nhịp lớp (heatmap)" },
  { keys: ["I"], label: "Mở Smart Insights AI" },
  { keys: ["E"], label: "Xuất Excel phiên hiện tại" },

  // === KHÁC ===
  { keys: ["H"], label: "Hiện/ẩn bảng phím tắt này", group: "Khác" },
  { keys: ["Esc"], label: "Thoát overlay (auto về slide nếu vừa xem kết quả)" },
];

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 rounded border border-zinc-600 bg-zinc-800 text-zinc-100 text-[11px] font-mono font-semibold">
      {k}
    </kbd>
  );
}

export function HotkeyCheatsheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  let currentGroup = "";

  return (
    <div className="fixed top-1/2 right-4 -translate-y-1/2 z-[200] w-[340px] max-h-[85vh] rounded-xl bg-zinc-950/95 backdrop-blur border border-zinc-700 shadow-2xl text-white overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center gap-2">
          <span className="text-base">⌨</span>
          <span className="text-sm font-semibold">Phím tắt</span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white text-sm leading-none"
          title="Đóng (Esc hoặc H)"
        >
          ✕
        </button>
      </div>

      <div className="overflow-y-auto px-3 py-2.5 text-xs">
        {ROWS.map((row, i) => {
          const showGroup = row.group && row.group !== currentGroup;
          if (showGroup) currentGroup = row.group!;
          return (
            <div key={i}>
              {showGroup && (
                <div className="mt-2 mb-1 px-1 text-[10px] uppercase tracking-wider text-amber-400 font-semibold">
                  {row.group}
                </div>
              )}
              <div className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-800/40">
                <div className="flex items-center gap-1 shrink-0">
                  {row.keys.map((k, j) => (
                    <span key={j} className="flex items-center">
                      <Kbd k={k} />
                      {j < row.keys.length - 1 && row.keys[j + 1].length === 1 && k !== "⇧" && (
                        <span className="text-zinc-600 mx-0.5">+</span>
                      )}
                    </span>
                  ))}
                </div>
                <div className="text-zinc-300 leading-snug">{row.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-1.5 border-t border-zinc-800 bg-zinc-900/60 text-[10px] text-zinc-500 text-center">
        Bấm <Kbd k="H" /> hoặc <Kbd k="?" /> để mở/đóng
      </div>
    </div>
  );
}
