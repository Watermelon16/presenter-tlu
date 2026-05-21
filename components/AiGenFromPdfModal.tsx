"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SuggestionType = "poll" | "wordcloud" | "opentext";

type Provider = "gemini" | "deepseek" | "openrouter";

type ModelDef = {
  id: string;          // model id gửi cho API
  provider: Provider;
  label: string;       // hiển thị
  hint: string;
};

// Whitelist phải khớp với ALLOWED_MODELS_BY_PROVIDER trong convex/ai.ts
const MODELS: ModelDef[] = [
  // ====== Gemini (server key có sẵn, có thể override) ======
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash", hint: "Server key sẵn · cân bằng" },
  { id: "gemini-2.5-flash-lite", provider: "gemini", label: "Gemini 2.5 Flash Lite", hint: "Server key sẵn · quota cao nhất" },
  { id: "gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro", hint: "Server key sẵn · thông minh nhất, quota thấp" },
  { id: "gemini-flash-latest", provider: "gemini", label: "Gemini Flash (latest)", hint: "Server key · auto-route" },
  { id: "gemini-2.0-flash-lite", provider: "gemini", label: "Gemini 2.0 Flash Lite", hint: "Server key · phiên bản cũ" },

  // ====== DeepSeek direct (cần user key + nạp balance — ko còn free) ======
  { id: "deepseek-chat", provider: "deepseek", label: "DeepSeek Chat", hint: "Cần nạp ≥ $2 (DeepSeek đã bỏ free credit)" },
  { id: "deepseek-reasoner", provider: "deepseek", label: "DeepSeek Reasoner", hint: "Reasoning · cần nạp balance" },

  // ====== OpenRouter (cần user key, model :free - verified 2026-05) ======
  { id: "deepseek/deepseek-v4-flash:free", provider: "openrouter", label: "DeepSeek V4 Flash (free)", hint: "Context 1M, mạnh nhất nhóm free" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", provider: "openrouter", label: "Llama 3.3 70B (free)", hint: "Meta · ổn định" },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", provider: "openrouter", label: "Qwen3 Next 80B (free)", hint: "Alibaba · context 256K" },
  { id: "qwen/qwen3-coder:free", provider: "openrouter", label: "Qwen3 Coder 480B (free)", hint: "Alibaba · context 1M" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", provider: "openrouter", label: "Nemotron 3 Super 120B (free)", hint: "NVIDIA · context 1M" },
  { id: "google/gemma-4-31b-it:free", provider: "openrouter", label: "Gemma 4 31B (free)", hint: "Google · open weights" },
  { id: "google/gemma-4-26b-a4b-it:free", provider: "openrouter", label: "Gemma 4 26B A4B (free)", hint: "Google · MoE" },
  { id: "openai/gpt-oss-120b:free", provider: "openrouter", label: "GPT-OSS 120B (free)", hint: "OpenAI open source" },
  { id: "z-ai/glm-4.5-air:free", provider: "openrouter", label: "GLM 4.5 Air (free)", hint: "Zhipu AI" },
];

const MODEL_STORAGE_KEY = "ai_gen_model_v1";
const KEY_STORAGE_PREFIX = "ai_gen_apikey_"; // suffix là provider name

const PROVIDER_INFO: Record<Provider, { label: string; signupUrl: string; needsUserKey: boolean }> = {
  gemini: {
    label: "Google Gemini",
    signupUrl: "https://aistudio.google.com/apikey",
    needsUserKey: false, // có server key fallback
  },
  deepseek: {
    label: "DeepSeek",
    signupUrl: "https://platform.deepseek.com/api_keys",
    needsUserKey: true,
  },
  openrouter: {
    label: "OpenRouter",
    signupUrl: "https://openrouter.ai/keys",
    needsUserKey: true,
  },
};

function loadSavedKey(provider: Provider): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(KEY_STORAGE_PREFIX + provider) || "";
  } catch {
    return "";
  }
}

function saveKey(provider: Provider, key: string) {
  try {
    if (key.trim()) {
      localStorage.setItem(KEY_STORAGE_PREFIX + provider, key.trim());
    } else {
      localStorage.removeItem(KEY_STORAGE_PREFIX + provider);
    }
  } catch {}
}

type Suggestion = {
  slidePage: number;
  type: SuggestionType;
  title: string;
  options: string[];
  isQuiz: boolean;
  correctOptionIndexes: number[];
  suggestedTimeLimit: number;
  reasoning?: string;
};

type EditableSuggestion = Suggestion & {
  id: string;
  enabled: boolean;
};

interface Props {
  sessionId: Id<"sessions">;
  sessionTitle: string;
  pdfUrl: string;
  numPages: number;
  existingActivityCount: number;
  collectStudentCode: boolean;
  onClose: () => void;
}

export function AiGenFromPdfModal({
  sessionId,
  sessionTitle,
  pdfUrl,
  numPages,
  existingActivityCount,
  collectStudentCode,
  onClose,
}: Props) {
  const generate = useAction(api.ai.generateActivitiesFromPdf);
  const createActivity = useMutation(api.activities.createActivity);

  const [stage, setStage] = useState<"idle" | "extracting" | "generating" | "review" | "saving">("idle");
  const [progress, setProgress] = useState<string>("");
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [tokenInfo, setTokenInfo] = useState<string>("");
  const [maxSuggestions, setMaxSuggestions] = useState(8);
  // Default OFF — SV đã nhập danh tính khi vào phòng, không cần ép từng activity.
  // Lecturer bật tay nếu muốn tính điểm cho hoạt động cụ thể.
  const [requiresStudentCode, setRequiresStudentCode] = useState(false);
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

  // Per-provider API key (load từ localStorage)
  const [apiKeyByProvider, setApiKeyByProvider] = useState<Record<Provider, string>>(() => ({
    gemini: loadSavedKey("gemini"),
    deepseek: loadSavedKey("deepseek"),
    openrouter: loadSavedKey("openrouter"),
  }));
  const currentKey = apiKeyByProvider[currentProvider];
  const needsUserKey = PROVIDER_INFO[currentProvider].needsUserKey;
  const hasKey = !!currentKey || !needsUserKey;
  const [showKeyInput, setShowKeyInput] = useState(false);

  const handleSelectModel = (id: string) => {
    setSelectedModel(id);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {}
  };

  const updateProviderKey = (provider: Provider, key: string) => {
    setApiKeyByProvider((prev) => ({ ...prev, [provider]: key }));
    saveKey(provider, key);
  };

  const extractPdfText = async (): Promise<{ pageNumber: number; text: string }[]> => {
    setStage("extracting");
    setProgress("Đang tải PDF...");
    const { pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const arrayBuffer = await (await fetch(pdfUrl)).arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;

    const pages: { pageNumber: number; text: string }[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      setProgress(`Đang trích xuất text trang ${i}/${pdfDoc.numPages}...`);
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" ");
      pages.push({ pageNumber: i, text });
    }
    return pages;
  };

  const handleGenerate = async () => {
    try {
      const pages = await extractPdfText();

      setStage("generating");
      setProgress(`Đang gửi cho AI (${currentModelDef.label})...`);
      const result = await generate({
        pages,
        maxSuggestions,
        sessionTitle,
        provider: currentProvider,
        model: selectedModel,
        apiKey: currentKey || undefined,
      });

      const editable: EditableSuggestion[] = result.suggestions.map((s, idx) => ({
        ...s,
        id: `sug_${Date.now()}_${idx}`,
        enabled: true,
      }));
      setSuggestions(editable);

      // tokenUsage shape khác nhau giữa providers — Gemini có totalTokenCount,
      // OpenAI-compat có total_tokens
      const usage = result.tokenUsage as
        | { totalTokenCount?: number; total_tokens?: number }
        | null;
      const tokens = usage?.totalTokenCount ?? usage?.total_tokens;
      const modelLabel = result.modelUsed ?? selectedModel;
      setTokenInfo(
        [tokens ? `${tokens} tokens` : null, `${result.pagesProcessed} trang`, modelLabel]
          .filter(Boolean)
          .join(" · ")
      );

      setStage("review");
      if (editable.length === 0) {
        toast.warning("AI không đề xuất được hoạt động nào. Thử lại với nhiều trang hơn.");
      } else {
        toast.success(`AI đã đề xuất ${editable.length} hoạt động`);
      }
    } catch (e: unknown) {
      let msg = "Có lỗi khi gọi AI";
      let code: string | undefined;
      if (e instanceof ConvexError) {
        const data = e.data as { code?: string; message?: string } | undefined;
        if (data?.message) msg = data.message;
        code = data?.code;
      } else if (e instanceof Error) {
        msg = e.message;
        if (/quota|429|exceeded/i.test(msg)) code = "quota_exceeded";
        else if (/balance|402/i.test(msg)) code = "no_balance";
        else if (/no endpoints|404/i.test(msg)) code = "model_not_found";
      }

      // Các code này đều cần đổi model/provider
      const switchable =
        code === "quota_exceeded" ||
        code === "no_balance" ||
        code === "model_not_found";

      if (switchable) {
        // Nếu lỗi balance (DeepSeek) → suggest OpenRouter free thay vì cùng provider
        // Nếu lỗi quota/404 → ưu tiên cùng provider (key đã có), fallback khác
        const preferDifferentProvider = code === "no_balance";
        const next = preferDifferentProvider
          ? MODELS.find((m) => m.provider !== currentProvider && m.id !== selectedModel)
          : MODELS.find((m) => m.provider === currentProvider && m.id !== selectedModel) ??
            MODELS.find((m) => m.id !== selectedModel);
        toast.error(msg, {
          duration: 12000,
          action: next
            ? {
                label: `Đổi sang ${next.label}`,
                onClick: () => handleSelectModel(next.id),
              }
            : undefined,
        });
      } else {
        toast.error(msg, { duration: 8000 });
      }
      setStage("idle");
      setProgress("");
    }
  };

  const updateSuggestion = (id: string, patch: Partial<EditableSuggestion>) => {
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const updateOption = (id: string, index: number, value: string) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = [...s.options];
        next[index] = value;
        return { ...s, options: next };
      })
    );
  };

  const addOption = (id: string) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, options: [...s.options, ""] } : s))
    );
  };

  const removeOption = (id: string, index: number) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const nextOptions = s.options.filter((_, i) => i !== index);
        const nextCorrect = s.correctOptionIndexes
          .filter((i) => i !== index)
          .map((i) => (i > index ? i - 1 : i));
        return { ...s, options: nextOptions, correctOptionIndexes: nextCorrect };
      })
    );
  };

  const toggleCorrect = (id: string, index: number) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const set = new Set(s.correctOptionIndexes);
        if (set.has(index)) set.delete(index);
        else set.add(index);
        return { ...s, correctOptionIndexes: Array.from(set).sort((a, b) => a - b) };
      })
    );
  };

  const handleSaveAll = async () => {
    const enabled = suggestions.filter((s) => s.enabled);
    if (enabled.length === 0) {
      toast.warning("Chưa chọn hoạt động nào để lưu");
      return;
    }

    // Validate
    for (const s of enabled) {
      if (!s.title.trim()) {
        toast.error("Có hoạt động chưa có tiêu đề");
        return;
      }
      if (s.type === "poll") {
        const valid = s.options.filter((o) => o.trim()).length;
        if (valid < 2) {
          toast.error(`Poll "${s.title.slice(0, 30)}..." cần ít nhất 2 lựa chọn`);
          return;
        }
      }
    }

    if (requiresStudentCode && !collectStudentCode) {
      toast.error(
        "Buổi giảng chưa bật thu thập mã sinh viên — tắt 'Yêu cầu mã SV' hoặc bật thu thập trong cài đặt buổi"
      );
      return;
    }

    setStage("saving");
    let saved = 0;
    let failed = 0;
    let nextOrder = existingActivityCount + 1;

    for (const s of enabled) {
      try {
        // Build config theo shape DB
        const validOptions = s.options.map((o) => o.trim()).filter(Boolean);
        const config: Record<string, unknown> = {};

        if (s.type === "poll") {
          config.pollType = "single_choice";
          config.options = validOptions.map((text, i) => ({
            id: `opt_${i}`,
            text,
          }));
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
        }

        await createActivity({
          sessionId,
          type: s.type,
          title: s.title.trim(),
          config,
          requiresStudentCode,
          timeLimit: s.suggestedTimeLimit > 0 ? s.suggestedTimeLimit : undefined,
          order: nextOrder++,
          // CHỈ điền số trang — parser app dùng /^\d+$/ để auto-match slide.
          slideCue: String(s.slidePage),
        });
        saved++;
      } catch (e) {
        failed++;
        console.error("Tạo activity lỗi:", e);
      }
    }

    if (saved > 0) {
      toast.success(`Đã tạo ${saved} hoạt động${failed > 0 ? ` (${failed} thất bại)` : ""}`);
      onClose();
    } else {
      toast.error("Không tạo được hoạt động nào");
      setStage("review");
    }
  };

  const isWorking = stage === "extracting" || stage === "generating" || stage === "saving";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={() => {
        if (!isWorking) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">🤖 Sinh hoạt động từ PDF</h2>
            <p className="text-xs text-zinc-500">
              {numPages} trang slide · Gemini 2.0 Flash · Lecturer review trước khi lưu
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
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Số hoạt động muốn tạo</label>
              <Input
                type="number"
                min={1}
                max={20}
                value={maxSuggestions}
                onChange={(e) => setMaxSuggestions(Number(e.target.value) || 8)}
                className="w-32"
              />
              <p className="text-xs text-zinc-500">AI sẽ phân bổ các hoạt động qua các trang slide.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Model AI</label>
              <select
                value={selectedModel}
                onChange={(e) => handleSelectModel(e.target.value)}
                className="w-full h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
              >
                {(["gemini", "deepseek", "openrouter"] as Provider[]).map((p) => (
                  <optgroup key={p} label={PROVIDER_INFO[p].label}>
                    {MODELS.filter((m) => m.provider === p).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.hint}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* User API key UI — chỉ hiện cho provider cần key + chưa có key, hoặc khi user mở */}
              {(needsUserKey || showKeyInput) && (
                <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-zinc-700">
                      API key {PROVIDER_INFO[currentProvider].label}
                      {!needsUserKey && (
                        <span className="ml-1 text-zinc-400 font-normal">(tùy chọn, override server)</span>
                      )}
                    </label>
                    <a
                      href={PROVIDER_INFO[currentProvider].signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Lấy key →
                    </a>
                  </div>
                  <Input
                    type="password"
                    placeholder={
                      currentProvider === "gemini"
                        ? "AIza... (để trống = dùng server key)"
                        : currentProvider === "deepseek"
                          ? "sk-..."
                          : "sk-or-v1-..."
                    }
                    value={currentKey}
                    onChange={(e) => updateProviderKey(currentProvider, e.target.value)}
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Key lưu trên máy bạn (localStorage). Mỗi lần gen, key được gửi qua HTTPS tới Convex action — server KHÔNG lưu, chỉ dùng để gọi {PROVIDER_INFO[currentProvider].label}.
                  </p>
                </div>
              )}

              {!needsUserKey && !showKeyInput && (
                <button
                  type="button"
                  onClick={() => setShowKeyInput(true)}
                  className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                >
                  Dùng API key Gemini của riêng tôi (thay vì server key)
                </button>
              )}

              <p className="text-xs text-zinc-500">
                Hết quota? Đổi model khác trong list — toast lỗi cũng có nút quick switch.
              </p>
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
                <span className="font-medium">Tính điểm cho các hoạt động này</span>
                <span className="block text-xs text-zinc-500 mt-0.5">
                  Mặc định TẮT — bật nếu muốn hoạt động AI gen ghi nhận điểm cho từng SV.
                  SV đã nhập danh tính lúc vào phòng nên không bị hỏi lại.
                </span>
                {!collectStudentCode && (
                  <span className="block text-xs text-amber-600 mt-0.5">
                    Buổi giảng đang tắt thu thập mã SV — không thể bật.
                  </span>
                )}
              </span>
            </label>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              ⚠ Slide là <strong>scan ảnh</strong> sẽ không trích xuất được text. Cần PDF có text layer (xuất từ PowerPoint, Word, LaTeX...).
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Huỷ
              </Button>
              <Button onClick={handleGenerate} disabled={!hasKey}>
                {hasKey ? "🤖 Bắt đầu sinh" : `Cần API key ${PROVIDER_INFO[currentProvider].label}`}
              </Button>
            </div>
          </div>
        )}

        {(stage === "extracting" || stage === "generating") && (
          <div className="p-10 text-center space-y-3">
            <div className="text-4xl animate-pulse">🤖</div>
            <div className="text-sm text-zinc-700">{progress}</div>
            <div className="text-xs text-zinc-500">
              {stage === "generating"
                ? "Gemini đang phân tích nội dung. Có thể mất 10-30 giây..."
                : "Trích xuất text từ PDF..."}
            </div>
          </div>
        )}

        {stage === "review" && (
          <div className="flex flex-col max-h-[calc(100vh-12rem)]">
            <div className="px-6 py-3 border-b border-zinc-100 flex items-center justify-between text-sm bg-zinc-50">
              <div className="text-zinc-700">
                <span className="font-medium">
                  {suggestions.filter((s) => s.enabled).length}/{suggestions.length}
                </span>{" "}
                hoạt động sẽ được tạo
                {tokenInfo && <span className="text-xs text-zinc-500 ml-2">· {tokenInfo}</span>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setSuggestions((prev) => prev.map((s) => ({ ...s, enabled: true })))
                  }
                  className="text-xs text-zinc-600 hover:text-zinc-900"
                >
                  Chọn tất cả
                </button>
                <span className="text-zinc-300">|</span>
                <button
                  onClick={() =>
                    setSuggestions((prev) => prev.map((s) => ({ ...s, enabled: false })))
                  }
                  className="text-xs text-zinc-600 hover:text-zinc-900"
                >
                  Bỏ tất cả
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-4 space-y-3 flex-1">
              {suggestions.map((s, idx) => (
                <SuggestionCard
                  key={s.id}
                  index={idx + 1}
                  suggestion={s}
                  numPages={numPages}
                  onChange={(patch) => updateSuggestion(s.id, patch)}
                  onUpdateOption={(i, v) => updateOption(s.id, i, v)}
                  onAddOption={() => addOption(s.id)}
                  onRemoveOption={(i) => removeOption(s.id, i)}
                  onToggleCorrect={(i) => toggleCorrect(s.id, i)}
                />
              ))}
            </div>

            <div className="px-6 py-3 border-t border-zinc-200 flex justify-end gap-2 bg-white">
              <Button variant="outline" onClick={onClose}>
                Huỷ
              </Button>
              <Button onClick={handleSaveAll}>
                💾 Lưu {suggestions.filter((s) => s.enabled).length} hoạt động
              </Button>
            </div>
          </div>
        )}

        {stage === "saving" && (
          <div className="p-10 text-center space-y-3">
            <div className="text-4xl animate-pulse">💾</div>
            <div className="text-sm text-zinc-700">Đang lưu các hoạt động...</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  index,
  suggestion,
  numPages,
  onChange,
  onUpdateOption,
  onAddOption,
  onRemoveOption,
  onToggleCorrect,
}: {
  index: number;
  suggestion: EditableSuggestion;
  numPages: number;
  onChange: (patch: Partial<EditableSuggestion>) => void;
  onUpdateOption: (i: number, v: string) => void;
  onAddOption: () => void;
  onRemoveOption: (i: number) => void;
  onToggleCorrect: (i: number) => void;
}) {
  const typeLabel = {
    poll: "Trắc nghiệm",
    wordcloud: "Word Cloud",
    opentext: "Trả lời ngắn",
  }[suggestion.type];

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
          <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
            <span className="font-mono">#{index}</span>
            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
              {typeLabel}
            </span>
            {suggestion.type === "poll" && suggestion.isQuiz && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                Quiz có đáp án
              </span>
            )}
            <label className="flex items-center gap-1">
              <span>Slide</span>
              <Input
                type="number"
                min={1}
                max={numPages}
                value={suggestion.slidePage}
                onChange={(e) => onChange({ slidePage: Number(e.target.value) || 1 })}
                className="w-16 h-7 px-2 py-1 text-xs"
              />
            </label>
            <label className="flex items-center gap-1">
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
            placeholder="Tiêu đề câu hỏi"
          />

          {suggestion.type === "poll" && (
            <div className="space-y-1.5 pt-1">
              {suggestion.options.map((opt, i) => {
                const isCorrect = suggestion.isQuiz && suggestion.correctOptionIndexes.includes(i);
                return (
                  <div key={i} className="flex items-center gap-2">
                    {suggestion.isQuiz && (
                      <button
                        type="button"
                        onClick={() => onToggleCorrect(i)}
                        title={isCorrect ? "Đánh dấu sai" : "Đánh dấu đúng"}
                        className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center text-xs ${
                          isCorrect
                            ? "bg-emerald-500 border-emerald-600 text-white"
                            : "bg-white border-zinc-300 text-zinc-400 hover:border-emerald-400"
                        }`}
                      >
                        {isCorrect ? "✓" : ""}
                      </button>
                    )}
                    <Input
                      value={opt}
                      onChange={(e) => onUpdateOption(i, e.target.value)}
                      placeholder={`Lựa chọn ${i + 1}`}
                      className="h-9 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveOption(i)}
                      className="text-zinc-400 hover:text-red-600 shrink-0"
                      title="Xoá lựa chọn"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onAddOption}
                  className="text-xs text-zinc-600 hover:text-zinc-900"
                >
                  + Thêm lựa chọn
                </button>
                <label className="text-xs flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={suggestion.isQuiz}
                    onChange={(e) => onChange({ isQuiz: e.target.checked })}
                  />
                  <span>Quiz (có đáp án đúng)</span>
                </label>
              </div>
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
