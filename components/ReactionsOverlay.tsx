"use client";

/**
 * Lớp emoji bay (reactions) cho presenter — đè full màn, không bắt chuột.
 * Subscribe reaction gần nhất từ Convex; mỗi reaction MỚI (đến sau khi mount) bay lên
 * theo CSS keyframe `tk-float-up`. Vị trí/độ trôi/kích cỡ suy ra từ _id để ổn định.
 */

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const ANIM_MS = 4000;

// Hash chuỗi _id → số ổn định để random-but-stable cho mỗi reaction
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function ReactionsOverlay({ sessionId }: { sessionId: Id<"sessions"> }) {
  const reactions = useQuery(api.reactions.recentReactions, { sessionId }) ?? [];
  const [now, setNow] = useState(0);
  const [mountTime, setMountTime] = useState(0); // mốc mount; set qua setTimeout để khỏi setState trong effect body

  useEffect(() => {
    const t0 = setTimeout(() => setMountTime(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 300);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, []);

  // Chờ tới khi có mountTime để không phát lại loạt reaction cũ lúc mở/reload
  if (mountTime === 0) return null;

  // Chỉ hiện reaction đến sau khi mount và còn trong thời lượng animation
  const visible = reactions.filter(
    (r) => r.createdAt >= mountTime - 300 && now - r.createdAt < ANIM_MS
  );

  if (visible.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[140] pointer-events-none overflow-hidden">
      {visible.map((r) => {
        const h = hash(r._id);
        const left = 6 + (h % 88); // 6%..94%
        const drift = ((h >> 3) % 120) - 60; // -60..60 px
        const size = 30 + ((h >> 5) % 26); // 30..56 px
        const dur = 3400 + ((h >> 7) % 900); // 3.4s..4.3s
        return (
          <span
            key={r._id}
            className="absolute select-none"
            style={{
              left: `${left}%`,
              bottom: "8%",
              fontSize: size,
              // @ts-expect-error custom property cho keyframe
              "--tk-drift": `${drift}px`,
              animation: `tk-float-up ${dur}ms ease-out forwards`,
            }}
          >
            {r.emoji}
          </span>
        );
      })}
    </div>
  );
}
