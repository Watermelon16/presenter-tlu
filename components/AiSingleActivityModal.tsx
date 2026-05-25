"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MODELS, PROVIDER_INFO, PROVIDER_ORDER, type Provider } from "@/lib/aiModels";
import { callAiJson, AiClientError } from "@/lib/aiClient";

const MODEL_STORAGE_KEY = "ai_single_activity_model_v1";

type ActivityType = "poll" | "wordcloud" | "rating" | "opentext" | "board" | "qa";

const TYPE_INFO: Record<ActivityType, { icon: string; label: string; desc: string }> = {
  poll: { icon: "📊", label: "Trắc nghiệm", desc: "Câu hỏi + 4 lựa chọn + đáp án đúng + nhiễu" },
  wordcloud: { icon: "💬", label: "Word Cloud", desc: "Câu hỏi mở để SV trả lời 1-3 từ" },
  rating: { icon: "⭐", label: "Đánh giá", desc: "Câu hỏi rating 1-5 + nhãn min/max" },
  opentext: { icon: "📝", label: "Tự luận ngắn", desc: "Câu hỏi yêu cầu trả lời 1-2 câu" },
  board: { icon: "📌", label: "Bảng cộng tác", desc: "Câu hỏi mở + 3-4 cột phân loại bài SV đăng" },
  qa: { icon: "❓", label: "Q&A", desc: "Gợi ý chủ đề để SV tự đặt câu hỏi" },
};

// JSON schema cho từng loại — gửi cho Gemini structured output
function geminiSchemaForType(type: ActivityType): object {
  switch (type) {
    case "poll":
      return {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          isQuiz: { type: "BOOLEAN" },
          correctOptionIndexes: { type: "ARRAY", items: { type: "INTEGER" } },
          reasoning: { type: "STRING" },
        },
        required: ["title", "options"],
      };
    case "rating":
      return {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          ratingMin: { type: "INTEGER" },
          ratingMax: { type: "INTEGER" },
          ratingMinLabel: { type: "STRING" },
          ratingMaxLabel: { type: "STRING" },
          reasoning: { type: "STRING" },
        },
        required: ["title"],
      };
    case "board":
      return {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          columns: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                description: { type: "STRING" },
              },
              required: ["title"],
            },
          },
          reasoning: { type: "STRING" },
        },
        required: ["title", "columns"],
      };
    case "wordcloud":
    case "opentext":
    case "qa":
    default:
      return {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          reasoning: { type: "STRING" },
        },
        required: ["title"],
      };
  }
}

function buildPrompt(args: {
  type: ActivityType;
  topic: string;
  focus: string;
  context: string;
  asQuiz: boolean;
}): string {
  const typeLine = {
    poll: "trắc nghiệm (poll) với 3-5 lựa chọn",
    wordcloud: "word cloud (SV trả lời 1-3 từ)",
    rating: "đánh giá thang điểm 1-5 (rating)",
    opentext: "tự luận ngắn (SV trả lời 1-2 câu)",
    board: "bảng cộng tác Padlet-style (SV đăng bài text/ảnh vào các cột phân loại)",
    qa: "Q&A (gợi ý chủ đề để SV tự đặt câu hỏi)",
  }[args.type];

  const focusLine = args.focus.trim()
    ? `\nQUAN TRỌNG — HẸP PHẠM VI: chỉ tập trung vào "${args.focus.trim()}" trong bài giảng. KHÔNG dàn trải sang chủ đề khác.`
    : "";

  const contextLine = args.context.trim()
    ? `\nNgữ cảnh bài giảng:\n${args.context.trim().slice(0, 4000)}`
    : "";

  const schemaLines = {
    poll: `Schema JSON:
{
  "title": "<câu hỏi đầy đủ>",
  "options": ["<lựa chọn 1>", "<lựa chọn 2>", "<lựa chọn 3>", "<lựa chọn 4>"],
  "isQuiz": ${args.asQuiz},
  "correctOptionIndexes": [${args.asQuiz ? "<index 0-based của đáp án đúng>" : ""}],
  "reasoning": "<1 câu giải thích tại sao đáp án đúng + bẫy ở các nhiễu>"
}`,
    rating: `Schema JSON:
{
  "title": "<câu hỏi rating>",
  "ratingMin": 1,
  "ratingMax": 5,
  "ratingMinLabel": "<nhãn cho 1, vd: Hoàn toàn không hiểu>",
  "ratingMaxLabel": "<nhãn cho 5, vd: Hoàn toàn nắm rõ>",
  "reasoning": "<1 câu giải thích>"
}`,
    wordcloud: `Schema JSON:
{
  "title": "<câu hỏi yêu cầu SV trả lời 1-3 từ khoá>",
  "reasoning": "<1 câu giải thích>"
}`,
    opentext: `Schema JSON:
{
  "title": "<câu hỏi yêu cầu SV trả lời 1-2 câu ngắn>",
  "reasoning": "<1 câu giải thích>"
}`,
    board: `Schema JSON:
{
  "title": "<câu hỏi/chủ đề chính để SV đăng bài lên board>",
  "columns": [
    { "title": "<tên cột phân loại, vd 'Đã hiểu rõ'>", "description": "<1 câu mô tả ngắn ý nghĩa cột>" }
  ],
  "reasoning": "<1 câu giải thích lựa chọn cột>"
}`,
    qa: `Schema JSON:
{
  "title": "<chủ đề / gợi ý để SV đặt câu hỏi>",
  "reasoning": "<1 câu giải thích>"
}`,
  }[args.type];

  return `Bạn là trợ lý giảng viên đại học Việt Nam. Hãy sinh 1 hoạt động ${typeLine} cho buổi giảng.

Chủ đề / yêu cầu của GV: "${args.topic.trim()}"${focusLine}${contextLine}

YÊU CẦU:
- Tiếng Việt học thuật, ngắn gọn, rõ ràng.
- ${
    args.type === "poll" ? `Lựa chọn cụ thể, KHÔNG trùng nghĩa, KHÔNG quá dễ. Nhiễu (đáp án sai) phải hợp lý — dựa trên nhầm lẫn thường gặp của SV.${args.asQuiz ? " Đáp án đúng phải rõ ràng, không gây tranh cãi." : ""}` :
    args.type === "rating" ? "Câu hỏi đo cảm nhận / mức độ hiểu của SV về 1 khái niệm cụ thể." :
    args.type === "wordcloud" ? "Câu hỏi gợi mở để SV tự liên tưởng từ khoá liên quan đến nội dung." :
    args.type === "board" ? "Câu hỏi mở để SV đăng nhiều bài text/ảnh. Đề xuất 3-4 cột phân loại có nghĩa — KHÔNG dùng cột generic (vd 'Khác'); cột phải dẫn dắt SV phản hồi đa chiều (vd 'Ưu điểm', 'Hạn chế', 'Đề xuất cải tiến')." :
    args.type === "qa" ? "Gợi ý chủ đề cụ thể để SV biết hướng đặt câu hỏi (vd 'Hỏi về phần X bạn còn chưa rõ')." :
    "Câu hỏi yêu cầu SV giải thích / so sánh / vận dụng ngắn gọn."
  }
- Bám sát chủ đề + phạm vi đã chỉ định, KHÔNG mở rộng sang topic khác.

${schemaLines}

CHỈ trả JSON đúng schema, KHÔNG markdown fence, KHÔNG text thừa.`;
}

type AiResult = {
  title: string;
  options?: string[];
  isQuiz?: boolean;
  correctOptionIndexes?: number[];
  ratingMin?: number;
  ratingMax?: number;
  ratingMinLabel?: string;
  ratingMaxLabel?: string;
  columns?: Array<{ title: string; description?: string }>;
  reasoning?: string;
};

export function AiSingleActivityModal({
  sessionId,
  existingActivityCount,
  collectStudentCode,
  onClose,
}: {
  sessionId: Id<"sessions">;
  existingActivityCount: number;
  collectStudentCode: boolean;
  onClose: () => void;
}) {
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);
  const createActivity = useMutation(api.activities.createActivity);

  const [activityType, setActivityType] = useState<ActivityType>("poll");
  const [topic, setTopic] = useState("");
  const [focus, setFocus] = useState("");
  const [context, setContext] = useState("");
  const [asQuiz, setAsQuiz] = useState(true);
  const [timeLimitMin, setTimeLimitMin] = useState<number>(2);
  const [slideCue, setSlideCue] = useState("");
  const [requiresStudentCode, setRequiresStudentCode] = useState(false);

  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    if (typeof window === "undefined") return MODELS[0].id;
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved && MODELS.some((m) => m.id === saved)) return saved;
    } catch { /* ignore */ }
    return MODELS[0].id;
  });
  const selectedModel = MODELS.find((m) => m.id === selectedModelId) ?? MODELS[0];
  const currentProvider = selectedModel.provider;
  const currentKey = (dbKeys ?? {})[currentProvider] ?? "";
  const hasKey = !!currentKey;

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(MODEL_STORAGE_KEY, selectedModelId); } catch { /* ignore */ }
  }, [selectedModelId]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error("Hãy nhập chủ đề / yêu cầu trước");
      return;
    }
    if (!hasKey) {
      toast.error(`Chưa có API key ${PROVIDER_INFO[currentProvider].label}. Vào ⚙️ Cài đặt → 🔑 API key.`);
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const prompt = buildPrompt({
        type: activityType,
        topic,
        focus,
        context,
        asQuiz: activityType === "poll" && asQuiz,
      });
      const { data } = await callAiJson<AiResult>({
        provider: currentProvider,
        model: selectedModel.id,
        apiKey: currentKey,
        userPrompt: prompt,
        geminiSchema: geminiSchemaForType(activityType),
        systemPrompt: "Bạn là trợ lý giảng viên ĐH Việt Nam. CHỈ trả JSON đúng schema, KHÔNG markdown fence, KHÔNG text thừa.",
      });
      if (!data?.title?.trim()) {
        throw new Error("AI trả thiếu trường title");
      }
      setResult(data);
    } catch (e: unknown) {
      const err = e as AiClientError | Error;
      const msg = err instanceof AiClientError ? err.message : err.message || "Lỗi";
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!result?.title) return;
    try {
      let config: Record<string, unknown> = {};
      if (activityType === "poll") {
        const options = (result.options ?? []).filter((s) => !!s.trim());
        if (options.length < 2) {
          toast.error("AI trả về thiếu lựa chọn. Hãy gen lại.");
          return;
        }
        const optionObjs = options.map((text, i) => ({ id: `opt_${i}_${Math.random().toString(36).slice(2, 7)}`, text }));
        const correctIds = (result.correctOptionIndexes ?? []).map((i) => optionObjs[i]?.id).filter(Boolean);
        config = {
          options: optionObjs,
          pollType: "single_choice",
          isQuiz: !!result.isQuiz && correctIds.length > 0,
          correctOptionIds: correctIds,
        };
      } else if (activityType === "rating") {
        config = {
          min: result.ratingMin ?? 1,
          max: result.ratingMax ?? 5,
          minLabel: result.ratingMinLabel ?? "Hoàn toàn không",
          maxLabel: result.ratingMaxLabel ?? "Hoàn toàn có",
        };
      } else if (activityType === "wordcloud") {
        config = { maxLength: 30 };
      } else if (activityType === "opentext") {
        config = { maxLength: 500 };
      } else if (activityType === "board") {
        const cols = (result.columns ?? []).filter((c) => !!c.title?.trim());
        if (cols.length < 2) {
          toast.error("AI trả về thiếu cột. Hãy gen lại.");
          return;
        }
        config = {
          columns: cols.map((c, i) => ({
            id: `col_${i}_${Math.random().toString(36).slice(2, 6)}`,
            title: c.title.trim(),
            description: c.description?.trim() || undefined,
          })),
        };
      } else if (activityType === "qa") {
        config = { allowAnonymous: true };
      }
      await createActivity({
        sessionId,
        type: activityType,
        title: result.title.trim(),
        config,
        requiresStudentCode,
        timeLimit: timeLimitMin > 0 ? timeLimitMin : undefined,
        order: existingActivityCount + 1,
        slideCue: slideCue.trim() || undefined,
      });
      toast.success(`Đã thêm hoạt động "${result.title.slice(0, 40)}..."`);
      onClose();
    } catch (e: unknown) {
      const err = e as Error;
      toast.error(err.message || "Lỗi tạo hoạt động");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-6 flex flex-col max-h-[calc(100vh-3rem)]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-lg font-semibold">✨ Tạo nhanh 1 hoạt động</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Nêu chủ đề + phần cần tập trung. Review kết quả trước khi thêm vào kịch bản.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none shrink-0">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {/* Type picker */}
          <div>
            <label className="text-xs font-medium text-zinc-700 block mb-2">Loại hoạt động</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TYPE_INFO) as ActivityType[]).map((t) => {
                const info = TYPE_INFO[t];
                const active = activityType === t;
                return (
                  <button
                    key={t}
                    onClick={() => setActivityType(t)}
                    className={`text-left px-3 py-2 rounded-lg border transition-all ${
                      active
                        ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
                        : "border-zinc-200 bg-white hover:border-zinc-400"
                    }`}
                  >
                    <div className="text-sm font-medium">{info.icon} {info.label}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{info.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Topic */}
          <div>
            <label className="text-xs font-medium text-zinc-700 block mb-1">
              Chủ đề / yêu cầu chính <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="VD: Khái niệm dung tích chết của hồ chứa, công thức tính lưu lượng đỉnh..."
              className="w-full h-10 px-3 rounded-md border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>

          {/* Focus */}
          <div>
            <label className="text-xs font-medium text-zinc-700 block mb-1">
              Tập trung vào phần cụ thể <span className="text-zinc-400">(tuỳ chọn)</span>
            </label>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="VD: Chỉ phần phân loại hồ chứa theo mục đích, KHÔNG đề cập tính toán"
              className="w-full h-10 px-3 rounded-md border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Mô tả phần cụ thể trong bài giảng. Nội dung ngoài phạm vi này sẽ được bỏ qua.
            </p>
          </div>

          {/* Context */}
          <div>
            <label className="text-xs font-medium text-zinc-700 block mb-1">
              Ngữ cảnh bài giảng <span className="text-zinc-400">(tuỳ chọn, max 4000 ký tự)</span>
            </label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value.slice(0, 4000))}
              rows={3}
              placeholder="Paste 1-2 đoạn nội dung bài giảng để AI tham chiếu (định nghĩa, công thức...)"
              className="w-full px-3 py-2 rounded-md border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-y"
            />
            <div className="text-[11px] text-zinc-400 mt-0.5 text-right">{context.length}/4000</div>
          </div>

          {/* Quiz mode + time + slide */}
          <div className="grid grid-cols-2 gap-3">
            {activityType === "poll" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={asQuiz} onChange={(e) => setAsQuiz(e.target.checked)} />
                <span>Chế độ Quiz (có đáp án đúng)</span>
              </label>
            )}
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">Thời gian (phút)</label>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={timeLimitMin}
                onChange={(e) => setTimeLimitMin(Number(e.target.value) || 0)}
                className="w-full h-9 px-3 rounded-md border border-zinc-200 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">Mốc slide (tuỳ chọn)</label>
              <input
                type="text"
                value={slideCue}
                onChange={(e) => setSlideCue(e.target.value)}
                placeholder="Slide 7 / Sau slide 12"
                className="w-full h-9 px-3 rounded-md border border-zinc-200 text-sm"
              />
            </div>
            <label className="flex items-start gap-2 text-sm col-span-2">
              <input
                type="checkbox"
                checked={requiresStudentCode}
                onChange={(e) => setRequiresStudentCode(e.target.checked)}
                disabled={!collectStudentCode}
                className="mt-0.5"
              />
              <span className={collectStudentCode ? "" : "text-zinc-400"}>
                Ghi nhận điểm cho SV (cần buổi có thu mã SV)
              </span>
            </label>
          </div>

          {/* Model picker */}
          <div className="border-t border-zinc-100 pt-3">
            <label className="text-xs font-medium text-zinc-700 block mb-1">Model AI</label>
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              {PROVIDER_ORDER.map((p) => (
                <optgroup key={p} label={PROVIDER_INFO[p].label}>
                  {MODELS.filter((m) => m.provider === p).map((m) => (
                    <option key={m.id} value={m.id}>{m.label} — {m.hint}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[11px] text-zinc-500 mt-1">
              {hasKey ? (
                <>🔒 Gọi trực tiếp từ trình duyệt → <strong>{PROVIDER_INFO[currentProvider].label}</strong>, key không qua server.</>
              ) : (
                <span className="text-rose-700">⚠ Chưa có key. Vào ⚙️ Cài đặt → 🔑 API key.</span>
              )}
            </p>
          </div>

          {/* Result preview */}
          {result && (
            <div className="border-t border-zinc-200 pt-4 space-y-3 bg-emerald-50/40 -mx-6 px-6 py-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-emerald-900">✨ AI đã sinh:</div>
                <button onClick={handleGenerate} disabled={generating} className="text-xs underline text-emerald-700 hover:text-emerald-900">
                  🔄 Gen lại
                </button>
              </div>
              <div className="bg-white border border-zinc-200 rounded-lg p-3 space-y-2">
                <div className="font-medium text-sm">{result.title}</div>
                {activityType === "poll" && result.options && (
                  <ul className="text-sm space-y-1">
                    {result.options.map((opt, i) => {
                      const isCorrect = (result.correctOptionIndexes ?? []).includes(i);
                      return (
                        <li key={i} className={`pl-3 ${isCorrect ? "text-emerald-700 font-medium" : "text-zinc-700"}`}>
                          {isCorrect && "✓ "}{String.fromCharCode(65 + i)}. {opt}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {activityType === "rating" && (
                  <div className="text-xs text-zinc-600">
                    Thang {result.ratingMin ?? 1}-{result.ratingMax ?? 5}: {result.ratingMinLabel ?? "—"} → {result.ratingMaxLabel ?? "—"}
                  </div>
                )}
                {activityType === "board" && result.columns && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                    {result.columns.map((c, i) => (
                      <div key={i} className="text-xs bg-purple-50 border border-purple-200 rounded-lg px-2 py-1.5">
                        <div className="font-medium text-purple-900">📌 {c.title}</div>
                        {c.description && <div className="text-purple-700 text-[11px] mt-0.5">{c.description}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {result.reasoning && (
                  <div className="text-[11px] text-zinc-500 italic border-t border-zinc-100 pt-2 mt-2">
                    💡 {result.reasoning}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && !generating && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-zinc-500">
            Free tier OK. Mỗi gen ~2-8s tuỳ model.
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <button
                onClick={handleApply}
                className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                ✓ Thêm vào kịch bản
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating || !hasKey || !topic.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? "Đang sinh..." : result ? "🔄 Gen lại" : "✨ Sinh hoạt động"}
            </button>
            <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100">
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
