"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Provider = "gemini" | "deepseek" | "openrouter";

const KEY_STORAGE_PREFIX = "ai_gen_apikey_";
const MODEL_STORAGE_KEY = "ai_gen_model_v1";
const PROVIDER_STORAGE_KEY = "ai_gen_provider_v1";

const MODEL_DEFAULTS: Record<Provider, string> = {
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-chat",
  openrouter: "deepseek/deepseek-v4-flash:free",
};

type Summary = {
  overview: string;
  understandings: string[];
  confusions: string[];
  notableQuestions: string[];
  nextSuggestions: string[];
  activityCount: number;
  responseCount: number;
  modelUsed: string;
  providerUsed: Provider;
};

export function SessionSummaryModal({ sessionId, onClose }: { sessionId: Id<"sessions">; onClose: () => void }) {
  const summarize = useAction(api.ai.summarizeSession);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = (typeof window !== "undefined" ? (localStorage.getItem(PROVIDER_STORAGE_KEY) as Provider) : null) || "gemini";
  const apiKey = typeof window !== "undefined" ? localStorage.getItem(KEY_STORAGE_PREFIX + provider) || "" : "";
  const model = (typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null) || MODEL_DEFAULTS[provider];

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const result = await summarize({
        sessionId,
        provider,
        model,
        apiKey: apiKey || undefined,
      });
      setSummary(result);
    } catch (e: unknown) {
      const err = e as { data?: { message?: string; code?: string }; message?: string };
      const msg = err.data?.message || err.message || "Lỗi không xác định";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-6 flex flex-col max-h-[calc(100vh-3rem)]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">🤖 Tóm tắt buổi giảng (AI)</h2>
            <p className="text-xs text-zinc-500 mt-1">
              AI đọc toàn bộ câu trả lời, Q&A và board → rút insight để cải thiện chất lượng dạy.
              {apiKey ? (
                <span className="ml-1 text-emerald-700">Dùng <strong>{provider}</strong> / <code className="text-[10px]">{model}</code></span>
              ) : (
                <span className="ml-1 text-rose-700">⚠ Chưa có API key — vào ⚙️ Cài đặt → 🔑 API key trước</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none shrink-0">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {!summary && !loading && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🤖</div>
              <div className="text-sm text-zinc-700 mb-4">
                Bấm nút dưới để AI phân tích toàn bộ hoạt động trong buổi.
                <br />
                <span className="text-xs text-zinc-500">Mất khoảng 5-15 giây tuỳ model.</span>
              </div>
              <button
                onClick={handleRun}
                disabled={!apiKey}
                className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🤖 Bắt đầu phân tích
              </button>
              {!apiKey && (
                <p className="text-xs text-rose-600 mt-3">Mở menu ⚙️ Cài đặt → 🔑 API key AI để nhập key trước.</p>
              )}
            </div>
          )}

          {loading && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3 animate-pulse">🤖</div>
              <div className="text-sm text-zinc-700">AI đang đọc dữ liệu buổi giảng...</div>
              <div className="text-xs text-zinc-500 mt-1">Có thể mất 5-15 giây</div>
            </div>
          )}

          {error && !loading && (
            <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
              ⚠ {error}
              <div className="mt-3">
                <button onClick={handleRun} className="text-xs underline">Thử lại</button>
              </div>
            </div>
          )}

          {summary && (
            <div className="space-y-5">
              {/* Overview */}
              <section>
                <h3 className="text-sm font-semibold text-zinc-900 mb-2 flex items-center gap-1.5">📋 Tóm tắt</h3>
                <p className="text-sm text-zinc-700 bg-zinc-50 px-4 py-3 rounded-xl border border-zinc-200 leading-relaxed">
                  {summary.overview}
                </p>
                <div className="text-[11px] text-zinc-500 mt-1.5">
                  {summary.activityCount} hoạt động · {summary.responseCount} câu trả lời · {summary.providerUsed}/{summary.modelUsed}
                </div>
              </section>

              {/* Understandings */}
              {summary.understandings.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-emerald-800 mb-2 flex items-center gap-1.5">✅ SV hiểu rõ</h3>
                  <ul className="space-y-1.5">
                    {summary.understandings.map((s, i) => (
                      <li key={i} className="text-sm text-zinc-800 flex gap-2">
                        <span className="text-emerald-600 shrink-0">{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Confusions */}
              {summary.confusions.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-1.5">⚠️ Còn nhầm / lúng túng</h3>
                  <ul className="space-y-1.5">
                    {summary.confusions.map((s, i) => (
                      <li key={i} className="text-sm text-zinc-800 flex gap-2">
                        <span className="text-amber-600 shrink-0">{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Notable questions */}
              {summary.notableQuestions.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-sky-800 mb-2 flex items-center gap-1.5">❓ Câu hỏi đáng chú ý</h3>
                  <ul className="space-y-1.5">
                    {summary.notableQuestions.map((s, i) => (
                      <li key={i} className="text-sm text-zinc-800 flex gap-2">
                        <span className="text-sky-600 shrink-0">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Next session suggestions */}
              {summary.nextSuggestions.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-violet-800 mb-2 flex items-center gap-1.5">🎯 Gợi ý cho buổi sau</h3>
                  <ul className="space-y-1.5">
                    {summary.nextSuggestions.map((s, i) => (
                      <li key={i} className="text-sm text-zinc-800 flex gap-2">
                        <span className="text-violet-600 shrink-0">→</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="pt-3 border-t border-zinc-200 flex items-center justify-between text-xs text-zinc-500">
                <span>Có thể chạy lại để có góc nhìn mới</span>
                <button onClick={handleRun} className="px-3 py-1 rounded-md border border-zinc-300 hover:bg-zinc-50">🔄 Chạy lại</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between shrink-0">
          <div className="text-xs text-zinc-500">
            AI có thể nhầm — hãy đối chiếu với cảm nhận thực tế.
          </div>
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100 font-medium">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
