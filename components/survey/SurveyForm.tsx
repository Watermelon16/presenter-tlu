"use client";

// Biểu mẫu khảo sát phía SINH VIÊN — tất cả câu hỏi trên 1 trang, điền & gửi 1 lần.
// Thân thiện, dễ nhìn, mobile-first (SV trả lời trên điện thoại).

import { useMemo, useRef, useState } from "react";
import { VnInput, VnTextarea } from "@/components/VnInput";
import {
  type SurveyConfig,
  type SurveyQuestion,
  type SurveyAnswer,
  type ChoiceAnswer,
  type ScaleAnswer,
  type TextAnswer,
  isChoiceType,
  isScaleType,
  flattenQuestions,
  scaleRange,
  answerIsEmpty,
  validateSurveyAnswers,
} from "@/lib/survey";

type Answers = Record<string, SurveyAnswer>;

interface Props {
  config: SurveyConfig;
  initialAnswers?: Answers;
  readOnly?: boolean;
  disabled?: boolean; // hết giờ
  submitting?: boolean;
  onSubmit?: (answers: Answers) => void;
}

export function SurveyForm({
  config,
  initialAnswers,
  readOnly = false,
  disabled = false,
  submitting = false,
  onSubmit,
}: Props) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const allQuestions = useMemo(() => flattenQuestions(config), [config]);
  const answeredCount = useMemo(
    () => allQuestions.filter((q) => !answerIsEmpty(q, answers[q.id])).length,
    [allQuestions, answers]
  );
  const progress = allQuestions.length > 0 ? Math.round((answeredCount / allQuestions.length) * 100) : 0;

  const setAnswer = (qid: string, a: SurveyAnswer) => {
    setAnswers((prev) => ({ ...prev, [qid]: a }));
    setErrors((prev) => (prev[qid] ? { ...prev, [qid]: "" } : prev));
  };

  const handleSubmit = () => {
    if (readOnly || disabled || submitting) return;
    const errs = validateSurveyAnswers(config, answers);
    if (errs.length > 0) {
      const map: Record<string, string> = {};
      errs.forEach((e) => (map[e.questionId] = e.message));
      setErrors(map);
      // cuộn tới câu lỗi đầu tiên
      const el = containerRef.current?.querySelector(`[data-qid="${errs[0].questionId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    onSubmit?.(answers);
  };

  return (
    <div ref={containerRef} className="space-y-5">
      {config.intro?.trim() && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl px-5 py-4 text-sm text-violet-900 whitespace-pre-wrap">
          {config.intro.trim()}
        </div>
      )}

      {!readOnly && allQuestions.length > 3 && (
        <div className="sticky top-2 z-10">
          <div className="bg-white/90 backdrop-blur border border-zinc-200 rounded-full px-4 py-2 flex items-center gap-3 shadow-sm">
            <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-medium text-zinc-600 tabular-nums shrink-0">
              {answeredCount}/{allQuestions.length}
            </span>
          </div>
        </div>
      )}

      {config.sections.map((section, sIdx) => {
        const offset = config.sections
          .slice(0, sIdx)
          .reduce((n, s) => n + (s.questions?.length ?? 0), 0);
        return (
          <div key={section.id} className="space-y-4">
            {(section.title?.trim() || section.description?.trim()) && (
              <div className="pt-1">
                {section.title?.trim() && (
                  <h3 className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
                    <span className="text-emerald-600">{sIdx + 1}.</span>
                    {section.title.trim()}
                  </h3>
                )}
                {section.description?.trim() && (
                  <p className="text-sm text-zinc-500 mt-0.5 whitespace-pre-wrap">{section.description.trim()}</p>
                )}
              </div>
            )}
            {section.questions.map((q, qi) => (
              <QuestionCard
                key={q.id}
                index={offset + qi + 1}
                question={q}
                answer={answers[q.id]}
                error={errors[q.id]}
                readOnly={readOnly}
                onChange={(a) => setAnswer(q.id, a)}
              />
            ))}
          </div>
        );
      })}

      {!readOnly && (
        <div className="pt-2">
          <button
            onClick={handleSubmit}
            disabled={disabled || submitting}
            className="w-full py-4 rounded-2xl bg-zinc-900 text-white text-lg font-medium disabled:opacity-50 active:bg-black transition-colors"
          >
            {submitting ? "Đang gửi…" : disabled ? "Đã hết giờ" : "Gửi khảo sát"}
          </button>
          {Object.values(errors).some(Boolean) && (
            <p className="text-sm text-red-600 text-center mt-2">
              Còn câu chưa hợp lệ — kiểm tra phần được tô đỏ phía trên.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// =========================================================================
function QuestionCard({
  index,
  question: q,
  answer,
  error,
  readOnly,
  onChange,
}: {
  index: number;
  question: SurveyQuestion;
  answer: SurveyAnswer | undefined;
  error?: string;
  readOnly: boolean;
  onChange: (a: SurveyAnswer) => void;
}) {
  return (
    <div
      data-qid={q.id}
      className={`bg-white border rounded-3xl p-5 shadow-sm transition-colors ${
        error ? "border-red-300 ring-2 ring-red-100" : "border-zinc-200"
      }`}
    >
      <div className="mb-3">
        <p className="text-base font-medium text-zinc-900">
          <span className="text-zinc-400 mr-1.5 tabular-nums">{index}.</span>
          {q.title || <span className="text-zinc-400 italic">（câu hỏi chưa có nội dung）</span>}
          {q.required && <span className="text-red-500 ml-1">*</span>}
        </p>
        {q.description?.trim() && (
          <p className="text-sm text-zinc-500 mt-1 whitespace-pre-wrap">{q.description.trim()}</p>
        )}
      </div>

      <QuestionInput question={q} answer={answer} readOnly={readOnly} onChange={onChange} />

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}

// =========================================================================
function QuestionInput({
  question: q,
  answer,
  readOnly,
  onChange,
}: {
  question: SurveyQuestion;
  answer: SurveyAnswer | undefined;
  readOnly: boolean;
  onChange: (a: SurveyAnswer) => void;
}) {
  if (isChoiceType(q.type)) {
    return <ChoiceInput question={q} answer={answer as ChoiceAnswer} readOnly={readOnly} onChange={onChange} />;
  }
  if (isScaleType(q.type)) {
    return <ScaleInput question={q} answer={answer as ScaleAnswer} readOnly={readOnly} onChange={onChange} />;
  }
  return <TextInput question={q} answer={answer as TextAnswer} readOnly={readOnly} onChange={onChange} />;
}

// ---- Choice: single / multiple / dropdown -------------------------------
function ChoiceInput({
  question: q,
  answer,
  readOnly,
  onChange,
}: {
  question: SurveyQuestion;
  answer: ChoiceAnswer | undefined;
  readOnly: boolean;
  onChange: (a: ChoiceAnswer) => void;
}) {
  const opts = q.options ?? [];
  const selected = answer?.choiceIds ?? [];
  const otherText = answer?.otherText ?? "";
  const otherActive = q.allowOther && (otherText.length > 0 || selected.includes("__other__"));

  const commit = (choiceIds: string[], nextOther?: string) => {
    onChange({ choiceIds: choiceIds.filter((id) => id !== "__other__"), otherText: nextOther ?? otherText });
  };

  const toggle = (id: string) => {
    if (readOnly) return;
    if (q.type === "multiple") {
      const set = new Set(selected);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      commit(Array.from(set));
    } else {
      commit([id], ""); // single: chọn 1 option → xoá "Khác"
    }
  };

  const toggleOther = () => {
    if (readOnly) return;
    if (q.type === "multiple") {
      // giữ các lựa chọn, bật/tắt ô khác
      commit(selected, otherActive ? "" : otherText || " ");
    } else {
      commit([], otherText || " ");
    }
  };

  // Dropdown → native select (chọn từ danh sách có sẵn, gọn & chính xác trên mobile)
  if (q.type === "dropdown") {
    const cur = selected[0] ?? "";
    return (
      <select
        disabled={readOnly}
        value={cur}
        onChange={(e) => commit(e.target.value ? [e.target.value] : [])}
        className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base bg-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
      >
        <option value="">— Chọn —</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.text}
          </option>
        ))}
      </select>
    );
  }

  const isMulti = q.type === "multiple";
  return (
    <div className="space-y-2.5">
      {opts.map((o) => {
        const isSel = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            disabled={readOnly}
            onClick={() => toggle(o.id)}
            className={`w-full text-left px-4 py-3.5 rounded-2xl border flex items-center gap-3 transition-all disabled:cursor-default ${
              isSel
                ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                : "border-zinc-200 hover:border-zinc-300 active:bg-zinc-50"
            }`}
          >
            <span
              className={`shrink-0 w-5 h-5 grid place-items-center border-2 ${
                isMulti ? "rounded-md" : "rounded-full"
              } ${isSel ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300"}`}
            >
              {isSel && <span className="text-xs leading-none">{isMulti ? "✓" : "●"}</span>}
            </span>
            <span className="text-base">{o.text}</span>
          </button>
        );
      })}

      {q.allowOther && (
        <div
          className={`rounded-2xl border transition-all ${
            otherActive ? "border-emerald-500 bg-emerald-50" : "border-zinc-200"
          }`}
        >
          <button
            type="button"
            disabled={readOnly}
            onClick={toggleOther}
            className="w-full text-left px-4 py-3 flex items-center gap-3"
          >
            <span
              className={`shrink-0 w-5 h-5 grid place-items-center border-2 ${
                isMulti ? "rounded-md" : "rounded-full"
              } ${otherActive ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300"}`}
            >
              {otherActive && <span className="text-xs leading-none">{isMulti ? "✓" : "●"}</span>}
            </span>
            <span className="text-base text-zinc-700">Khác…</span>
          </button>
          {otherActive && (
            <div className="px-4 pb-3">
              <VnInput
                value={otherText.trim() === "" ? "" : otherText}
                onValueChange={(v) => commit(isMulti ? selected : [], v)}
                placeholder="Ghi rõ…"
                disabled={readOnly}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-base focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Scale: likert / rating / nps ---------------------------------------
function ScaleInput({
  question: q,
  answer,
  readOnly,
  onChange,
}: {
  question: SurveyQuestion;
  answer: ScaleAnswer | undefined;
  readOnly: boolean;
  onChange: (a: ScaleAnswer) => void;
}) {
  const { min, max } = scaleRange(q);
  const cur = typeof answer?.value === "number" ? answer.value : null;
  const set = (v: number) => !readOnly && onChange({ value: v });

  // Rating → sao
  if (q.type === "rating") {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            type="button"
            disabled={readOnly}
            onClick={() => set(v)}
            className={`text-3xl leading-none transition-transform active:scale-95 ${
              cur != null && v <= cur ? "text-amber-400" : "text-zinc-300"
            }`}
            aria-label={`${v} sao`}
          >
            ★
          </button>
        ))}
        {cur != null && <span className="ml-2 text-sm text-zinc-500">{cur}/{max}</span>}
      </div>
    );
  }

  const points = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const isNps = q.type === "nps";
  return (
    <div className="space-y-2">
      <div className={`grid gap-1.5 ${isNps ? "grid-cols-6 sm:grid-cols-11" : ""}`}
        style={isNps ? undefined : { gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((v) => {
          const sel = cur === v;
          const tone = isNps
            ? v >= 9
              ? "promoter"
              : v <= 6
                ? "detractor"
                : "passive"
            : "neutral";
          const selClass = sel
            ? tone === "promoter"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : tone === "detractor"
                ? "border-rose-500 bg-rose-500 text-white"
                : "border-emerald-500 bg-emerald-500 text-white"
            : "border-zinc-200 text-zinc-700 hover:border-zinc-300 active:bg-zinc-50";
          return (
            <button
              key={v}
              type="button"
              disabled={readOnly}
              onClick={() => set(v)}
              className={`h-11 rounded-xl border text-sm font-medium grid place-items-center transition-all disabled:cursor-default ${selClass}`}
            >
              <span className="flex flex-col items-center leading-none">
                <span>{v}</span>
                {q.pointLabels?.[String(v)] && (
                  <span className="text-[9px] font-normal opacity-80 mt-0.5 line-clamp-1">
                    {q.pointLabels[String(v)]}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {(q.minLabel || q.maxLabel) && (
        <div className="flex justify-between text-xs text-zinc-500 px-1">
          <span>{q.minLabel}</span>
          <span>{q.maxLabel}</span>
        </div>
      )}
    </div>
  );
}

// ---- Text: short / long / wordcloud -------------------------------------
function TextInput({
  question: q,
  answer,
  readOnly,
  onChange,
}: {
  question: SurveyQuestion;
  answer: TextAnswer | undefined;
  readOnly: boolean;
  onChange: (a: TextAnswer) => void;
}) {
  const text = answer?.text ?? "";
  const maxLength = q.maxLength ?? (q.type === "long_text" ? 500 : q.type === "wordcloud" ? 30 : 120);

  if (q.type === "long_text") {
    return (
      <div>
        <VnTextarea
          value={text}
          onValueChange={(v) => onChange({ text: v.slice(0, maxLength) })}
          placeholder={q.placeholder || "Nhập câu trả lời…"}
          rows={4}
          maxLength={maxLength}
          disabled={readOnly}
          className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 resize-y disabled:opacity-60"
        />
        <div className="text-right text-xs text-zinc-400 mt-1">
          {text.length} / {maxLength}
        </div>
      </div>
    );
  }

  return (
    <VnInput
      value={text}
      onValueChange={(v) => onChange({ text: v.slice(0, maxLength) })}
      placeholder={q.placeholder || (q.type === "wordcloud" ? "Một từ / cụm ngắn…" : "Nhập câu trả lời…")}
      maxLength={maxLength}
      disabled={readOnly}
      className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 disabled:opacity-60"
    />
  );
}
