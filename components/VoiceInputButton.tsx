"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Web Speech API wrapper — SV bấm để nói tiếng Việt, transcript append vào input.
 *
 * - Yêu cầu HTTPS (Vercel OK; localhost cũng OK)
 * - Chrome/Edge desktop + mobile, Safari iOS 14.5+
 * - Firefox: chưa support → button ẩn (return null)
 *
 * Cách dùng:
 *   <VoiceInputButton onTranscript={(text, isFinal) => setValue(value + " " + text)} />
 *
 * `onTranscript` được gọi nhiều lần:
 *   - isFinal=false: kết quả tạm (user đang nói) — KHÔNG nên ghi đè input vì có thể thay đổi
 *   - isFinal=true: kết quả cuối cho 1 utterance — append vào value
 *
 * Để giữ logic UI ổn định:
 *   - Component này chỉ phát onTranscript khi isFinal=true (giữ interim trong state nội bộ)
 *   - Hiển thị interim text ở tooltip / overlay nhỏ
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  onTranscript: (text: string) => void;
  lang?: string;
  // Optional: custom className for the button
  className?: string;
  // Size variant
  size?: "sm" | "md";
};

type RecognitionType = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: () => void;
  onend: () => void;
  onerror: (e: { error?: string }) => void;
  onresult: (e: {
    resultIndex: number;
    results: ArrayLike<{
      isFinal: boolean;
      0: { transcript: string };
    }>;
  }) => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getRecognitionCtor(): (new () => RecognitionType) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionType;
    webkitSpeechRecognition?: new () => RecognitionType;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceInputButton({
  onTranscript,
  lang = "vi-VN",
  className,
  size = "md",
}: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionType | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  // Cleanup khi unmount
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  if (supported === false) return null;
  // Trong khi chưa biết support → render disabled placeholder để layout ổn định
  // (tránh layout shift)

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Trình duyệt không hỗ trợ");
      return;
    }
    setError(null);
    setInterim("");

    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.onerror = (e) => {
      setListening(false);
      setInterim("");
      const err = String(e?.error ?? "");
      const map: Record<string, string> = {
        "no-speech": "Không nghe thấy gì",
        "audio-capture": "Không tìm thấy micro",
        "not-allowed": "Hãy cấp quyền micro cho trang",
        "service-not-allowed": "Trình duyệt chặn nhận diện giọng nói",
      };
      setError(map[err] ?? err);
      setTimeout(() => setError(null), 3500);
    };
    rec.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript;
        if (result.isFinal) finalText += text;
        else interimText += text;
      }
      if (finalText) {
        onTranscript(finalText.trim());
      }
      setInterim(interimText);
    };
    // Hủy recognizer cũ (nếu bấm nhanh 2 lần trước khi onstart kịp set listening)
    // → tránh để lại 1 recognizer mồ côi giữ mic + bắn onresult cũ.
    if (recRef.current) {
      try { recRef.current.abort(); } catch { /* ignore */ }
    }
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setError("Không thể bắt đầu — thử lại");
      setListening(false);
    }
  };

  const sz = size === "sm" ? "w-8 h-8 text-sm" : "w-10 h-10 text-base";

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        disabled={supported === null}
        className={
          className ??
          `${sz} rounded-full flex items-center justify-center transition-colors shrink-0 ${
            listening
              ? "bg-rose-500 text-white animate-pulse ring-2 ring-rose-200"
              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 active:bg-zinc-300"
          }`
        }
        aria-label={listening ? "Dừng nói" : "Bấm để nói (tiếng Việt)"}
        title={listening ? "Đang nghe… bấm để dừng" : "Bấm rồi nói tiếng Việt"}
      >
        🎤
      </button>
      {/* Interim popup (overlays bên dưới) */}
      {(listening && interim) && (
        <div className="absolute left-0 top-full mt-1 z-50 max-w-[260px] px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs shadow-lg whitespace-normal">
          <span className="opacity-60">đang nghe: </span>
          {interim}
        </div>
      )}
      {error && (
        <div className="absolute left-0 top-full mt-1 z-50 max-w-[260px] px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs shadow-lg">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
