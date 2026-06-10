"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Word cloud kiểu chuyên nghiệp (Mentimeter/d3-cloud):
// - Từ lớn nhất ở giữa, các từ còn lại xếp xoắn ốc quanh tâm, không đè lên nhau
// - Kích thước theo căn bậc hai tần suất (từ lặp nhiều nổi bật nhưng không nuốt hết chỗ)
// - Mỗi từ một màu cố định theo nội dung (không nhấp nháy đổi màu khi có phản hồi mới)
// - Tự co giãn vừa khung, chuyển động mượt khi cloud cập nhật realtime

export type CloudWord = { word: string; count: number };

type Props = {
  words: CloudWord[];
  theme?: "dark" | "light";
  maxWords?: number;
  showCounts?: boolean;
  className?: string;
};

const DARK_PALETTE = [
  "#34d399", // emerald
  "#60a5fa", // blue
  "#fbbf24", // amber
  "#f472b6", // pink
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#fb923c", // orange
  "#a3e635", // lime
];

const LIGHT_PALETTE = [
  "#059669",
  "#2563eb",
  "#d97706",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#65a30d",
];

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

type PlacedWord = {
  word: string;
  count: number;
  x: number;
  y: number;
  size: number;
  rotated: boolean;
  color: string;
};

type Rect = { x: number; y: number; w: number; h: number };

function collides(a: Rect, rects: Rect[], pad: number): boolean {
  for (const b of rects) {
    if (
      a.x - pad < b.x + b.w &&
      a.x + a.w + pad > b.x &&
      a.y - pad < b.y + b.h &&
      a.y + a.h + pad > b.y
    ) {
      return true;
    }
  }
  return false;
}

function computeLayout(
  words: CloudWord[],
  width: number,
  height: number,
  palette: string[],
  fontFamily: string
): { placed: PlacedWord[]; fit: number; offsetX: number; offsetY: number } {
  if (words.length === 0 || width < 40 || height < 40) {
    return { placed: [], fit: 1, offsetX: 0, offsetY: 0 };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { placed: [], fit: 1, offsetX: 0, offsetY: 0 };

  const sorted = [...words].sort((a, b) => b.count - a.count);
  const maxCount = sorted[0].count;
  const minCount = sorted[sorted.length - 1].count;

  const maxSize = Math.max(28, Math.min(height * 0.26, width * 0.16, 132));
  const minSize = Math.max(13, maxSize * 0.17);

  // Tỉ lệ dẹt theo khung (màn chiếu thường rộng) để cloud lấp ngang thay vì dồn dọc
  const aspect = Math.max(1, Math.min(width / height, 2.4));

  const rects: Rect[] = [];
  const placed: PlacedWord[] = [];

  sorted.forEach((item, idx) => {
    const ratio =
      maxCount === minCount ? 1 : (item.count - minCount) / (maxCount - minCount);
    const size = Math.round(minSize + (maxSize - minSize) * Math.sqrt(ratio));

    // Xoay dọc một phần từ nhỏ cho dáng cloud tự nhiên; từ to giữ ngang để dễ đọc
    const rotated = idx > 2 && size < maxSize * 0.55 && hashString(item.word) % 3 === 0;

    ctx.font = `700 ${size}px ${fontFamily}`;
    const textW = ctx.measureText(item.word).width;
    const textH = size * 1.18;
    const w = rotated ? textH : textW;
    const h = rotated ? textW : textH;

    // Xoắn ốc Archimedes quanh tâm, điểm xuất phát lệch theo hash để cloud cân đối
    const startAngle = (hashString(item.word) % 360) * (Math.PI / 180);
    let placedRect: Rect | null = null;
    for (let t = 0; t < 2200; t++) {
      const angle = startAngle + t * 0.32;
      const radius = 2.2 * t * 0.32;
      const cx = radius * Math.cos(angle) * aspect;
      const cy = radius * Math.sin(angle);
      const rect: Rect = { x: cx - w / 2, y: cy - h / 2, w, h };
      if (!collides(rect, rects, 5)) {
        placedRect = rect;
        break;
      }
    }
    if (!placedRect) return;

    rects.push(placedRect);
    placed.push({
      word: item.word,
      count: item.count,
      x: placedRect.x + w / 2,
      y: placedRect.y + h / 2,
      size,
      rotated,
      color: palette[hashString(item.word) % palette.length],
    });
  });

  // Co toàn cloud vừa khung (spiral không bị chặn biên nên luôn xếp được hết từ)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const bbW = Math.max(1, maxX - minX);
  const bbH = Math.max(1, maxY - minY);
  const fit = Math.min((width * 0.96) / bbW, (height * 0.94) / bbH, 1);
  const offsetX = -((minX + maxX) / 2) * fit;
  const offsetY = -((minY + maxY) / 2) * fit;

  return { placed, fit, offsetX, offsetY };
}

export default function WordCloud({
  words,
  theme = "dark",
  maxWords = 80,
  showCounts = false,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fontFamily, setFontFamily] = useState("system-ui, sans-serif");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setFontFamily(getComputedStyle(el).fontFamily || "system-ui, sans-serif");
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const palette = theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;

  const layout = useMemo(
    () => computeLayout(words.slice(0, maxWords), box.w, box.h, palette, fontFamily),
    [words, maxWords, box.w, box.h, palette, fontFamily]
  );

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <style>{`
        @keyframes wordcloud-enter {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes wordcloud-enter-rot {
          from { opacity: 0; transform: translate(-50%, -50%) rotate(-90deg) scale(0.3); }
          to { opacity: 1; transform: translate(-50%, -50%) rotate(-90deg) scale(1); }
        }
      `}</style>
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(${layout.offsetX}px, ${layout.offsetY}px) scale(${layout.fit})`,
          transition: "transform 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {layout.placed.map((p) => (
          <span
            key={p.word}
            className="absolute font-bold whitespace-nowrap leading-none select-none cursor-default"
            style={{
              left: p.x,
              top: p.y,
              fontSize: p.size,
              color: p.color,
              transform: `translate(-50%, -50%)${p.rotated ? " rotate(-90deg)" : ""}`,
              transition:
                "left 600ms cubic-bezier(0.22, 1, 0.36, 1), top 600ms cubic-bezier(0.22, 1, 0.36, 1), font-size 600ms cubic-bezier(0.22, 1, 0.36, 1)",
              animation: `${p.rotated ? "wordcloud-enter-rot" : "wordcloud-enter"} 500ms cubic-bezier(0.22, 1, 0.36, 1) both`,
            }}
            title={`${p.word} — ${p.count} lượt`}
          >
            {p.word}
            {showCounts && p.count > 1 && (
              <sup className="ml-1 font-semibold opacity-60" style={{ fontSize: Math.max(10, p.size * 0.4) }}>
                {p.count}
              </sup>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
