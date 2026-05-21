"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

const MODEL_STORAGE_KEY = "ai_gen_model_v1";
const KEY_STORAGE_PREFIX = "ai_gen_apikey_";

type Provider = "gemini" | "deepseek" | "openrouter";

const MODELS: { id: string; provider: Provider; label: string }[] = [
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash (server key)" },
  { id: "gemini-2.5-flash-lite", provider: "gemini", label: "Gemini 2.5 Flash Lite" },
  { id: "deepseek-chat", provider: "deepseek", label: "DeepSeek Chat" },
  { id: "deepseek/deepseek-v4-flash:free", provider: "openrouter", label: "OpenRouter · DeepSeek V4 Flash (free)" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", provider: "openrouter", label: "OpenRouter · Llama 3.3 70B (free)" },
];

function loadSavedKey(provider: Provider): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(KEY_STORAGE_PREFIX + provider) || "";
  } catch {
    return "";
  }
}

type Grade = "correct" | "partial" | "wrong";

const GRADE_LABEL: Record<Grade, string> = {
  correct: "Đúng",
  partial: "1 phần",
  wrong: "Sai",
};
const GRADE_CLASS: Record<Grade, string> = {
  correct: "bg-emerald-100 border-emerald-300 text-emerald-800",
  partial: "bg-amber-100 border-amber-300 text-amber-800",
  wrong: "bg-red-100 border-red-300 text-red-800",
};

interface Props {
  activityId: Id<"activities">;
  onClose: () => void;
}

export function OpentextGradingModal({ activityId, onClose }: Props) {
  const data = useQuery(api.gradingData.listOpentextResponsesForGrading, { activityId });
  const gradeAction = useAction(api.grading.gradeOpentextResponses);
  const overrideGrade = useMutation(api.gradingData.overrideResponseGrade);

  const [grading, setGrading] = useState(false);
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
  const needsKey = currentProvider !== "gemini" && !currentKey;

  if (data === undefined) {
    return (
      <Backdrop onClose={onClose}>
        <div className="bg-white rounded-2xl p-10 text-center text-zinc-600">Đang tải...</div>
      </Backdrop>
    );
  }
  if (data === null) {
    return (
      <Backdrop onClose={onClose}>
        <div className="bg-white rounded-2xl p-10 text-center text-zinc-600">
          Activity không phải opentext.
          <div className="mt-4">
            <Button onClick={onClose}>Đóng</Button>
          </div>
        </div>
      </Backdrop>
    );
  }

  const cfg = data.activity.config as { referenceAnswer?: string } | undefined;
  const reference = cfg?.referenceAnswer?.trim() ?? "";
  const hasReference = reference.length > 0;
  const responses = data.responses;

  const handleGradeAll = async () => {
    if (!hasReference) {
      toast.error("Activity chưa có đáp án mẫu. Sửa activity để thêm.");
      return;
    }
    setGrading(true);
    try {
      const result = await gradeAction({
        activityId,
        provider: currentProvider,
        model: selectedModel,
        apiKey: currentKey || undefined,
      });
      toast.success(
        `Đã chấm ${result.graded} câu (${result.modelUsed})${result.skipped > 0 ? `, bỏ qua ${result.skipped}` : ""}`
      );
    } catch (e: unknown) {
      let msg = "Lỗi khi gọi AI";
      if (e instanceof ConvexError) {
        const d = e.data as { message?: string } | undefined;
        if (d?.message) msg = d.message;
      } else if (e instanceof Error) {
        msg = e.message;
      }
      toast.error(msg, { duration: 10000 });
    } finally {
      setGrading(false);
    }
  };

  const handleOverride = async (responseId: Id<"responses">, grade: Grade | "clear") => {
    try {
      await overrideGrade({ responseId, grade });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Lỗi";
      toast.error(msg);
    }
  };

  const counts = {
    correct: responses.filter((r) => r.aiGrade === "correct").length,
    partial: responses.filter((r) => r.aiGrade === "partial").length,
    wrong: responses.filter((r) => r.aiGrade === "wrong").length,
    ungraded: responses.filter((r) => !r.aiGrade).length,
    manual: responses.filter((r) => r.manualGrade).length,
  };

  return (
    <Backdrop onClose={() => !grading && onClose()}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6 flex flex-col max-h-[calc(100vh-4rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">🤖 Chấm tự động: {data.activity.title}</h2>
            <p className="text-xs text-zinc-500">
              {responses.length} câu trả lời ·{" "}
              <span className="text-emerald-700">{counts.correct} đúng</span>,{" "}
              <span className="text-amber-700">{counts.partial} 1 phần</span>,{" "}
              <span className="text-red-700">{counts.wrong} sai</span>,{" "}
              <span className="text-zinc-500">{counts.ungraded} chưa chấm</span>
              {counts.manual > 0 && <span> · {counts.manual} GV chỉnh tay</span>}
            </p>
          </div>
          <button onClick={onClose} disabled={grading} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30">
            ✕
          </button>
        </div>

        {/* Reference + model + button */}
        <div className="px-6 py-3 border-b border-zinc-100 bg-zinc-50 space-y-2">
          {hasReference ? (
            <div className="text-xs">
              <span className="font-medium text-zinc-700">Đáp án mẫu: </span>
              <span className="text-zinc-600">{reference}</span>
            </div>
          ) : (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠ Chưa có đáp án mẫu. Đóng modal, sửa activity, thêm field &ldquo;Đáp án mẫu&rdquo; rồi quay lại.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                try {
                  localStorage.setItem(MODEL_STORAGE_KEY, e.target.value);
                } catch {}
              }}
              className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300 flex-1 min-w-[200px]"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <Button onClick={handleGradeAll} disabled={!hasReference || grading || needsKey}>
              {grading ? "Đang chấm..." : "🤖 Chấm AI tất cả"}
            </Button>
          </div>
          {needsKey && (
            <div className="text-[11px] text-amber-700">
              ⚠ Provider {currentProvider} cần API key — nhập trong modal &ldquo;🤖 AI gen&rdquo; trước.
            </div>
          )}
        </div>

        {/* Responses list */}
        <div className="overflow-y-auto flex-1">
          {responses.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">
              Chưa có câu trả lời nào để chấm.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {responses.map((r, idx) => (
                <li key={r._id} className="px-6 py-3">
                  <div className="flex items-start gap-3">
                    <div className="text-xs text-zinc-400 font-mono pt-0.5 w-6 shrink-0">#{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-800 whitespace-pre-wrap">{r.value}</div>
                      {r.studentCode && (
                        <div className="text-[10px] text-zinc-400 mt-0.5">SV: {r.studentCode}</div>
                      )}
                      {r.aiGradeReason && (
                        <div className="text-[11px] text-zinc-500 mt-1 italic border-l-2 border-zinc-200 pl-2">
                          {r.manualGrade ? "✋" : "🤖"} {r.aiGradeReason}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0 items-end">
                      {(["correct", "partial", "wrong"] as Grade[]).map((g) => {
                        const isActive = r.aiGrade === g;
                        return (
                          <button
                            key={g}
                            onClick={() => handleOverride(r._id, g)}
                            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                              isActive ? GRADE_CLASS[g] + " font-bold" : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                            }`}
                            title={r.manualGrade && isActive ? "GV đã chỉnh tay" : `Đánh dấu ${GRADE_LABEL[g]}`}
                          >
                            {GRADE_LABEL[g]}
                          </button>
                        );
                      })}
                      {r.aiGrade && (
                        <button
                          onClick={() => handleOverride(r._id, "clear")}
                          className="text-[10px] text-zinc-400 hover:text-zinc-700 mt-0.5"
                        >
                          Xoá grade
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex justify-between items-center text-xs text-zinc-500">
          <div>
            Điểm: <strong className="text-emerald-700">Đúng = 1×</strong>, Partial = 0.5×, Sai = 0×.
            GV có thể bấm đè AI bất cứ lúc nào.
          </div>
          <Button variant="outline" onClick={onClose} disabled={grading}>
            Đóng
          </Button>
        </div>
      </div>
    </Backdrop>
  );
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      {children}
    </div>
  );
}
