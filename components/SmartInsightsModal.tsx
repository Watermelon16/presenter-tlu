"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

// Re-use cùng list + storage keys với AiGenFromPdfModal để key paste 1 lần dùng cả 2 features
const MODEL_STORAGE_KEY = "ai_gen_model_v1";
const KEY_STORAGE_PREFIX = "ai_gen_apikey_";

type Provider = "gemini" | "deepseek" | "openrouter";

const MODELS: { id: string; provider: Provider; label: string }[] = [
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", provider: "gemini", label: "Gemini 2.5 Flash Lite" },
  { id: "gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro" },
  { id: "gemini-flash-latest", provider: "gemini", label: "Gemini Flash (latest)" },
  { id: "deepseek-chat", provider: "deepseek", label: "DeepSeek Chat" },
  { id: "deepseek/deepseek-v4-flash:free", provider: "openrouter", label: "OpenRouter · DeepSeek V4 Flash (free)" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", provider: "openrouter", label: "OpenRouter · Llama 3.3 70B (free)" },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", provider: "openrouter", label: "OpenRouter · Qwen3 80B (free)" },
];

function loadSavedKey(provider: Provider): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(KEY_STORAGE_PREFIX + provider) || "";
  } catch {
    return "";
  }
}

interface Props {
  sessionId: Id<"sessions">;
  run: number;
  sessionTitle: string;
  onClose: () => void;
}

type Insights = {
  topMistakes?: Array<{ activityTitle: string; wrongPct?: number; slidePage?: string; advice: string }>;
  lowEngagement?: Array<{ activityTitle: string; answerRate?: number; advice: string }>;
  themes?: Array<{ name: string; summary: string; fromActivity?: string }>;
  summary: string;
  actionItems: string[];
  studentFacingSummary: string;
};

export function SmartInsightsModal({ sessionId, run, sessionTitle, onClose }: Props) {
  const generate = useAction(api.insights.generateSessionInsights);
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);

  const [stage, setStage] = useState<"idle" | "generating" | "done">("idle");
  const [insights, setInsights] = useState<Insights | null>(null);
  const [modelInfo, setModelInfo] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window === "undefined") return MODELS[0].id;
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved && MODELS.some((m) => m.id === saved)) return saved;
    } catch {}
    return MODELS[0].id;
  });

  const currentModelDef = MODELS.find((m) => m.id === selectedModel) ?? MODELS[0];
  const currentProvider = currentModelDef.provider;
  const currentKey = (dbKeys ?? {})[currentProvider] ?? loadSavedKey(currentProvider);
  const needsKey = !currentKey;

  const handleAnalyze = async () => {
    setStage("generating");
    try {
      const result = await generate({
        sessionId,
        run,
        provider: currentProvider,
        model: selectedModel,
        apiKey: currentKey || undefined,
      });
      setInsights(result.insights);
      const usage = result.tokenUsage as { totalTokenCount?: number; total_tokens?: number } | null;
      const tokens = usage?.totalTokenCount ?? usage?.total_tokens;
      setModelInfo([result.modelUsed, tokens ? `${tokens} tokens` : ""].filter(Boolean).join(" · "));
      setStage("done");
      toast.success("Đã phân tích xong");
    } catch (e: unknown) {
      let msg = "Lỗi khi gọi AI";
      if (e instanceof ConvexError) {
        const data = e.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (e instanceof Error) {
        msg = e.message;
      }
      toast.error(msg, { duration: 10000 });
      setStage("idle");
    }
  };

  const copyText = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`Đã copy ${what}`),
      () => toast.error("Copy thất bại")
    );
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={() => stage !== "generating" && onClose()}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">🧠 Phân tích AI cuối buổi</h2>
            <p className="text-xs text-zinc-500">{sessionTitle} · Phiên {run}</p>
          </div>
          <button
            onClick={onClose}
            disabled={stage === "generating"}
            className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {stage === "idle" && (
          <div className="p-6 space-y-4">
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-900">
              Phân tích toàn bộ kết quả buổi giảng (poll, quiz, wordcloud, opentext, qa, board) để đưa ra:
              <ul className="list-disc list-inside mt-2 space-y-0.5 text-xs">
                <li>Top câu hỏi SV sai nhiều → khuyến nghị ôn lại slide nào</li>
                <li>Hoạt động engagement thấp → lý do + cách cải thiện</li>
                <li>2-4 chủ đề chính từ wordcloud + opentext + Q&amp;A</li>
                <li>Tóm tắt buổi cho GV + tóm tắt thân thiện để gửi SV</li>
              </ul>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Model AI</label>
              <select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  try {
                    localStorage.setItem(MODEL_STORAGE_KEY, e.target.value);
                  } catch {}
                }}
                className="w-full h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              {needsKey && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  ⚠ Provider <strong>{currentProvider}</strong> cần API key — mở <strong>⚙️ Cài đặt → 🔑 API key AI</strong> để paste key.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Huỷ</Button>
              <Button onClick={handleAnalyze} disabled={needsKey}>
                🧠 Phân tích ngay
              </Button>
            </div>
          </div>
        )}

        {stage === "generating" && (
          <div className="p-10 text-center space-y-3">
            <div className="text-4xl animate-pulse">🧠</div>
            <div className="text-sm text-zinc-700">Đang phân tích kết quả buổi giảng...</div>
            <div className="text-xs text-zinc-500">Có thể mất 15-40 giây tùy lượng data.</div>
          </div>
        )}

        {stage === "done" && insights && (
          <div className="flex flex-col max-h-[calc(100vh-12rem)]">
            <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">
              {/* Summary cho GV */}
              {insights.summary && (
                <Section title="📋 Tóm tắt cho giảng viên">
                  <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                    {insights.summary}
                  </p>
                </Section>
              )}

              {/* Action items */}
              {insights.actionItems && insights.actionItems.length > 0 && (
                <Section title="✅ Hành động cụ thể nên làm tiếp">
                  <ul className="space-y-1.5">
                    {insights.actionItems.map((item, i) => (
                      <li key={i} className="text-sm text-zinc-800 flex gap-2">
                        <span className="text-emerald-600 mt-0.5 shrink-0">{i + 1}.</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Top mistakes */}
              {insights.topMistakes && insights.topMistakes.length > 0 && (
                <Section title="❌ Câu hỏi SV sai nhiều">
                  <div className="space-y-2">
                    {insights.topMistakes.map((m, i) => (
                      <div key={i} className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-red-900">{m.activityTitle}</span>
                          {m.slidePage && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              Slide {m.slidePage}
                            </span>
                          )}
                          {m.wrongPct !== undefined && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-200 text-red-900 font-mono">
                              {m.wrongPct}% sai
                            </span>
                          )}
                        </div>
                        <div className="text-red-800">{m.advice}</div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Low engagement */}
              {insights.lowEngagement && insights.lowEngagement.length > 0 && (
                <Section title="📉 Hoạt động ít SV tham gia">
                  <div className="space-y-2">
                    {insights.lowEngagement.map((e, i) => (
                      <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-amber-900">{e.activityTitle}</span>
                          {e.answerRate !== undefined && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-mono">
                              {e.answerRate}% trả lời
                            </span>
                          )}
                        </div>
                        <div className="text-amber-800">{e.advice}</div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Themes */}
              {insights.themes && insights.themes.length > 0 && (
                <Section title="🎯 Chủ đề chính nổi lên">
                  <div className="space-y-2">
                    {insights.themes.map((t, i) => (
                      <div key={i} className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm">
                        <div className="font-medium text-violet-900 mb-0.5">{t.name}</div>
                        <div className="text-violet-800 text-xs">{t.summary}</div>
                        {t.fromActivity && (
                          <div className="text-[10px] text-violet-600 mt-1">từ: {t.fromActivity}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Student-facing summary */}
              {insights.studentFacingSummary && (
                <Section
                  title="📤 Tóm tắt gửi SV"
                  action={
                    <button
                      onClick={() => copyText(insights.studentFacingSummary, "tóm tắt cho SV")}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      📋 Copy
                    </button>
                  }
                >
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900 whitespace-pre-wrap leading-relaxed">
                    {insights.studentFacingSummary}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Copy đoạn này dán vào nhóm Zalo/LMS để chia sẻ với SV sau buổi.
                  </p>
                </Section>
              )}
            </div>

            <div className="px-6 py-3 border-t border-zinc-200 flex items-center justify-between bg-zinc-50">
              <div className="text-[11px] text-zinc-500">{modelInfo}</div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setInsights(null);
                    setStage("idle");
                  }}
                >
                  Phân tích lại
                </Button>
                <Button onClick={onClose}>Đóng</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
