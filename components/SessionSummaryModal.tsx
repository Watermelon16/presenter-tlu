"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MODELS, PROVIDER_INFO, PROVIDER_ORDER, type Provider } from "@/lib/aiModels";

// Riêng cho summary để GV có thể chọn model khác cho summary mà không ảnh hưởng AI gen
const SUMMARY_MODEL_KEY = "ai_summary_model_v1";

function loadSavedModelId(): string {
  if (typeof window === "undefined") return MODELS[0].id;
  try {
    const saved = localStorage.getItem(SUMMARY_MODEL_KEY);
    if (saved && MODELS.some((m) => m.id === saved)) return saved;
  } catch {
    /* ignore */
  }
  return MODELS[0].id;
}

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
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedModelId, setSelectedModelId] = useState<string>(() => loadSavedModelId());
  const selectedModel = MODELS.find((m) => m.id === selectedModelId) ?? MODELS[0];
  const currentProvider = selectedModel.provider;
  const currentKey = (dbKeys ?? {})[currentProvider] ?? "";
  const hasKey = !!currentKey;

  const handleSelectModel = (id: string) => {
    setSelectedModelId(id);
    try {
      localStorage.setItem(SUMMARY_MODEL_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const result = await summarize({
        sessionId,
        provider: currentProvider,
        model: selectedModel.id,
        apiKey: currentKey || undefined,
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
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none shrink-0">×</button>
        </div>

        {/* Model selector — luôn hiện, kể cả khi đã có summary để GV chạy lại với model khác */}
        <div className="px-6 py-3 border-b border-zinc-100 bg-zinc-50 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-xs font-medium text-zinc-700 shrink-0">Model AI:</label>
            <select
              value={selectedModelId}
              onChange={(e) => handleSelectModel(e.target.value)}
              className="flex-1 min-w-0 h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
            >
              {PROVIDER_ORDER.map((p) => (
                <optgroup key={p} label={PROVIDER_INFO[p].label}>
                  {MODELS.filter((m) => m.provider === p).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.hint}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {!hasKey ? (
            <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
              ⚠ Chưa có API key <strong>{PROVIDER_INFO[currentProvider].label}</strong>. Vào ⚙️ Cài đặt → 🔑 API key để paste key (lưu 1 lần dùng cho mọi tính năng AI).
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">
              Dùng key <strong>{PROVIDER_INFO[currentProvider].label}</strong> đã lưu. Hết quota → đổi model khác trong list.
            </p>
          )}
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
                disabled={!hasKey}
                className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🤖 Bắt đầu phân tích
              </button>
            </div>
          )}

          {loading && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3 animate-pulse">🤖</div>
              <div className="text-sm text-zinc-700">AI đang đọc dữ liệu buổi giảng...</div>
              <div className="text-xs text-zinc-500 mt-1">
                {selectedModel.label} · có thể mất 5-15 giây
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
              ⚠ {error}
              <div className="mt-3 flex items-center gap-2">
                <button onClick={handleRun} className="text-xs underline">Thử lại</button>
                <span className="text-xs text-rose-500">· hoặc đổi model AI ở trên</span>
              </div>
            </div>
          )}

          {summary && (
            <div className="space-y-5">
              <section>
                <h3 className="text-sm font-semibold text-zinc-900 mb-2 flex items-center gap-1.5">📋 Tóm tắt</h3>
                <p className="text-sm text-zinc-700 bg-zinc-50 px-4 py-3 rounded-xl border border-zinc-200 leading-relaxed">
                  {summary.overview}
                </p>
                <div className="text-[11px] text-zinc-500 mt-1.5">
                  {summary.activityCount} hoạt động · {summary.responseCount} câu trả lời · {summary.providerUsed}/{summary.modelUsed}
                </div>
              </section>

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
                <span>Đổi model rồi chạy lại để so sánh nhiều góc nhìn</span>
                <button onClick={handleRun} disabled={!hasKey} className="px-3 py-1 rounded-md border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50">🔄 Chạy lại</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between shrink-0">
          <div className="text-xs text-zinc-500">
            AI có thể nhầm — đối chiếu với cảm nhận thực tế khi giảng.
          </div>
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100 font-medium">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
