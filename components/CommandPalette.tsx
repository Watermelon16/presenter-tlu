"use client";

/**
 * Command Palette (⌘/Ctrl + K) — "phím tắt của mọi phím tắt".
 * Gõ để tìm & chạy mọi lệnh trong presenter mà không cần nhớ phím.
 * Tìm kiếm không dấu (gõ "hoat dong" vẫn ra "Hoạt động"), điều hướng bằng ↑↓, ↵ để chạy, Esc để đóng.
 *
 * Thuần thêm mới: nhận sẵn mảng `commands` từ trang presenter, không tự giữ logic nghiệp vụ.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  hint?: string; // mô tả phụ bên phải/dưới
  keys?: string[]; // phím tắt tương ứng để hiển thị
  group?: string;
  run: () => void;
  disabled?: boolean;
};

/** Bỏ dấu tiếng Việt + lowercase để so khớp không dấu. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

/**
 * Điểm khớp giữa query và 1 command. Trả -1 nếu không khớp.
 * Ưu tiên: khớp đầu chuỗi > khớp đầu từ > substring > subsequence (gõ tắt).
 */
function score(query: string, c: Command): number {
  const q = norm(query);
  if (!q) return 0;
  const hay = norm(`${c.label} ${c.hint ?? ""} ${(c.keys ?? []).join(" ")} ${c.group ?? ""}`);
  const label = norm(c.label);

  if (label.startsWith(q)) return 1000;
  // khớp đầu một từ trong label
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) return 800;
  const idx = hay.indexOf(q);
  if (idx >= 0) return 500 - idx;

  // subsequence: các ký tự query xuất hiện đúng thứ tự trong hay
  let qi = 0;
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] === q[qi]) qi++;
  }
  return qi === q.length ? 100 : -1;
}

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded border border-zinc-600 bg-zinc-800 text-zinc-200 text-[10px] font-mono font-semibold">
      {k}
    </kbd>
  );
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const enabled = commands.filter((c) => !c.disabled);
    const q = query.trim();
    if (!q) return enabled;
    return enabled
      .map((c) => ({ c, s: score(q, c) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [query, commands]);

  // Cuộn item đang chọn vào tầm nhìn
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // chạy sau khi đóng để focus trả về trang, không kẹt trong input
    setTimeout(() => c.run(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(filtered.length - 1);
    }
  };

  let currentGroup = "";

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[12vh] px-4 bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[560px] rounded-xl bg-zinc-950/97 border border-zinc-700 shadow-2xl text-white overflow-hidden flex flex-col max-h-[70vh]">
        {/* Ô tìm kiếm */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <span className="text-zinc-500 text-base">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0); // reset con trỏ chọn khi đổi từ khoá
            }}
            onKeyDown={onKeyDown}
            placeholder="Tìm lệnh… (vd: chiếu slide, điểm danh, laser)"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-zinc-600"
          />
          <kbd className="text-[10px] text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        {/* Danh sách lệnh */}
        <div ref={listRef} className="overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              Không tìm thấy lệnh nào khớp “{query}”.
            </div>
          ) : (
            filtered.map((c, i) => {
              const showGroup = c.group && c.group !== currentGroup;
              if (showGroup) currentGroup = c.group!;
              return (
                <div key={c.id}>
                  {showGroup && (
                    <div className="mt-1.5 mb-0.5 px-4 text-[10px] uppercase tracking-wider text-amber-400/90 font-semibold">
                      {c.group}
                    </div>
                  )}
                  <button
                    data-idx={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      i === active ? "bg-amber-500/15" : "hover:bg-zinc-800/40"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-100 truncate">{c.label}</div>
                      {c.hint && (
                        <div className="text-[11px] text-zinc-500 truncate">{c.hint}</div>
                      )}
                    </div>
                    {c.keys && c.keys.length > 0 && (
                      <div className="flex items-center gap-1 shrink-0">
                        {c.keys.map((k, j) => (
                          <Kbd key={j} k={k} />
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-1.5 border-t border-zinc-800 bg-zinc-900/60 text-[10px] text-zinc-500 flex items-center justify-center gap-3">
          <span>
            <Kbd k="↑" /> <Kbd k="↓" /> chọn
          </span>
          <span>
            <Kbd k="↵" /> chạy
          </span>
          <span>
            <Kbd k="Esc" /> đóng
          </span>
        </div>
      </div>
    </div>
  );
}
