"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const KEY_STORAGE_PREFIX = "ai_gen_apikey_";

type Provider = "gemini" | "deepseek" | "openrouter";

const PROVIDER_INFO: Record<
  Provider,
  { label: string; signupUrl: string; placeholder: string; hint: string; serverFallback?: boolean }
> = {
  gemini: {
    label: "Google Gemini",
    signupUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIza...",
    hint: "Free 1500 req/ngày cho Gemini Flash. Server đã có key sẵn, key của bạn sẽ override.",
    serverFallback: true,
  },
  deepseek: {
    label: "DeepSeek",
    signupUrl: "https://platform.deepseek.com/api_keys",
    placeholder: "sk-...",
    hint: "Đã bỏ free credit — cần nạp ≥ $2. Model deepseek-chat rất rẻ (~$0.14/1M token).",
  },
  openrouter: {
    label: "OpenRouter",
    signupUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-...",
    hint: "Free tier 50 req/ngày trên model :free (DeepSeek, Llama, Qwen, Gemma...). Đăng ký bằng Google.",
  },
};

function loadKey(p: Provider): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(KEY_STORAGE_PREFIX + p) || "";
  } catch {
    return "";
  }
}

interface Props {
  onClose: () => void;
}

export function ApiKeysModal({ onClose }: Props) {
  const [keys, setKeys] = useState<Record<Provider, string>>({
    gemini: loadKey("gemini"),
    deepseek: loadKey("deepseek"),
    openrouter: loadKey("openrouter"),
  });
  const [showRaw, setShowRaw] = useState<Record<Provider, boolean>>({
    gemini: false,
    deepseek: false,
    openrouter: false,
  });

  const updateKey = (p: Provider, value: string) => {
    setKeys((prev) => ({ ...prev, [p]: value }));
  };

  const saveKey = (p: Provider) => {
    const value = keys[p].trim();
    try {
      if (value) {
        localStorage.setItem(KEY_STORAGE_PREFIX + p, value);
        toast.success(`Đã lưu key ${PROVIDER_INFO[p].label}`);
      } else {
        localStorage.removeItem(KEY_STORAGE_PREFIX + p);
        toast.message(`Đã xoá key ${PROVIDER_INFO[p].label}`);
      }
    } catch {
      toast.error("Không lưu được vào localStorage");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">🔑 API key các model AI</h2>
            <p className="text-xs text-zinc-500">
              Key lưu trên máy bạn (localStorage), không gửi đâu khác ngoài provider khi gọi AI
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          {(["gemini", "deepseek", "openrouter"] as Provider[]).map((p) => {
            const info = PROVIDER_INFO[p];
            const value = keys[p];
            const isSet = !!value.trim();
            return (
              <div
                key={p}
                className={`border rounded-xl p-4 space-y-2 ${
                  isSet ? "border-emerald-300 bg-emerald-50/30" : "border-zinc-200 bg-zinc-50/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-900">{info.label}</span>
                    {isSet && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800 font-medium">
                        ĐÃ CÓ KEY
                      </span>
                    )}
                    {!isSet && info.serverFallback && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                        DÙNG SERVER KEY
                      </span>
                    )}
                  </div>
                  <a
                    href={info.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Lấy key →
                  </a>
                </div>

                <div className="flex gap-2">
                  <Input
                    type={showRaw[p] ? "text" : "password"}
                    placeholder={info.placeholder}
                    value={value}
                    onChange={(e) => updateKey(p, e.target.value)}
                    className="font-mono text-xs flex-1"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRaw((prev) => ({ ...prev, [p]: !prev[p] }))}
                    className="px-2 text-xs rounded border border-zinc-300 hover:bg-zinc-100"
                    title={showRaw[p] ? "Ẩn key" : "Hiện key"}
                  >
                    {showRaw[p] ? "🙈" : "👁"}
                  </button>
                  <Button onClick={() => saveKey(p)} size="sm">
                    Lưu
                  </Button>
                </div>

                <p className="text-[11px] text-zinc-500">{info.hint}</p>
              </div>
            );
          })}

          <div className="bg-zinc-100 border border-zinc-200 rounded-lg p-3 text-xs text-zinc-600 space-y-1">
            <div>
              <strong>🔒 An toàn:</strong> Key lưu localStorage trình duyệt này.
              KHÔNG gửi cho Convex server hoặc lưu trong DB — chỉ gửi qua HTTPS tới provider tương ứng (Google/DeepSeek/OpenRouter) khi gọi AI.
            </div>
            <div>
              <strong>🔄 Đổi máy:</strong> Mở Settings ở máy mới, paste lại key. Hoặc dùng feature export/import sau này (chưa có).
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end bg-zinc-50">
          <Button onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </div>
  );
}
