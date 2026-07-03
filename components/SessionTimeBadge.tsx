"use client";

import { useEffect, useState } from "react";

interface Props {
  attendanceOpenAt?: number | null;
  officialStartAt?: number | null;
  plannedDurationMinutes?: number | null;
  onOpenSettings?: () => void;
}

// Badge cảnh báo hết giờ dự kiến — CHỈ hiển thị nếu GV đã đặt thời lượng.
// Không tự khoá/kết thúc phòng, chỉ nhắc GV chủ động kết thúc buổi đúng giờ,
// tránh phòng "sống" mãi khiến các ngưỡng điểm danh (muộn/vắng) bị lệch.
export function SessionTimeBadge({ attendanceOpenAt, officialStartAt, plannedDurationMinutes, onOpenSettings }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (!plannedDurationMinutes) return null;
  const t0 = attendanceOpenAt ?? officialStartAt;
  if (!t0) {
    return (
      <button
        onClick={onOpenSettings}
        title="Thời lượng dự kiến đã đặt nhưng chưa có SV nào điểm danh → chưa xác lập T₀"
        className="px-2 py-1 text-[11px] rounded-lg border border-zinc-200 bg-white text-zinc-500"
      >
        ⏳ Chưa bắt đầu tính giờ
      </button>
    );
  }

  const elapsedMin = (now - t0) / 60_000;
  const remainingMin = Math.round(plannedDurationMinutes - elapsedMin);

  let tone = "bg-white border-zinc-200 text-zinc-600";
  let label = `⏱ Còn ${remainingMin}p`;
  if (remainingMin <= 0) {
    tone = "bg-red-50 border-red-300 text-red-700";
    label = `⏱ Quá giờ dự kiến ${Math.abs(remainingMin)}p`;
  } else if (remainingMin <= 10) {
    tone = "bg-amber-50 border-amber-300 text-amber-700";
    label = `⏱ Sắp hết giờ · còn ${remainingMin}p`;
  }

  return (
    <button
      onClick={onOpenSettings}
      title={`Thời lượng dự kiến ${plannedDurationMinutes}p — chỉ cảnh báo, không tự khoá/kết thúc phòng`}
      className={`px-2 py-1 text-[11px] font-medium rounded-lg border tabular-nums ${tone}`}
    >
      {label}
    </button>
  );
}
