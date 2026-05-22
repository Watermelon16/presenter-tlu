"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  trigger: React.ReactNode;
  align?: "left" | "right";
  width?: string;        // tailwind width class
  children: (close: () => void) => React.ReactNode;
}

/**
 * Simple click-to-toggle dropdown. Click outside hoặc Esc → đóng.
 */
export function Dropdown({ trigger, align = "right", width = "w-60", children }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="contents"
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute top-full mt-1.5 ${align === "right" ? "right-0" : "left-0"} ${width} bg-white border border-zinc-200 rounded-xl shadow-lg z-[60] py-1`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * Item helper — chuẩn hoá style cho mọi dropdown.
 */
export function DropdownItem({
  icon,
  label,
  hint,
  shortcut,
  onClick,
  disabled,
  danger,
  highlight,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-2 text-sm flex items-start gap-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? "hover:bg-red-50 text-red-700"
          : highlight
            ? "hover:bg-emerald-50 text-emerald-800"
            : "hover:bg-zinc-100 text-zinc-800"
      }`}
    >
      {icon !== undefined && <span className="text-lg shrink-0 leading-tight">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{label}</span>
          {shortcut && (
            <kbd className="text-[10px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-500 font-mono">
              {shortcut}
            </kbd>
          )}
        </div>
        {hint && <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{hint}</div>}
      </div>
    </button>
  );
}

export function DropdownDivider() {
  return <div className="my-1 border-t border-zinc-100" />;
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
      {children}
    </div>
  );
}
