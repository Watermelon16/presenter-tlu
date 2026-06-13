"use client";

/**
 * Thanh thả cảm xúc cho sinh viên (room) — nút nổi góc dưới phải.
 * Bấm 😊 để mở/đóng hàng emoji; chạm emoji → gửi reaction (Convex) + pop nhỏ tại chỗ.
 * Có throttle nhẹ để tránh spam.
 */

import { useCallback, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const EMOJIS = ["👏", "❤️", "😂", "😮", "👍", "🎉"];

export function ReactionBar({ sessionId }: { sessionId: Id<"sessions"> }) {
  const sendReaction = useMutation(api.reactions.sendReaction);
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState<{ id: number; emoji: string } | null>(null);
  const lastSent = useRef(0);
  const popId = useRef(0);

  const send = useCallback(
    (emoji: string) => {
      const t = Date.now();
      if (t - lastSent.current < 250) return; // throttle ~4/s
      lastSent.current = t;
      sendReaction({ sessionId, emoji }).catch(() => {});
      popId.current += 1;
      setPop({ id: popId.current, emoji });
    },
    [sessionId, sendReaction]
  );

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 select-none">
      {/* Pop nhỏ khi vừa gửi */}
      {pop && (
        <div
          key={pop.id}
          className="text-3xl pointer-events-none self-center"
          style={{ animation: "tk-pop 400ms ease-out" }}
          onAnimationEnd={() => setPop(null)}
        >
          {pop.emoji}
        </div>
      )}

      {/* Hàng emoji */}
      {open && (
        <div className="flex items-center gap-1 rounded-full bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-700 shadow-xl px-2 py-1.5 backdrop-blur">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => send(e)}
              className="text-2xl w-10 h-10 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition"
              aria-label={`Gửi ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Nút bật/tắt */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-14 h-14 rounded-full shadow-xl text-2xl flex items-center justify-center transition active:scale-90 border ${
          open
            ? "bg-zinc-800 text-white border-zinc-700"
            : "bg-white text-zinc-800 border-zinc-200 dark:bg-zinc-800 dark:text-white dark:border-zinc-700"
        }`}
        aria-label="Thả cảm xúc"
      >
        {open ? "✕" : "😊"}
      </button>
    </div>
  );
}
