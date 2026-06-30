// Client-side AI cho KHẢO SÁT:
//   1) generateSurveyForm — sinh gợi ý cấu trúc biểu mẫu từ chủ đề (GV chỉnh từng câu sau).
//   2) runSurveyAnalysis  — đọc kết quả tổng hợp → phân tích (tổng quan, mạnh/yếu, gợi ý).
//
// Key chạy thẳng từ browser → provider (không qua server Convex). Mẫu giống
// lib/activityReviewClient.ts.

import { callAiJson } from "./aiClient";
import type { Provider } from "./aiModels";
import {
  type SurveyConfig,
  type SurveyQuestion,
  type SurveyQuestionType,
  type SurveyResults,
  newId,
  newOption,
  questionTypeLabel,
  isChoiceType,
  isScaleType,
  scaleRange,
} from "./survey";

const ALL_TYPES: SurveyQuestionType[] = [
  "single", "multiple", "dropdown", "likert", "rating", "nps", "short_text", "long_text", "wordcloud",
];

// ============================ 1) SINH BIỂU MẪU ============================
type AiQuestion = {
  type?: string;
  title?: string;
  description?: string;
  required?: boolean;
  options?: string[];
  allowOther?: boolean;
  scaleMin?: number;
  scaleMax?: number;
  minLabel?: string;
  maxLabel?: string;
};
type AiSurvey = {
  intro?: string;
  sections?: { title?: string; description?: string; questions?: AiQuestion[] }[];
};

const GEN_SCHEMA = {
  type: "object",
  properties: {
    intro: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                required: { type: "boolean" },
                options: { type: "array", items: { type: "string" } },
                allowOther: { type: "boolean" },
                scaleMin: { type: "number" },
                scaleMax: { type: "number" },
                minLabel: { type: "string" },
                maxLabel: { type: "string" },
              },
              required: ["type", "title"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  required: ["sections"],
};

function normalizeType(t: string | undefined, allowed: Set<SurveyQuestionType>): SurveyQuestionType {
  const raw = (t ?? "").toLowerCase().trim();
  const map: Record<string, SurveyQuestionType> = {
    single: "single", single_choice: "single", radio: "single", choice: "single",
    multiple: "multiple", multiple_choice: "multiple", checkbox: "multiple", multi: "multiple",
    dropdown: "dropdown", select: "dropdown", list: "dropdown",
    likert: "likert", scale: "likert", agree: "likert",
    rating: "rating", star: "rating", stars: "rating",
    nps: "nps",
    short_text: "short_text", short: "short_text", text: "short_text",
    long_text: "long_text", long: "long_text", paragraph: "long_text", essay: "long_text",
    wordcloud: "wordcloud", word_cloud: "wordcloud", keyword: "wordcloud",
  };
  const resolved = map[raw] ?? "single";
  if (allowed.has(resolved)) return resolved;
  // fallback: chọn loại được phép gần nhất theo nhóm
  if (isChoiceType(resolved)) return [...allowed].find(isChoiceType) ?? "short_text";
  if (isScaleType(resolved)) return [...allowed].find(isScaleType) ?? "likert";
  return [...allowed].find((x) => !isChoiceType(x) && !isScaleType(x)) ?? "short_text";
}

function aiQuestionToSurvey(aq: AiQuestion, allowed: Set<SurveyQuestionType>): SurveyQuestion {
  const type = normalizeType(aq.type, allowed);
  const q: SurveyQuestion = {
    id: newId("q"),
    type,
    title: (aq.title ?? "").trim(),
    description: aq.description?.trim() || undefined,
    required: !!aq.required,
  };
  if (isChoiceType(type)) {
    const opts = (aq.options ?? []).map((t) => String(t).trim()).filter(Boolean);
    q.options = (opts.length >= 2 ? opts : ["Lựa chọn 1", "Lựa chọn 2"]).map((t) => newOption(t));
    if (aq.allowOther) q.allowOther = true;
    if (type === "multiple") q.minSelections = 0;
  } else if (type === "likert") {
    q.scaleMin = aq.scaleMin ?? 1;
    q.scaleMax = aq.scaleMax ?? 5;
    q.minLabel = aq.minLabel || "Rất không đồng ý";
    q.maxLabel = aq.maxLabel || "Rất đồng ý";
  } else if (type === "rating") {
    q.scaleMax = aq.scaleMax ?? 5;
  } else if (type === "nps") {
    q.minLabel = aq.minLabel || "Không bao giờ";
    q.maxLabel = aq.maxLabel || "Chắc chắn";
  } else if (type === "short_text") {
    q.maxLength = 120;
  } else if (type === "long_text") {
    q.maxLength = 500;
  } else if (type === "wordcloud") {
    q.maxLength = 30;
  }
  return q;
}

export async function generateSurveyForm(args: {
  topic: string;
  context?: string;
  count: number;
  allowedTypes: SurveyQuestionType[];
  provider: Provider;
  model: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<{ config: SurveyConfig; tokenUsage: unknown }> {
  const allowed = new Set<SurveyQuestionType>(
    args.allowedTypes.length ? args.allowedTypes : ALL_TYPES
  );
  const typeList = [...allowed].map((t) => `"${t}" (${questionTypeLabel(t)})`).join(", ");

  const systemPrompt = `Bạn là chuyên gia thiết kế KHẢO SÁT giáo dục đại học. Nhiệm vụ: từ chủ đề, soạn một biểu mẫu khảo sát NGẮN GỌN, ĐA CHIỀU, dùng được ngay.
QUY TẮC:
- Tiếng Việt tự nhiên, câu hỏi rõ ràng, KHÔNG mơ hồ, KHÔNG trùng ý.
- Ưu tiên thu thập THÔNG TIN HỮU ÍCH. Khi câu trả lời nên gói trong các phương án có sẵn (để tránh dữ liệu loãng/sai), hãy dùng "single"/"multiple"/"dropdown" với options cụ thể; chỉ dùng tự luận khi thật cần ý kiến mở.
- CHỈ dùng các loại câu: ${typeList}.
- Với câu chọn: cho 3–6 options ngắn gọn, không chồng lấn; thêm allowOther=true nếu hợp lý.
- Với likert: minLabel/maxLabel rõ nghĩa; scaleMin=1, scaleMax=5.
- Chia câu hỏi thành 1–3 mục (sections) theo chủ điểm; mỗi mục có title ngắn.
- Output JSON ĐÚNG định dạng yêu cầu, không thêm lời dẫn.`;

  const userPrompt = `CHỦ ĐỀ: ${args.topic.trim()}
${args.context?.trim() ? `BỐI CẢNH: ${args.context.trim()}\n` : ""}SỐ CÂU HỎI mong muốn: khoảng ${args.count}.

Trả về JSON:
{
  "intro": "1-2 câu dẫn nhập ngắn (có thể để rỗng)",
  "sections": [
    {
      "title": "Tên mục",
      "description": "mô tả ngắn (tùy chọn)",
      "questions": [
        {
          "type": "một trong các loại cho phép",
          "title": "nội dung câu hỏi",
          "description": "giải thích thêm (tùy chọn)",
          "required": false,
          "options": ["A", "B", "C"],
          "allowOther": false,
          "scaleMin": 1, "scaleMax": 5,
          "minLabel": "...", "maxLabel": "..."
        }
      ]
    }
  ]
}
Chỉ đưa "options" cho loại chọn; chỉ đưa scale/label cho likert/nps.`;

  const { data, tokenUsage } = await callAiJson<AiSurvey>({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    systemPrompt,
    userPrompt,
    geminiSchema: GEN_SCHEMA,
    signal: args.signal,
  });

  const rawSections = Array.isArray(data?.sections) ? data.sections : [];
  const sections = rawSections
    .map((s) => ({
      id: newId("s"),
      title: s.title?.trim() || "",
      description: s.description?.trim() || undefined,
      questions: (Array.isArray(s.questions) ? s.questions : [])
        .map((aq) => aiQuestionToSurvey(aq, allowed))
        .filter((q) => q.title.length > 0),
    }))
    .filter((s) => s.questions.length > 0);

  if (sections.length === 0) {
    throw new Error("AI không tạo được câu hỏi nào. Thử chủ đề rõ hơn hoặc model khác.");
  }

  return {
    config: { intro: data?.intro?.trim() || "", sections },
    tokenUsage,
  };
}

// ============================ 2) PHÂN TÍCH ============================
export type SurveyAnalysis = {
  overview: string;
  sentiment?: "positive" | "mixed" | "negative";
  strengths: string[];
  weaknesses: string[];
  perQuestion: { title: string; insight: string }[];
  suggestions: string[];
};

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    sentiment: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    perQuestion: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, insight: { type: "string" } },
        required: ["title", "insight"],
      },
    },
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: ["overview", "strengths", "weaknesses", "suggestions"],
};

// Định dạng kết quả thành text gọn cho AI đọc
export function formatResultsForAi(results: SurveyResults, config: SurveyConfig): string {
  const byId = new Map(
    config.sections.flatMap((s) => s.questions).map((q) => [q.id, q])
  );
  let body = `Tổng số người trả lời: ${results.totalRespondents}\n`;
  results.questions.forEach((qs, i) => {
    const q = byId.get(qs.id);
    body += `\n[${i + 1}] (${questionTypeLabel(qs.type)}) ${qs.title} — ${qs.answeredCount} trả lời\n`;
    if (qs.options) {
      for (const o of qs.options) body += `   • ${o.text}: ${o.count} (${o.pct}%)\n`;
      if (qs.otherTexts?.length) body += `   • Khác: ${qs.otherTexts.slice(0, 10).join(" | ")}\n`;
    } else if (qs.average !== undefined) {
      const r = q ? scaleRange(q) : { min: qs.scaleMin ?? 1, max: qs.scaleMax ?? 5 };
      body += `   TB ${qs.average}/${r.max}`;
      if (qs.nps) body += ` · NPS ${qs.nps.score} (P${qs.nps.promoters}/Pa${qs.nps.passives}/D${qs.nps.detractors})`;
      body += `\n`;
      if (qs.distribution) {
        body += "   Phân bố: " + qs.distribution.map((d) => `${d.value}:${d.count}`).join(", ") + "\n";
      }
    } else if (qs.texts) {
      body += "   Mẫu trả lời: " + qs.texts.slice(0, 15).map((t) => `"${t}"`).join("; ") + "\n";
    }
  });
  return body;
}

export async function runSurveyAnalysis(args: {
  surveyTitle: string;
  results: SurveyResults;
  config: SurveyConfig;
  provider: Provider;
  model: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<{ analysis: SurveyAnalysis; tokenUsage: unknown }> {
  const systemPrompt = `Bạn là chuyên gia phân tích khảo sát cho giảng viên đại học. ĐỌC kết quả khảo sát và đưa phân tích NGẮN GỌN, CỤ THỂ, DỰA TRÊN SỐ LIỆU.
QUY TẮC:
- Tiếng Việt tự nhiên, KHÔNG sáo rỗng. Mọi nhận định gắn với con số/tỉ lệ cụ thể.
- overview: 2-3 câu tổng quan điều quan trọng nhất.
- sentiment: "positive" | "mixed" | "negative" theo tổng thể.
- strengths: 2-4 điểm tích cực (kèm số liệu).
- weaknesses: 2-4 điểm cần cải thiện / đáng lưu ý (kèm số liệu).
- perQuestion: nhận xét cho 3-6 câu nổi bật nhất (title = tên câu, insight = 1 câu).
- suggestions: 3-5 hành động cụ thể cho giảng viên/khoá sau.
- Output JSON đúng định dạng.`;

  const userPrompt = `KHẢO SÁT: "${args.surveyTitle}"
${formatResultsForAi(args.results, args.config)}

Trả về JSON:
{
  "overview": "...",
  "sentiment": "positive|mixed|negative",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "perQuestion": [{"title":"...","insight":"..."}],
  "suggestions": ["..."]
}`;

  const { data, tokenUsage } = await callAiJson<SurveyAnalysis>({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    systemPrompt,
    userPrompt,
    geminiSchema: ANALYSIS_SCHEMA,
    signal: args.signal,
  });

  const norm = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 8) : [];

  const analysis: SurveyAnalysis = {
    overview: String(data?.overview ?? "").trim(),
    sentiment: (["positive", "mixed", "negative"] as const).includes(data?.sentiment as "positive")
      ? (data.sentiment as SurveyAnalysis["sentiment"])
      : undefined,
    strengths: norm(data?.strengths),
    weaknesses: norm(data?.weaknesses),
    perQuestion: Array.isArray(data?.perQuestion)
      ? data.perQuestion
          .map((p) => ({ title: String(p?.title ?? "").trim(), insight: String(p?.insight ?? "").trim() }))
          .filter((p) => p.title && p.insight)
          .slice(0, 8)
      : [],
    suggestions: norm(data?.suggestions),
  };

  if (!analysis.overview) throw new Error("AI trả về phân tích trống. Thử lại hoặc đổi model.");
  return { analysis, tokenUsage };
}
