"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VnTextarea } from "@/components/VnInput";

type SurveyType = "poll" | "wordcloud" | "opentext" | "rating";
type Provider = "gemini" | "deepseek" | "openrouter";

const MODEL_STORAGE_KEY = "ai_gen_model_v1";
const KEY_STORAGE_PREFIX = "ai_gen_apikey_";
const SURVEY_TOPIC_KEY = "ai_survey_last_topic";

const MODELS: { id: string; provider: Provider; label: string }[] = [
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash (server)" },
  { id: "gemini-2.5-flash-lite", provider: "gemini", label: "Gemini 2.5 Flash Lite" },
  { id: "gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro" },
  { id: "deepseek-chat", provider: "deepseek", label: "DeepSeek Chat" },
  { id: "deepseek/deepseek-v4-flash:free", provider: "openrouter", label: "OpenRouter · DeepSeek V4 (free)" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", provider: "openrouter", label: "OpenRouter · Llama 3.3 70B (free)" },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", provider: "openrouter", label: "OpenRouter · Qwen3 80B (free)" },
];

function loadSavedKey(p: Provider): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(KEY_STORAGE_PREFIX + p) || "";
  } catch {
    return "";
  }
}

const TOPIC_TEMPLATES = [
  "Đánh giá phương pháp giảng dạy của giảng viên trong buổi học hôm nay",
  "Mức độ rõ ràng và dễ hiểu của các slide bài giảng",
  "Tốc độ giảng dạy và lượng kiến thức truyền tải trong buổi",
  "Nội dung môn học so với mong đợi ban đầu của sinh viên",
  "Ý kiến về tài liệu tham khảo và bài tập của môn",
  "Đề xuất cải thiện chương trình môn học cho khoá sau",
];

interface Props {
  sessionId: Id<"sessions">;
  sessionTitle: string;
  existingActivityCount: number;
  collectStudentCode: boolean;
  onClose: () => void;
}

type Suggestion = {
  type: SurveyType;
  title: string;
  options: string[];
  isQuiz: boolean;
  correctOptionIndexes: number[];
  ratingMin?: number;
  ratingMax?: number;
  ratingMinLabel?: string;
  ratingMaxLabel?: string;
  suggestedTimeLimit: number;
  reasoning?: string;
};

type EditableSuggestion = Suggestion & { id: string; enabled: boolean };

const TYPE_LABEL: Record<SurveyType, string> = {
  rating: "Đánh giá thang điểm",
  poll: "Trắc nghiệm",
  wordcloud: "Word Cloud",
  opentext: "Trả lời ngắn",
};

const TYPE_TONE: Record<SurveyType, string> = {
  rating: "bg-amber-50 text-amber-800 border-amber-200",
  poll: "bg-indigo-50 text-indigo-800 border-indigo-200",
  wordcloud: "bg-sky-50 text-sky-800 border-sky-200",
  opentext: "bg-teal-50 text-teal-800 border-teal-200",
};

export function SurveyAiGenModal({
  sessionId,
  sessionTitle: _sessionTitle,
  existingActivityCount,
  collectStudentCode,
  onClose,
}: Props) {
  const generate = useAction(api.ai.generateSurveyActivities);
  const createActivity = useMutation(api.activities.createActivity);

  const [stage, setStage] = useState<"idle" | "generating" | "review" | "saving">("idle");
  const [topic, setTopic] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(SURVEY_TOPIC_KEY) || "";
    } catch {
      return "";
    }
  });
  const [context, setContext] = useState("");
  const [count, setCount] = useState(6);
  const [enabledTypes, setEnabledTypes] = useState<Set<SurveyType>>(
    new Set(["rating", "opentext", "poll"])
  );
  const [requiresStudentCode, setRequiresStudentCode] = useState(false);
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [tokenInfo, setTokenInfo] = useState("");

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
  const currentKey = loadSavedKey(currentProvider);
  const needsKey = !currentKey;

  const toggleType = (t: SurveyType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size > 1) next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error("Nhập chủ đề khảo sát trước");
      return;
    }
    if (enabledTypes.size === 0) {
      toast.error("Chọn ít nhất 1 loại câu hỏi");
      return;
    }
    setStage("generating");
    try {
      const result = await generate({
        topic: topic.trim(),
        context: context.trim() || undefined,
        count,
        enabledTypes: Array.from(enabledTypes),
        provider: currentProvider,
        model: selectedModel,
        apiKey: currentKey || undefined,
      });
      try {
        localStorage.setItem(SURVEY_TOPIC_KEY, topic.trim());
      } catch {}

      const editable: EditableSuggestion[] = result.suggestions.map((s, idx) => ({
        ...s,
        id: `sur_${Date.now()}_${idx}`,
        enabled: true,
      }));
      setSuggestions(editable);

      const usage = result.tokenUsage as { totalTokenCount?: number; total_tokens?: number } | null;
      const tokens = usage?.totalTokenCount ?? usage?.total_tokens;
      setTokenInfo([tokens ? `${tokens} tokens` : "", result.modelUsed].filter(Boolean).join(" · "));

      setStage("review");
      if (editable.length === 0) {
        toast.warning("AI không tạo được câu hỏi nào — thử lại với chủ đề rõ ràng hơn.");
        setStage("idle");
      } else {
        toast.success(`AI gen ${editable.length} câu khảo sát`);
      }
    } catch (e: unknown) {
      let msg = "Lỗi khi gọi AI";
      if (e instanceof ConvexError) {
        const d = e.data as { message?: string } | undefined;
        if (d?.message) msg = d.message;
      } else if (e instanceof Error) {
        msg = e.message;
      }
      toast.error(msg, { duration: 10000 });
      setStage("idle");
    }
  };

  const update = (id: string, patch: Partial<EditableSuggestion>) => {
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const updateOption = (id: string, i: number, v: string) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = [...s.options];
        next[i] = v;
        return { ...s, options: next };
      })
    );
  };

  const addOption = (id: string) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, options: [...s.options, ""] } : s))
    );
  };

  const removeOption = (id: string, i: number) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = s.options.filter((_, idx) => idx !== i);
        return { ...s, options: next };
      })
    );
  };

  const handleSaveAll = async () => {
    const enabled = suggestions.filter((s) => s.enabled);
    if (enabled.length === 0) {
      toast.warning("Chưa chọn câu nào để lưu");
      return;
    }

    if (requiresStudentCode && !collectStudentCode) {
      toast.error("Buổi đang tắt thu thập mã SV. Tắt 'Yêu cầu mã SV' hoặc bật trong cài đặt buổi.");
      return;
    }

    setStage("saving");
    let saved = 0;
    let failed = 0;
    let nextOrder = existingActivityCount + 1;

    for (const s of enabled) {
      try {
        const validOptions = s.options.map((o) => o.trim()).filter(Boolean);
        const config: Record<string, unknown> = {};

        if (s.type === "poll") {
          if (validOptions.length < 2) {
            toast.error(`Poll "${s.title.slice(0, 30)}..." cần ít nhất 2 lựa chọn`);
            failed++;
            continue;
          }
          config.pollType = "single_choice";
          config.options = validOptions.map((text, i) => ({ id: `opt_${i}`, text }));
          config.shuffleOptions = false;
          if (s.isQuiz && s.correctOptionIndexes.length > 0) {
            config.isQuiz = true;
            config.correctOptionIds = s.correctOptionIndexes
              .filter((i) => i < validOptions.length)
              .map((i) => `opt_${i}`);
          }
        } else if (s.type === "wordcloud") {
          config.maxLength = 30;
        } else if (s.type === "opentext") {
          config.maxLength = 500;
        } else if (s.type === "rating") {
          config.min = s.ratingMin ?? 1;
          config.max = s.ratingMax ?? 5;
          if (s.ratingMinLabel) config.minLabel = s.ratingMinLabel;
          if (s.ratingMaxLabel) config.maxLabel = s.ratingMaxLabel;
        }

        await createActivity({
          sessionId,
          type: s.type,
          title: s.title.trim(),
          config,
          requiresStudentCode,
          timeLimit: s.suggestedTimeLimit > 0 ? s.suggestedTimeLimit : undefined,
          order: nextOrder++,
        });
        saved++;
      } catch (e) {
        failed++;
        console.error("Tạo activity lỗi:", e);
      }
    }

    if (saved > 0) {
      toast.success(`Đã tạo ${saved} câu khảo sát${failed > 0 ? ` (${failed} thất bại)` : ""}`);
      onClose();
    } else {
      toast.error("Không tạo được câu khảo sát nào");
      setStage("review");
    }
  };

  const isWorking = stage === "generating" || stage === "saving";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={() => !isWorking && onClose()}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold">🗳 Khảo sát từ chủ đề (AI gen)</h2>
            <p className="text-xs text-zinc-500">
              Nhập chủ đề → AI tạo 5-15 câu khảo sát (rating + opentext + poll)
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isWorking}
            className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {stage === "idle" && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center justify-between">
                <span>Chủ đề khảo sát <span className="text-red-500">*</span></span>
                <span className="text-[11px] text-zinc-400">Càng cụ thể, câu hỏi càng sát</span>
              </label>
              <VnTextarea
                value={topic}
                onValueChange={setTopic}
                placeholder="VD: Đánh giá phương pháp giảng dạy môn Thủy công trong học kỳ này"
                rows={2}
                className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-violet-500"
              />
              <div className="flex flex-wrap gap-1.5">
                {TOPIC_TEMPLATES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTopic(t)}
                    className="text-[11px] px-2 py-1 rounded-full border border-zinc-200 bg-zinc-50 hover:bg-violet-50 hover:border-violet-300 text-zinc-600 hover:text-violet-700 transition-colors"
                  >
                    {t.slice(0, 50)}...
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Context bổ sung (tuỳ chọn)</label>
              <VnTextarea
                value={context}
                onValueChange={setContext}
                placeholder="VD: Lớp 65C, môn Đập và Hồ chứa, buổi 5 đã giảng về phân loại đập đất"
                rows={2}
                className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Số câu hỏi</label>
                <Input
                  type="number"
                  min={1}
                  max={15}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value) || 6)}
                />
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
                  className="w-full h-10 rounded-md border border-zinc-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Loại câu hỏi cho phép</label>
              <div className="grid grid-cols-2 gap-2">
                {(["rating", "opentext", "poll", "wordcloud"] as SurveyType[]).map((t) => (
                  <label
                    key={t}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      enabledTypes.has(t)
                        ? TYPE_TONE[t] + " font-medium"
                        : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabledTypes.has(t)}
                      onChange={() => toggleType(t)}
                      className="shrink-0"
                    />
                    <span className="text-sm">{TYPE_LABEL[t]}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={requiresStudentCode}
                onChange={(e) => setRequiresStudentCode(e.target.checked)}
                disabled={!collectStudentCode}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Tính điểm cho các câu khảo sát này</span>
                <span className="block text-xs text-zinc-500 mt-0.5">
                  Mặc định TẮT — khảo sát thường để ẩn danh hoặc không tính điểm.
                </span>
              </span>
            </label>

            {needsKey && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠ Provider <strong>{currentProvider}</strong> cần API key — mở <strong>⚙️ Cài đặt → 🔑 API key AI</strong> để paste key (dùng chung mọi feature AI).
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
              <Button variant="outline" onClick={onClose}>
                Huỷ
              </Button>
              <Button onClick={handleGenerate} disabled={!topic.trim() || needsKey}>
                🗳 Sinh khảo sát
              </Button>
            </div>
          </div>
        )}

        {stage === "generating" && (
          <div className="p-10 text-center space-y-3">
            <div className="text-4xl animate-pulse">🗳</div>
            <div className="text-sm text-zinc-700">AI đang soạn câu khảo sát...</div>
            <div className="text-xs text-zinc-500">10-30 giây.</div>
          </div>
        )}

        {stage === "review" && (
          <>
            <div className="px-6 py-3 border-b border-zinc-100 flex items-center justify-between text-sm bg-zinc-50 shrink-0">
              <div className="text-zinc-700">
                <span className="font-medium">{suggestions.filter((s) => s.enabled).length}/{suggestions.length}</span> câu khảo sát sẽ tạo
                {tokenInfo && <span className="text-xs text-zinc-500 ml-2">· {tokenInfo}</span>}
              </div>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() =>
                    setSuggestions((prev) => prev.map((s) => ({ ...s, enabled: true })))
                  }
                  className="text-zinc-600 hover:text-zinc-900"
                >
                  Chọn tất cả
                </button>
                <span className="text-zinc-300">|</span>
                <button
                  onClick={() =>
                    setSuggestions((prev) => prev.map((s) => ({ ...s, enabled: false })))
                  }
                  className="text-zinc-600 hover:text-zinc-900"
                >
                  Bỏ tất cả
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-4 space-y-3 flex-1">
              {suggestions.map((s, idx) => (
                <SurveyCard
                  key={s.id}
                  index={idx + 1}
                  suggestion={s}
                  onChange={(patch) => update(s.id, patch)}
                  onUpdateOption={(i, v) => updateOption(s.id, i, v)}
                  onAddOption={() => addOption(s.id)}
                  onRemoveOption={(i) => removeOption(s.id, i)}
                />
              ))}
            </div>

            <div className="px-6 py-3 border-t border-zinc-200 flex justify-end gap-2 bg-white shrink-0">
              <Button variant="outline" onClick={() => setStage("idle")}>
                ← Chỉnh chủ đề
              </Button>
              <Button onClick={handleSaveAll}>
                💾 Lưu {suggestions.filter((s) => s.enabled).length} câu
              </Button>
            </div>
          </>
        )}

        {stage === "saving" && (
          <div className="p-10 text-center space-y-3">
            <div className="text-4xl animate-pulse">💾</div>
            <div className="text-sm text-zinc-700">Đang lưu các câu khảo sát...</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SurveyCard({
  index,
  suggestion,
  onChange,
  onUpdateOption,
  onAddOption,
  onRemoveOption,
}: {
  index: number;
  suggestion: EditableSuggestion;
  onChange: (patch: Partial<EditableSuggestion>) => void;
  onUpdateOption: (i: number, v: string) => void;
  onAddOption: () => void;
  onRemoveOption: (i: number) => void;
}) {
  return (
    <div
      className={`border rounded-xl p-4 transition-colors ${
        suggestion.enabled ? "border-zinc-300 bg-white" : "border-zinc-200 bg-zinc-50 opacity-60"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={suggestion.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="mt-1.5"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-mono text-zinc-400">#{index}</span>
            <span className={`px-1.5 py-0.5 rounded font-medium border ${TYPE_TONE[suggestion.type]}`}>
              {TYPE_LABEL[suggestion.type]}
            </span>
            <label className="flex items-center gap-1 text-zinc-500">
              <span>Thời gian (phút)</span>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={suggestion.suggestedTimeLimit}
                onChange={(e) =>
                  onChange({ suggestedTimeLimit: Number(e.target.value) || 0 })
                }
                className="w-20 h-7 px-2 py-1 text-xs"
              />
            </label>
          </div>

          <Input
            value={suggestion.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="font-medium"
            placeholder="Câu hỏi"
          />

          {suggestion.type === "poll" && (
            <div className="space-y-1.5 pt-1">
              {suggestion.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-zinc-400 text-xs font-mono w-6 text-right">{i + 1}.</span>
                  <Input
                    value={opt}
                    onChange={(e) => onUpdateOption(i, e.target.value)}
                    placeholder={`Lựa chọn ${i + 1}`}
                    className="h-9 text-sm flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveOption(i)}
                    className="text-zinc-400 hover:text-red-600 shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={onAddOption}
                className="text-xs text-zinc-600 hover:text-zinc-900"
              >
                + Thêm lựa chọn
              </button>
            </div>
          )}

          {suggestion.type === "rating" && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-2">
                <span className="text-zinc-500 w-14">Min - Label</span>
                <Input
                  type="number"
                  min={0}
                  value={suggestion.ratingMin ?? 1}
                  onChange={(e) => onChange({ ratingMin: Number(e.target.value) })}
                  className="w-14 h-8"
                />
                <Input
                  value={suggestion.ratingMinLabel ?? ""}
                  onChange={(e) => onChange({ ratingMinLabel: e.target.value })}
                  placeholder="Rất kém"
                  className="h-8 flex-1"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-zinc-500 w-14">Max - Label</span>
                <Input
                  type="number"
                  min={1}
                  value={suggestion.ratingMax ?? 5}
                  onChange={(e) => onChange({ ratingMax: Number(e.target.value) })}
                  className="w-14 h-8"
                />
                <Input
                  value={suggestion.ratingMaxLabel ?? ""}
                  onChange={(e) => onChange({ ratingMaxLabel: e.target.value })}
                  placeholder="Rất tốt"
                  className="h-8 flex-1"
                />
              </label>
            </div>
          )}

          {suggestion.reasoning && (
            <div className="text-xs text-zinc-500 italic border-l-2 border-zinc-200 pl-2">
              💡 {suggestion.reasoning}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
