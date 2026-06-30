// Client-side: build prompt + gọi AI để nhận xét kết quả 1 hoạt động.
//
// Key chỉ chạy browser → provider qua HTTPS, không qua server Convex.

import { callAiJson } from "./aiClient";
import type { Provider } from "./aiModels";

// Snapshot type khớp với convex/activityAiReview.ts getReviewSnapshot
export type ReviewSnapshot = {
  activityId: string;
  type: "poll" | "wordcloud" | "rating" | "board" | "qa" | "opentext" | "video" | "html" | "survey";
  title: string;
  config: unknown;
  totalAnswered: number;
  totalNoResponse: number;
  poll?: {
    options: Array<{ label: string; count: number; isCorrect?: boolean }>;
    totalCorrect?: number;
  };
  wordcloud?: { topWords: Array<{ word: string; count: number }> };
  rating?: {
    average: number;
    min: number;
    max: number;
    distribution: Record<string, number>;
  };
  opentext?: {
    samples: string[];
    referenceAnswer?: string;
    aiGradeBreakdown?: { correct: number; partial: number; wrong: number; ungraded: number };
  };
  qa?: { questions: Array<{ text: string; upvotes: number; answered: boolean }> };
  board?: {
    columns: Array<{ id: string; title: string; postCount: number }>;
    samples: Array<{ columnId: string; content: string; likes: number }>;
  };
};

export type AiReviewResult = {
  summary: string;
  observations: string[];
  suggestion?: string;
};

// ===== Build prompt theo loại =====
function buildPrompt(snap: ReviewSnapshot): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `Bạn là trợ giảng cho giảng viên đại học. Nhiệm vụ: ĐỌC kết quả 1 hoạt động trên lớp và đưa ra nhận xét NGẮN GỌN, CỤ THỂ, dùng được ngay.
QUY TẮC:
- Viết tiếng Việt tự nhiên. KHÔNG sáo rỗng kiểu "kết quả rất tốt" mà phải dựa số liệu.
- summary: 1-2 câu tổng quát nêu được điều quan trọng nhất.
- observations: 2-4 quan sát cụ thể, mỗi quan sát là 1 câu hoàn chỉnh (KHÔNG bullet style "•"). Bao gồm số liệu khi có.
- suggestion: 1 câu hành động cho buổi sau hoặc ngay tại buổi (vd: cần ôn lại slide, cần thảo luận thêm). Có thể bỏ trống nếu kết quả không cần can thiệp.
- KHÔNG nhắc các từ kiểu "AI", "tôi sẽ phân tích". Viết như đồng nghiệp ngắn gọn.
- Output JSON đúng định dạng yêu cầu.`;

  // Body theo type
  let body = `Hoạt động "${snap.title}" loại ${snap.type}\nSố SV trả lời: ${snap.totalAnswered}\nSố SV không trả lời: ${snap.totalNoResponse}\n`;

  const cfg = (snap.config ?? {}) as Record<string, unknown>;
  const question = typeof cfg.question === "string" ? cfg.question : "";
  if (question) body += `Câu hỏi: ${question}\n`;

  if (snap.type === "poll" && snap.poll) {
    body += "\nPhân bố lựa chọn:\n";
    for (const opt of snap.poll.options) {
      const pct = snap.totalAnswered > 0 ? Math.round((opt.count / snap.totalAnswered) * 100) : 0;
      const correctTag = opt.isCorrect === true ? " [ĐÁP ÁN]" : opt.isCorrect === false ? "" : "";
      body += `- "${opt.label}": ${opt.count} (${pct}%)${correctTag}\n`;
    }
    if (snap.poll.totalCorrect !== undefined) {
      const pctCorrect = snap.totalAnswered > 0
        ? Math.round((snap.poll.totalCorrect / snap.totalAnswered) * 100)
        : 0;
      body += `Đúng: ${snap.poll.totalCorrect}/${snap.totalAnswered} (${pctCorrect}%)\n`;
    }
  }

  if (snap.type === "wordcloud" && snap.wordcloud) {
    body += "\nTop từ xuất hiện:\n";
    for (const w of snap.wordcloud.topWords.slice(0, 20)) {
      body += `- ${w.word} (${w.count})\n`;
    }
  }

  if (snap.type === "rating" && snap.rating) {
    body += `\nThang điểm: ${snap.rating.min}-${snap.rating.max}\nĐiểm trung bình: ${snap.rating.average}\nPhân bố:\n`;
    const keys = Object.keys(snap.rating.distribution).sort((a, b) => Number(a) - Number(b));
    for (const k of keys) {
      const count = snap.rating.distribution[k];
      const pct = snap.totalAnswered > 0 ? Math.round((count / snap.totalAnswered) * 100) : 0;
      body += `- ${k} điểm: ${count} (${pct}%)\n`;
    }
  }

  if (snap.type === "opentext" && snap.opentext) {
    if (snap.opentext.referenceAnswer) {
      body += `\nĐáp án mẫu: ${snap.opentext.referenceAnswer}\n`;
    }
    if (snap.opentext.aiGradeBreakdown) {
      const g = snap.opentext.aiGradeBreakdown;
      body += `\nKết quả chấm: đúng ${g.correct}, đúng 1 phần ${g.partial}, sai ${g.wrong}, chưa chấm ${g.ungraded}\n`;
    }
    body += "\nMẫu câu trả lời của SV:\n";
    for (const t of snap.opentext.samples) body += `- ${t}\n`;
  }

  if (snap.type === "qa" && snap.qa) {
    body += "\nCâu hỏi SV đặt (sắp xếp theo upvote):\n";
    for (const q of snap.qa.questions) {
      body += `- "${q.text}" (${q.upvotes} upvote${q.answered ? ", đã trả lời" : ""})\n`;
    }
  }

  if (snap.type === "board" && snap.board) {
    body += "\nCác cột trên board + số bài:\n";
    for (const c of snap.board.columns) {
      body += `- ${c.title}: ${c.postCount} bài\n`;
    }
    body += "\nNội dung tiêu biểu (top likes):\n";
    for (const p of snap.board.samples.slice(0, 20)) {
      const col = snap.board.columns.find((c) => c.id === p.columnId)?.title ?? p.columnId;
      body += `- [${col}] "${p.content}" (${p.likes} likes)\n`;
    }
  }

  body += `\nTrả lời JSON đúng format:\n{
  "summary": "1-2 câu tổng quát",
  "observations": ["quan sát 1", "quan sát 2", "..."],
  "suggestion": "hoặc bỏ qua field này"
}`;

  return { systemPrompt, userPrompt: body };
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    observations: { type: "array", items: { type: "string" } },
    suggestion: { type: "string" },
  },
  required: ["summary", "observations"],
};

export async function runActivityReview(args: {
  snapshot: ReviewSnapshot;
  provider: Provider;
  model: string;
  apiKey: string;
}): Promise<{ result: AiReviewResult; tokenUsage: unknown }> {
  const { systemPrompt, userPrompt } = buildPrompt(args.snapshot);
  const { data, tokenUsage } = await callAiJson<AiReviewResult>({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    systemPrompt,
    userPrompt,
    geminiSchema: REVIEW_SCHEMA,
  });

  // Normalize
  const summary = String(data?.summary ?? "").trim();
  const observations = Array.isArray(data?.observations)
    ? data.observations.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
    : [];
  const suggestion = typeof data?.suggestion === "string" ? data.suggestion.trim() : "";

  if (!summary || observations.length === 0) {
    throw new Error("AI trả về kết quả trống. Vui lòng thử lại.");
  }

  return {
    result: {
      summary,
      observations,
      suggestion: suggestion || undefined,
    },
    tokenUsage,
  };
}

// Kiểm tra có đủ data để review hay không
export function snapshotHasData(snap: ReviewSnapshot | null | undefined): boolean {
  if (!snap) return false;
  if (snap.totalAnswered === 0 && snap.type !== "board") return false;
  if (snap.type === "board" && snap.board) {
    const totalPosts = snap.board.columns.reduce((s, c) => s + c.postCount, 0);
    return totalPosts > 0;
  }
  return true;
}
