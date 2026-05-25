"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

const LEGACY_KEY_STORAGE_PREFIX = "ai_gen_apikey_";

type Provider =
  | "gemini"
  | "deepseek"
  | "openrouter"
  | "groq"
  | "cerebras"
  | "github"
  | "mistral"
  | "together";

const PROVIDER_INFO: Record<
  Provider,
  { label: string; signupUrl: string; placeholder: string; hint: string; badge?: string }
> = {
  gemini: {
    label: "Google Gemini",
    signupUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIza...",
    hint: "Free 1500 req/ngày cho Gemini Flash.",
    badge: "Free",
  },
  groq: {
    label: "Groq",
    signupUrl: "https://console.groq.com/keys",
    placeholder: "gsk_...",
    hint: "Free tier: Llama 3.3 70B + Mixtral, RPM cao, latency thấp. Đăng ký bằng Google.",
    badge: "Free • Nhanh",
  },
  cerebras: {
    label: "Cerebras",
    signupUrl: "https://cloud.cerebras.ai",
    placeholder: "csk-...",
    hint: "Free tier với LPU chip — inference 2000+ tok/s. Có Llama 4 Scout, Llama 3.3 70B.",
    badge: "Free • Cực nhanh",
  },
  github: {
    label: "GitHub Models",
    signupUrl: "https://github.com/settings/tokens",
    placeholder: "ghp_... hoặc github_pat_...",
    hint: "Dùng GitHub Personal Access Token (chọn `models:read`). Free cho mọi GitHub user. GPT-4o, Llama, Phi, Mistral.",
    badge: "Free",
  },
  mistral: {
    label: "Mistral AI",
    signupUrl: "https://console.mistral.ai/api-keys",
    placeholder: "...",
    hint: "Free tier với Ministral 3B/8B + experimental models. Đăng ký bằng email.",
    badge: "Free",
  },
  together: {
    label: "Together AI",
    signupUrl: "https://api.together.ai/settings/api-keys",
    placeholder: "...",
    hint: "Có model :free (Llama 3.3 70B Turbo Free, DeepSeek R1 Distill, Llama Vision Free). $1 credit khi đăng ký.",
    badge: "Free",
  },
  openrouter: {
    label: "OpenRouter",
    signupUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-...",
    hint: "Aggregator nhiều model :free (DeepSeek, Llama, Qwen, Gemma). Free 50 req/ngày.",
    badge: "Free",
  },
  deepseek: {
    label: "DeepSeek (direct)",
    signupUrl: "https://platform.deepseek.com/api_keys",
    placeholder: "sk-...",
    hint: "Đã bỏ free credit — cần nạp ≥ $2. Rẻ ~$0.14/1M token.",
    badge: "Trả phí",
  },
};

const PROVIDER_ORDER: Provider[] = [
  "gemini",
  "groq",
  "cerebras",
  "github",
  "mistral",
  "together",
  "openrouter",
  "deepseek",
];

interface Props {
  onClose: () => void;
}

export function ApiKeysModal({ onClose }: Props) {
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);
  const setKey = useMutation(api.userProfiles.setAiApiKey);
  const setKeysBulk = useMutation(api.userProfiles.setAiApiKeysBulk);

  const [localKeys, setLocalKeys] = useState<Record<string, string>>({});
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  // Sync DB → local state khi load
  useEffect(() => {
    if (dbKeys) setLocalKeys({ ...dbKeys });
  }, [dbKeys]);

  // Auto-migrate legacy localStorage keys → DB lần đầu sau khi load
  useEffect(() => {
    if (!dbKeys || migrating) return;
    if (typeof window === "undefined") return;
    const legacy: Record<string, string> = {};
    for (const p of PROVIDER_ORDER) {
      try {
        const v = localStorage.getItem(LEGACY_KEY_STORAGE_PREFIX + p);
        if (v && !dbKeys[p]) legacy[p] = v;
      } catch {
        /* ignore */
      }
    }
    if (Object.keys(legacy).length === 0) return;
    setMigrating(true);
    setKeysBulk({ keys: legacy })
      .then(() => {
        toast.success(`Đã chuyển ${Object.keys(legacy).length} key cũ từ trình duyệt lên tài khoản — không phải nhập lại trên máy khác.`);
        // Xóa legacy localStorage để khỏi confusing sau
        for (const p of Object.keys(legacy)) {
          try { localStorage.removeItem(LEGACY_KEY_STORAGE_PREFIX + p); } catch { /* ignore */ }
        }
      })
      .catch(() => {
        // ignore migration error — user vẫn dùng được DB
      })
      .finally(() => setMigrating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbKeys]);

  const updateLocal = (p: Provider, value: string) => {
    setLocalKeys((prev) => ({ ...prev, [p]: value }));
  };

  const saveKey = async (p: Provider) => {
    setSavingProvider(p);
    try {
      await setKey({ provider: p, apiKey: localKeys[p] ?? "" });
      const trimmed = (localKeys[p] ?? "").trim();
      toast.success(trimmed ? `Đã lưu key ${PROVIDER_INFO[p].label}` : `Đã xoá key ${PROVIDER_INFO[p].label}`);
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast.error(err.message || "Lỗi");
    } finally {
      setSavingProvider(null);
    }
  };

  if (dbKeys === undefined) {
    return (
      <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl px-6 py-8 text-zinc-500" onClick={(e) => e.stopPropagation()}>
          Đang tải...
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h2 className="text-lg font-semibold">🔑 API key các model AI</h2>
            <p className="text-xs text-zinc-500">
              Key lưu vào tài khoản của bạn — đăng nhập máy khác vẫn dùng được, không phải nhập lại.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-3">
          {PROVIDER_ORDER.map((p) => {
            const info = PROVIDER_INFO[p];
            const value = localKeys[p] ?? "";
            const isSet = !!(dbKeys[p] ?? "").trim();
            const isDirty = value !== (dbKeys[p] ?? "");
            return (
              <div
                key={p}
                className={`border rounded-xl p-4 space-y-2 ${
                  isSet ? "border-emerald-300 bg-emerald-50/30" : "border-zinc-200 bg-zinc-50/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-900">{info.label}</span>
                    {info.badge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        info.badge.startsWith("Free")
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {info.badge}
                      </span>
                    )}
                    {isSet ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800 font-medium">
                        ĐÃ CÓ KEY
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 font-medium">
                        Chưa có
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
                    onChange={(e) => updateLocal(p, e.target.value)}
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
                  <Button
                    onClick={() => saveKey(p)}
                    size="sm"
                    disabled={savingProvider === p || !isDirty}
                  >
                    {savingProvider === p ? "..." : isDirty ? "Lưu" : "✓"}
                  </Button>
                </div>

                <p className="text-[11px] text-zinc-500">{info.hint}</p>
              </div>
            );
          })}

          <div className="bg-zinc-100 border border-zinc-200 rounded-lg p-3 text-xs text-zinc-600 space-y-1">
            <div>
              <strong>🔒 An toàn:</strong> Key lưu trên Convex DB của bạn — chỉ tài khoản này đọc được.
              Khi gọi AI, server forward request tới provider qua HTTPS, không lưu log.
            </div>
            <div>
              <strong>🔄 Đăng nhập máy khác:</strong> Tự động đồng bộ, không phải paste lại.
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end bg-zinc-50 sticky bottom-0 rounded-b-2xl">
          <Button onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </div>
  );
}
