"use client";

import { useEffect, useState } from "react";

interface Props {
  startedAt: number;          // epoch ms khi activity bắt đầu
  timeLimitMinutes: number;   // tổng thời gian (phút)
  position?: "top-right" | "center-top" | "top-left";
  big?: boolean;              // scale lên cho SV ngồi cuối lớp
  onElapsed?: () => void;     // callback khi hết giờ (chỉ gọi 1 lần)
}

/**
 * Countdown lớn cho màn chiếu — hiển thị thời gian còn lại của activity đang chạy.
 * Tự đổi màu xanh → vàng → đỏ. Pulse khi < 10s. "HẾT GIỜ" khi về 0.
 */
export function CountdownOverlay({
  startedAt,
  timeLimitMinutes,
  position = "top-right",
  big = false,
  onElapsed,
}: Props) {
  const totalMs = Math.round(timeLimitMinutes * 60 * 1000);
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, startedAt + totalMs - Date.now())
  );
  const [hasFired, setHasFired] = useState(false);

  useEffect(() => {
    const tick = () => {
      const next = Math.max(0, startedAt + totalMs - Date.now());
      setRemainingMs(next);
      if (next === 0 && !hasFired) {
        setHasFired(true);
        onElapsed?.();
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [startedAt, totalMs, hasFired, onElapsed]);

  const percentLeft = totalMs > 0 ? remainingMs / totalMs : 0;
  const isExpired = remainingMs === 0;
  const isUrgent = !isExpired && remainingMs < 10_000;
  const tone: "green" | "amber" | "red" =
    isExpired || percentLeft < 0.2 ? "red" : percentLeft < 0.5 ? "amber" : "green";

  const totalSec = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const timeText = isExpired
    ? "HẾT GIỜ"
    : `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;

  const posClass =
    position === "center-top"
      ? "top-6 left-1/2 -translate-x-1/2"
      : position === "top-left"
        ? "top-6 left-6"
        : "top-6 right-6";

  const toneClass: Record<typeof tone, string> = {
    green: "bg-emerald-600/95 text-white ring-emerald-300/50",
    amber: "bg-amber-500/95 text-black ring-amber-200/60",
    red: "bg-red-600/95 text-white ring-red-300/60",
  };

  // SVG circular progress
  const size = big ? 132 : 96;
  const stroke = big ? 10 : 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percentLeft);

  return (
    <div
      className={`fixed z-[110] ${posClass} ${isUrgent ? "animate-pulse" : ""}`}
    >
      <div
        className={`flex items-center gap-3 pl-3 pr-5 py-2 rounded-2xl shadow-2xl ring-2 ${toneClass[tone]}`}
      >
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="currentColor"
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 250ms linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl">⏱</span>
          </div>
        </div>
        <div className="flex flex-col">
          <div className={`tracking-widest opacity-80 font-semibold ${big ? "text-xs" : "text-[10px]"}`}>
            THỜI GIAN
          </div>
          <div className={`font-mono font-bold tabular-nums leading-none ${big ? "text-6xl" : "text-4xl"}`}>
            {timeText}
          </div>
        </div>
      </div>
    </div>
  );
}
