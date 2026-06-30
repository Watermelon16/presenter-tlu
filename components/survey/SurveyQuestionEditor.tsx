"use client";

// Trình sửa MỘT câu hỏi khảo sát (dùng trong SurveyBuilder).

import { VnInput } from "@/components/VnInput";
import { Input } from "@/components/ui/input";
import {
  type SurveyQuestion,
  type SurveyQuestionType,
  type SurveyOption,
  QUESTION_TYPE_META,
  newOption,
  isChoiceType,
} from "@/lib/survey";

interface Props {
  question: SurveyQuestion;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onChangeType: (type: SurveyQuestionType) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function SurveyQuestionEditor({
  question: q,
  index,
  canMoveUp,
  canMoveDown,
  onChange,
  onChangeType,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: Props) {
  const opts = q.options ?? [];

  const setOption = (i: number, text: string) => {
    const next = [...opts];
    next[i] = { ...next[i], text };
    onChange({ options: next });
  };
  const addOption = () => onChange({ options: [...opts, newOption("")] });
  const removeOption = (i: number) =>
    onChange({ options: opts.filter((_, idx) => idx !== i) });

  return (
    <div className="border border-zinc-200 rounded-xl bg-white">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 bg-zinc-50/70 rounded-t-xl flex-wrap">
        <span className="font-mono text-xs text-zinc-400 w-6 text-center shrink-0">{index}</span>
        <select
          value={q.type}
          onChange={(e) => onChangeType(e.target.value as SurveyQuestionType)}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300"
        >
          {QUESTION_TYPE_META.map((m) => (
            <option key={m.type} value={m.type}>
              {m.icon} {m.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-zinc-600 ml-1">
          <input
            type="checkbox"
            checked={!!q.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Bắt buộc
        </label>
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn title="Lên" disabled={!canMoveUp} onClick={onMoveUp}>↑</IconBtn>
          <IconBtn title="Xuống" disabled={!canMoveDown} onClick={onMoveDown}>↓</IconBtn>
          <IconBtn title="Nhân bản" onClick={onDuplicate}>⧉</IconBtn>
          <IconBtn title="Xoá" onClick={onDelete} danger>✕</IconBtn>
        </div>
      </div>

      {/* body */}
      <div className="p-3 space-y-2.5">
        <VnInput
          value={q.title}
          onValueChange={(v) => onChange({ title: v })}
          placeholder="Nội dung câu hỏi…"
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm font-medium focus:outline-none focus:border-violet-500"
        />
        <VnInput
          value={q.description ?? ""}
          onValueChange={(v) => onChange({ description: v })}
          placeholder="Mô tả / hướng dẫn (tuỳ chọn)"
          className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-xs text-zinc-600 focus:outline-none focus:border-violet-400"
        />

        {/* choice */}
        {isChoiceType(q.type) && (
          <div className="space-y-1.5 pt-1">
            {opts.map((o: SurveyOption, i) => (
              <div key={o.id} className="flex items-center gap-2">
                <span className="text-zinc-400 text-xs w-5 text-right shrink-0">
                  {q.type === "multiple" ? "☐" : q.type === "dropdown" ? "▾" : "○"}
                </span>
                <VnInput
                  value={o.text}
                  onValueChange={(v) => setOption(i, v)}
                  placeholder={`Lựa chọn ${i + 1}`}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-violet-400"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  disabled={opts.length <= 1}
                  className="text-zinc-400 hover:text-red-600 disabled:opacity-30 shrink-0 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-4 pt-0.5">
              <button type="button" onClick={addOption} className="text-xs text-violet-700 hover:text-violet-900 font-medium">
                + Thêm lựa chọn
              </button>
              <label className="flex items-center gap-1 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={!!q.allowOther}
                  onChange={(e) => onChange({ allowOther: e.target.checked })}
                />
                Cho phép “Khác…”
              </label>
            </div>
            {q.type === "multiple" && (
              <div className="flex items-center gap-3 pt-1 text-xs text-zinc-600">
                <label className="flex items-center gap-1">
                  Chọn tối thiểu
                  <Input
                    type="number"
                    min={0}
                    value={q.minSelections ?? 0}
                    onChange={(e) => onChange({ minSelections: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-16 h-7 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Tối đa (0 = ∞)
                  <Input
                    type="number"
                    min={0}
                    value={q.maxSelections ?? 0}
                    onChange={(e) => onChange({ maxSelections: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-16 h-7 text-xs"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* likert */}
        {q.type === "likert" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <NumField label="Từ" value={q.scaleMin ?? 1} min={0} onChange={(v) => onChange({ scaleMin: v })} />
            <NumField label="Đến" value={q.scaleMax ?? 5} min={2} onChange={(v) => onChange({ scaleMax: v })} />
            <LblField label="Nhãn đầu" value={q.minLabel ?? ""} onChange={(v) => onChange({ minLabel: v })} placeholder="Rất không đồng ý" />
            <LblField label="Nhãn cuối" value={q.maxLabel ?? ""} onChange={(v) => onChange({ maxLabel: v })} placeholder="Rất đồng ý" />
          </div>
        )}

        {/* rating */}
        {q.type === "rating" && (
          <div className="pt-1">
            <NumField label="Số sao tối đa" value={q.scaleMax ?? 5} min={3} max={10} onChange={(v) => onChange({ scaleMax: v })} />
          </div>
        )}

        {/* nps */}
        {q.type === "nps" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <LblField label="Nhãn 0" value={q.minLabel ?? ""} onChange={(v) => onChange({ minLabel: v })} placeholder="Không bao giờ" />
            <LblField label="Nhãn 10" value={q.maxLabel ?? ""} onChange={(v) => onChange({ maxLabel: v })} placeholder="Chắc chắn" />
            <p className="col-span-2 text-[11px] text-zinc-400">Thang cố định 0–10 (đo mức sẵn sàng giới thiệu).</p>
          </div>
        )}

        {/* text */}
        {(q.type === "short_text" || q.type === "long_text" || q.type === "wordcloud") && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <LblField
              label="Gợi ý nhập"
              value={q.placeholder ?? ""}
              onChange={(v) => onChange({ placeholder: v })}
              placeholder={q.type === "wordcloud" ? "Một từ ngắn…" : "Nhập câu trả lời…"}
            />
            <NumField
              label="Độ dài tối đa"
              value={q.maxLength ?? (q.type === "long_text" ? 500 : q.type === "wordcloud" ? 30 : 120)}
              min={5}
              max={2000}
              onChange={(v) => onChange({ maxLength: v })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  children, title, onClick, disabled, danger,
}: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-7 h-7 grid place-items-center rounded-md text-sm disabled:opacity-25 ${
        danger ? "text-zinc-400 hover:text-red-600 hover:bg-red-50" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function NumField({
  label, value, onChange, min, max,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-600">
      <span className="shrink-0">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8 text-sm"
      />
    </label>
  );
}

function LblField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-600">
      <span>{label}</span>
      <VnInput
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        className="h-8 px-2.5 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-violet-400"
      />
    </label>
  );
}
