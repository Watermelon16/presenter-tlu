// ============================================================================
// Mô hình KHẢO SÁT (biểu mẫu gộp) — dùng chung cho builder (GV), form trả lời (SV),
// trang kết quả, phân tích AI và export Excel/PDF.
//
// Một activity type="survey" lưu:
//   - config: SurveyConfig  (các mục + câu hỏi đa dạng)
//   - mỗi response.value: SurveyResponseValue = { answers: { [questionId]: SurveyAnswer } }
//
// Không cần migration: activities.config / responses.value đều là v.any().
// ============================================================================

// ---- Loại câu hỏi ----------------------------------------------------------
export type SurveyQuestionType =
  | "single"      // Chọn 1 (radio)
  | "multiple"    // Chọn nhiều (checkbox)
  | "dropdown"    // Chọn 1 từ danh sách có sẵn (select) — hạn chế nhập sai/loãng
  | "likert"      // Thang đo có nhãn (rất không đồng ý → rất đồng ý)
  | "rating"      // Đánh giá sao ★
  | "nps"         // Mức độ sẵn sàng giới thiệu 0–10 (NPS)
  | "short_text"  // Trả lời ngắn (1 dòng)
  | "long_text"   // Đoạn văn (textarea)
  | "wordcloud";  // Từ khoá (gộp thành word cloud khi tổng hợp)

export type SurveyOption = { id: string; text: string };

export type SurveyQuestion = {
  id: string;
  type: SurveyQuestionType;
  title: string;
  description?: string;
  required?: boolean;

  // --- choice: single | multiple | dropdown ---
  options?: SurveyOption[];
  allowOther?: boolean;     // thêm lựa chọn "Khác (ghi rõ)…"
  minSelections?: number;   // multiple: số lựa chọn tối thiểu
  maxSelections?: number;   // multiple: số lựa chọn tối đa (0/undefined = không giới hạn)

  // --- scale: likert | rating | nps ---
  // likert: scaleMin..scaleMax (mặc định 1..5). rating: số sao = scaleMax (mặc định 5).
  // nps: cố định 0..10 (bỏ qua scaleMin/Max).
  scaleMin?: number;
  scaleMax?: number;
  minLabel?: string;        // nhãn đầu thang
  maxLabel?: string;        // nhãn cuối thang
  pointLabels?: Record<string, string>; // nhãn riêng từng mức (vd {"1":"Kém"})

  // --- text: short_text | long_text | wordcloud ---
  maxLength?: number;
  placeholder?: string;
};

export type SurveySection = {
  id: string;
  title?: string;
  description?: string;
  questions: SurveyQuestion[];
};

export type SurveyConfig = {
  intro?: string;                 // lời dẫn đầu biểu mẫu
  sections: SurveySection[];
  shuffleQuestions?: boolean;     // xáo trộn thứ tự câu trong từng mục (chống mồi)
};

// ---- Giá trị trả lời -------------------------------------------------------
export type ChoiceAnswer = { choiceIds: string[]; otherText?: string };
export type ScaleAnswer = { value: number };
export type TextAnswer = { text: string };
export type SurveyAnswer = ChoiceAnswer | ScaleAnswer | TextAnswer;

export type SurveyResponseValue = { answers: Record<string, SurveyAnswer> };

// ---- Phân loại nhanh -------------------------------------------------------
export const CHOICE_TYPES: SurveyQuestionType[] = ["single", "multiple", "dropdown"];
export const SCALE_TYPES: SurveyQuestionType[] = ["likert", "rating", "nps"];
export const TEXT_TYPES: SurveyQuestionType[] = ["short_text", "long_text", "wordcloud"];

export function isChoiceType(t: SurveyQuestionType): boolean {
  return CHOICE_TYPES.includes(t);
}
export function isScaleType(t: SurveyQuestionType): boolean {
  return SCALE_TYPES.includes(t);
}
export function isTextType(t: SurveyQuestionType): boolean {
  return TEXT_TYPES.includes(t);
}

// ---- Metadata cho palette builder ------------------------------------------
export type QuestionTypeMeta = {
  type: SurveyQuestionType;
  label: string;
  icon: string;
  hint: string;
  group: "Trắc nghiệm" | "Thang đo" | "Tự luận";
};

export const QUESTION_TYPE_META: QuestionTypeMeta[] = [
  { type: "single", label: "Chọn 1", icon: "◉", hint: "Một đáp án (radio)", group: "Trắc nghiệm" },
  { type: "multiple", label: "Chọn nhiều", icon: "☑", hint: "Nhiều đáp án (checkbox)", group: "Trắc nghiệm" },
  { type: "dropdown", label: "Danh sách", icon: "▾", hint: "Chọn từ danh sách có sẵn — hạn chế nhập sai", group: "Trắc nghiệm" },
  { type: "likert", label: "Likert", icon: "↔", hint: "Thang đo có nhãn (đồng ý / không đồng ý)", group: "Thang đo" },
  { type: "rating", label: "Sao", icon: "★", hint: "Đánh giá bằng sao", group: "Thang đo" },
  { type: "nps", label: "NPS 0–10", icon: "％", hint: "Mức độ sẵn sàng giới thiệu", group: "Thang đo" },
  { type: "short_text", label: "Trả lời ngắn", icon: "—", hint: "1 dòng", group: "Tự luận" },
  { type: "long_text", label: "Đoạn văn", icon: "¶", hint: "Trả lời dài (textarea)", group: "Tự luận" },
  { type: "wordcloud", label: "Từ khoá", icon: "✶", hint: "Từ/cụm ngắn → gộp thành word cloud", group: "Tự luận" },
];

export function questionTypeLabel(t: SurveyQuestionType): string {
  return QUESTION_TYPE_META.find((m) => m.type === t)?.label ?? t;
}
export function questionTypeIcon(t: SurveyQuestionType): string {
  return QUESTION_TYPE_META.find((m) => m.type === t)?.icon ?? "•";
}

// ---- Tạo id (chạy trên client/component — Date/Math cho phép) ---------------
let _seq = 0;
export function newId(prefix: string): string {
  _seq = (_seq + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}${_seq}`;
}

// ---- Defaults --------------------------------------------------------------
export function newOption(text = ""): SurveyOption {
  return { id: newId("o"), text };
}

export function newQuestion(type: SurveyQuestionType, title = ""): SurveyQuestion {
  const base: SurveyQuestion = { id: newId("q"), type, title, required: false };
  if (isChoiceType(type)) {
    base.options = [newOption("Lựa chọn 1"), newOption("Lựa chọn 2"), newOption("Lựa chọn 3")];
    if (type === "multiple") base.minSelections = 0;
  } else if (type === "likert") {
    base.scaleMin = 1;
    base.scaleMax = 5;
    base.minLabel = "Rất không đồng ý";
    base.maxLabel = "Rất đồng ý";
  } else if (type === "rating") {
    base.scaleMax = 5;
  } else if (type === "nps") {
    base.minLabel = "Không bao giờ";
    base.maxLabel = "Chắc chắn";
  } else if (type === "short_text") {
    base.maxLength = 120;
  } else if (type === "long_text") {
    base.maxLength = 500;
  } else if (type === "wordcloud") {
    base.maxLength = 30;
  }
  return base;
}

export function newSection(title = ""): SurveySection {
  return { id: newId("s"), title, questions: [] };
}

export function defaultSurveyConfig(): SurveyConfig {
  return {
    intro: "",
    sections: [{ ...newSection(""), questions: [newQuestion("likert", "")] }],
  };
}

// ---- Truy cập ----------------------------------------------------------------
export function flattenQuestions(config: SurveyConfig | undefined | null): SurveyQuestion[] {
  if (!config?.sections) return [];
  return config.sections.flatMap((s) => s.questions ?? []);
}

export function countQuestions(config: SurveyConfig | undefined | null): number {
  return flattenQuestions(config).length;
}

// Scale [min..max] cho 1 câu (xử lý mặc định + NPS cố định 0..10).
export function scaleRange(q: SurveyQuestion): { min: number; max: number } {
  if (q.type === "nps") return { min: 0, max: 10 };
  if (q.type === "rating") return { min: 1, max: Math.max(2, q.scaleMax ?? 5) };
  return { min: q.scaleMin ?? 1, max: Math.max((q.scaleMin ?? 1) + 1, q.scaleMax ?? 5) };
}

// ---- Validation (client trước khi submit) ----------------------------------
export function answerIsEmpty(q: SurveyQuestion, a: SurveyAnswer | undefined): boolean {
  if (!a) return true;
  if (isChoiceType(q.type)) {
    const c = a as ChoiceAnswer;
    const hasChoice = (c.choiceIds?.length ?? 0) > 0;
    const hasOther = !!c.otherText?.trim();
    return !hasChoice && !hasOther;
  }
  if (isScaleType(q.type)) {
    return typeof (a as ScaleAnswer).value !== "number";
  }
  return !(a as TextAnswer).text?.trim();
}

export type SurveyValidationError = { questionId: string; message: string };

export function validateSurveyAnswers(
  config: SurveyConfig,
  answers: Record<string, SurveyAnswer>
): SurveyValidationError[] {
  const errors: SurveyValidationError[] = [];
  for (const q of flattenQuestions(config)) {
    const a = answers[q.id];
    const empty = answerIsEmpty(q, a);
    if (q.required && empty) {
      errors.push({ questionId: q.id, message: "Câu này bắt buộc trả lời" });
      continue;
    }
    if (empty) continue;
    if (q.type === "multiple") {
      const c = a as ChoiceAnswer;
      const n = (c.choiceIds?.length ?? 0) + (c.otherText?.trim() ? 1 : 0);
      if (q.minSelections && n < q.minSelections) {
        errors.push({ questionId: q.id, message: `Chọn ít nhất ${q.minSelections}` });
      }
      if (q.maxSelections && q.maxSelections > 0 && n > q.maxSelections) {
        errors.push({ questionId: q.id, message: `Chỉ chọn tối đa ${q.maxSelections}` });
      }
    }
  }
  return errors;
}

// ---- Hiển thị 1 câu trả lời thành text (export / bảng) ----------------------
export function answerToText(q: SurveyQuestion, a: SurveyAnswer | undefined): string {
  if (answerIsEmpty(q, a)) return "";
  if (isChoiceType(q.type)) {
    const c = a as ChoiceAnswer;
    const byId = new Map((q.options ?? []).map((o) => [o.id, o.text]));
    const parts = (c.choiceIds ?? []).map((id) => byId.get(id) ?? id);
    if (c.otherText?.trim()) parts.push(`Khác: ${c.otherText.trim()}`);
    return parts.join("; ");
  }
  if (isScaleType(q.type)) {
    const val = (a as ScaleAnswer).value;
    const lbl = q.pointLabels?.[String(val)];
    return lbl ? `${val} (${lbl})` : String(val);
  }
  return (a as TextAnswer).text?.trim() ?? "";
}

// ============================================================================
// TỔNG HỢP KẾT QUẢ — dùng chung cho trang kết quả (presenter), phân tích AI,
// và export. Nhận danh sách value đã trả lời + config → thống kê từng câu.
// (Server cũng tổng hợp trong convex/responses.ts:getSurveyResults nhưng dùng
//  cùng shape này để client render thống nhất.)
// ============================================================================
export type SurveyOptionStat = { id: string; text: string; count: number; pct: number };

export type SurveyQuestionStat = {
  id: string;
  type: SurveyQuestionType;
  title: string;
  answeredCount: number;
  // choice
  options?: SurveyOptionStat[];
  otherTexts?: string[];
  // scale
  average?: number;
  distribution?: { value: number; count: number }[];
  scaleMin?: number;
  scaleMax?: number;
  nps?: { promoters: number; passives: number; detractors: number; score: number };
  // text
  texts?: string[];
  words?: { word: string; count: number }[];
};

export type SurveyResults = {
  totalRespondents: number;
  questions: SurveyQuestionStat[];
};

/**
 * Tổng hợp kết quả khảo sát từ các value đã trả lời (không cần danh tính).
 * `wordcloudAggregator` (tùy chọn) cho phép truyền hàm gộp từ khoá (lib/wordcloud).
 */
export function aggregateSurvey(
  config: SurveyConfig,
  values: Array<{ answers?: Record<string, SurveyAnswer> }>,
  wordcloudAggregator?: (texts: string[]) => { word: string; count: number }[]
): SurveyResults {
  const questions = flattenQuestions(config);
  const stats: SurveyQuestionStat[] = questions.map((q) => {
    const answers = values
      .map((v) => v.answers?.[q.id])
      .filter((a): a is SurveyAnswer => a != null && !answerIsEmpty(q, a));
    const answeredCount = answers.length;

    if (isChoiceType(q.type)) {
      const opts = q.options ?? [];
      const counts: Record<string, number> = {};
      opts.forEach((o) => (counts[o.id] = 0));
      const otherTexts: string[] = [];
      for (const a of answers) {
        const c = a as ChoiceAnswer;
        (c.choiceIds ?? []).forEach((id) => {
          if (counts[id] !== undefined) counts[id]++;
        });
        if (c.otherText?.trim()) otherTexts.push(c.otherText.trim());
      }
      // "Khác" như một option ảo nếu có dùng
      const options: SurveyOptionStat[] = opts.map((o) => ({
        id: o.id,
        text: o.text,
        count: counts[o.id] || 0,
        pct: answeredCount > 0 ? Math.round(((counts[o.id] || 0) / answeredCount) * 100) : 0,
      }));
      if (otherTexts.length > 0) {
        options.push({
          id: "__other__",
          text: "Khác",
          count: otherTexts.length,
          pct: answeredCount > 0 ? Math.round((otherTexts.length / answeredCount) * 100) : 0,
        });
      }
      return { id: q.id, type: q.type, title: q.title, answeredCount, options, otherTexts };
    }

    if (isScaleType(q.type)) {
      const { min, max } = scaleRange(q);
      const nums = answers
        .map((a) => (a as ScaleAnswer).value)
        .filter((n): n is number => typeof n === "number");
      const sum = nums.reduce((s, n) => s + n, 0);
      const average = nums.length > 0 ? +(sum / nums.length).toFixed(2) : 0;
      const distMap: Record<number, number> = {};
      for (let i = min; i <= max; i++) distMap[i] = 0;
      nums.forEach((n) => {
        if (distMap[n] === undefined) distMap[n] = 0;
        distMap[n]++;
      });
      const distribution = Object.keys(distMap)
        .map(Number)
        .sort((a, b) => a - b)
        .map((value) => ({ value, count: distMap[value] }));

      let nps: SurveyQuestionStat["nps"];
      if (q.type === "nps") {
        const promoters = nums.filter((n) => n >= 9).length;
        const detractors = nums.filter((n) => n <= 6).length;
        const passives = nums.length - promoters - detractors;
        const score = nums.length > 0 ? Math.round(((promoters - detractors) / nums.length) * 100) : 0;
        nps = { promoters, passives, detractors, score };
      }
      return {
        id: q.id, type: q.type, title: q.title, answeredCount,
        average, distribution, scaleMin: min, scaleMax: max, nps,
      };
    }

    // text
    const texts = answers.map((a) => (a as TextAnswer).text?.trim()).filter(Boolean) as string[];
    let words: { word: string; count: number }[] | undefined;
    if (q.type === "wordcloud" && wordcloudAggregator) {
      words = wordcloudAggregator(texts);
    }
    return { id: q.id, type: q.type, title: q.title, answeredCount, texts, words };
  });

  return { totalRespondents: values.length, questions: stats };
}
