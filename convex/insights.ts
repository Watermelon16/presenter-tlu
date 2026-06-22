"use node";

import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Smart insights cuối buổi — gửi data đã aggregate cho AI để phân tích.
 * Tận dụng cùng provider system như convex/ai.ts (Gemini/DeepSeek/OpenRouter).
 */

const PROVIDERS = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
} as const;

type Provider = keyof typeof PROVIDERS;

const ALLOWED_PROVIDERS: Provider[] = ["gemini", "deepseek", "openrouter"];

function buildInsightsPrompt(data: SessionInsightsData): string {
  const lines: string[] = [];
  lines.push(`Bạn là chuyên gia giáo dục đại học Việt Nam. Phân tích kết quả buổi giảng dưới đây và đưa ra insights thực tế giúp giảng viên cải thiện.`);
  lines.push("");
  lines.push(`BUỔI GIẢNG: "${data.session.title}"${data.session.hostName ? ` · GV: ${data.session.hostName}` : ""}`);
  lines.push(`Phiên: ${data.session.run} · Trạng thái: ${data.session.status}`);
  lines.push(`Tổng số SV tham gia: ${data.totalParticipants}`);
  lines.push(`Tổng số hoạt động: ${data.activityCount} (đang chạy: ${data.activeActivities}, đã đóng: ${data.closedActivities})`);
  lines.push("");
  lines.push("CHI TIẾT TỪNG HOẠT ĐỘNG:");

  for (let i = 0; i < data.activityStats.length; i++) {
    const a = data.activityStats[i];
    const idx = i + 1;
    const slidePart = a.slideCue ? ` [Slide ${a.slideCue}]` : "";
    lines.push(`\n${idx}. [${a.type}] "${a.title}"${slidePart}`);
    lines.push(`   - Status: ${a.status} · Trả lời: ${a.answeredCount}/${data.totalParticipants} (${a.answerRate}%) · Không trả lời: ${a.noResponseCount}`);

    if (a.type === "poll") {
      const poll = a as PollStat;
      if (poll.isQuiz) {
        lines.push(`   - QUIZ: Đúng ${poll.correctCount}/${a.answeredCount} (${poll.correctPct}%) · Sai ${poll.wrongCount}`);
      }
      for (const opt of poll.options) {
        const tag = opt.isCorrect ? " ✓ĐÚNG" : "";
        lines.push(`     • "${opt.text}"${tag} — ${opt.voteCount} vote`);
      }
    } else if (a.type === "wordcloud") {
      const wc = a as WordcloudStat;
      if (wc.topWords.length > 0) {
        lines.push(`   - Top từ: ${wc.topWords.map((w) => `"${w.text}"(${w.count})`).join(", ")}`);
      }
    } else if (a.type === "opentext") {
      const ot = a as OpentextStat;
      if (ot.sampleAnswers.length > 0) {
        const sample = ot.sampleAnswers.slice(0, 10).map((s) => `"${s.slice(0, 100)}"`).join("; ");
        lines.push(`   - Mẫu câu trả lời: ${sample}`);
      }
    } else if (a.type === "rating") {
      const r = a as RatingStat;
      lines.push(`   - Thang ${r.ratingRange.min}-${r.ratingRange.max} · TB: ${r.avgRating ?? "N/A"} (${r.ratingCount} lượt chấm)`);
    } else if (a.type === "qa") {
      const qa = a as QaStat;
      if (qa.topQuestions.length > 0) {
        const top = qa.topQuestions.slice(0, 5).map((q) => `"${q.text.slice(0, 80)}" (${q.upvotes} upvotes)`).join("; ");
        lines.push(`   - Top câu hỏi: ${top}`);
      }
    } else if (a.type === "board") {
      const b = a as BoardStat;
      lines.push(`   - ${b.boardPostCount} bài đăng`);
      if (b.topPosts.length > 0) {
        const top = b.topPosts.slice(0, 3).map((p) => `"${p.content.slice(0, 60)}"(${p.likes}❤)`).join("; ");
        lines.push(`   - Top liked: ${top}`);
      }
    }
  }

  lines.push("");
  lines.push("YÊU CẦU PHÂN TÍCH:");
  lines.push("- topMistakes: liệt kê các câu quiz có % sai cao (>40%), kèm advice nên ôn lại slide nào và tại sao SV có thể nhầm.");
  lines.push("- lowEngagement: hoạt động có answer rate thấp (<50%) — đề xuất lý do (câu khó hiểu, hết giờ, slide chưa rõ).");
  lines.push("- themes: 2-4 chủ đề chính nổi lên từ wordcloud + opentext + qa — gom semantic gần nhau, không liệt kê thô.");
  lines.push("- summary: 100-150 từ tóm tắt buổi giảng cho GIẢNG VIÊN — nội dung chính, điểm mạnh điểm yếu của lớp.");
  lines.push("- actionItems: 3-5 hành động cụ thể GV nên làm tiếp (ôn lại slide X, bổ sung ví dụ Y, hỏi feedback Z...).");
  lines.push("- studentFacingSummary: 80-120 từ summary thân thiện để chia sẻ với SV (lời cảm ơn + tóm tắt + 1-2 điểm cần tự ôn).");
  lines.push("");
  lines.push("Tiếng Việt học thuật. Trả về JSON đúng schema, KHÔNG kèm markdown fence.");

  return lines.join("\n");
}

// ===== Types khớp với data từ internalQuery =====

type BaseStat = {
  id: string;
  type: "poll" | "wordcloud" | "rating" | "board" | "qa" | "opentext" | "video" | "html";
  title: string;
  slideCue: string | null;
  status: string;
  timeLimit: number | null;
  requiresStudentCode: boolean;
  answeredCount: number;
  noResponseCount: number;
  answerRate: number;
};
type PollStat = BaseStat & {
  isQuiz: boolean;
  options: Array<{ id: string; text: string; voteCount: number; isCorrect: boolean }>;
  correctCount: number | null;
  wrongCount: number | null;
  correctPct: number | null;
};
type WordcloudStat = BaseStat & { topWords: Array<{ text: string; count: number }> };
type OpentextStat = BaseStat & { sampleAnswers: string[] };
type RatingStat = BaseStat & {
  ratingRange: { min: number; max: number };
  avgRating: number | null;
  ratingCount: number;
};
type QaStat = BaseStat & { topQuestions: Array<{ text: string; upvotes: number }> };
type BoardStat = BaseStat & {
  boardPostCount: number;
  topPosts: Array<{ content: string; likes: number }>;
};

type SessionInsightsData = {
  session: { title: string; hostName: string | null; run: number; status: string };
  totalParticipants: number;
  activityCount: number;
  activeActivities: number;
  closedActivities: number;
  activityStats: Array<BaseStat | PollStat | WordcloudStat | OpentextStat | RatingStat | QaStat | BoardStat>;
};

// ===== AI calls (duplicate từ ai.ts để self-contained — sau có thể refactor) =====

async function callGeminiForInsights(args: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<{ rawText: string; tokenUsage: unknown }> {
  const url = `${PROVIDERS.gemini.baseUrl}/models/${args.model}:generateContent?key=${args.apiKey}`;
  const body = {
    contents: [{ parts: [{ text: args.prompt }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          topMistakes: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                activityTitle: { type: "STRING" },
                wrongPct: { type: "NUMBER" },
                slidePage: { type: "STRING" },
                advice: { type: "STRING" },
              },
              required: ["activityTitle", "advice"],
            },
          },
          lowEngagement: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                activityTitle: { type: "STRING" },
                answerRate: { type: "NUMBER" },
                advice: { type: "STRING" },
              },
              required: ["activityTitle", "advice"],
            },
          },
          themes: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                summary: { type: "STRING" },
                fromActivity: { type: "STRING" },
              },
              required: ["name", "summary"],
            },
          },
          summary: { type: "STRING" },
          actionItems: { type: "ARRAY", items: { type: "STRING" } },
          studentFacingSummary: { type: "STRING" },
        },
        required: ["summary", "actionItems", "studentFacingSummary"],
      },
    },
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throwProviderError("gemini", args.model, res.status, text);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: unknown;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new ConvexError({
      code: "blocked",
      provider: "gemini",
      model: args.model,
      message: `Gemini từ chối xử lý: ${data.promptFeedback.blockReason}`,
    });
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new ConvexError({
      code: "empty_response",
      provider: "gemini",
      model: args.model,
      message: "Gemini trả về dữ liệu rỗng.",
    });
  }
  return { rawText: text, tokenUsage: data.usageMetadata ?? null };
}

async function callOpenAICompatForInsights(args: {
  provider: "deepseek" | "openrouter";
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<{ rawText: string; tokenUsage: unknown }> {
  const cfg = PROVIDERS[args.provider];
  const url = `${cfg.baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.apiKey}`,
  };
  if (args.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://presenter-tlu.vercel.app";
    headers["X-Title"] = "Presenter TLU";
  }
  const body = {
    model: args.model,
    messages: [
      {
        role: "system",
        content:
          "Bạn là chuyên gia giáo dục ĐH Việt Nam. CHỈ trả về JSON đúng schema yêu cầu trong prompt, KHÔNG markdown fence hay text thừa.",
      },
      { role: "user", content: args.prompt },
    ],
    temperature: 0.6,
    response_format: { type: "json_object" },
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throwProviderError(args.provider, args.model, res.status, text);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
    error?: { message?: string };
  };
  if (data.error) {
    throw new ConvexError({
      code: "provider_error",
      provider: args.provider,
      model: args.model,
      message: `${args.provider} lỗi: ${data.error.message ?? "unknown"}`,
    });
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new ConvexError({
      code: "empty_response",
      provider: args.provider,
      model: args.model,
      message: `${args.provider} trả về dữ liệu rỗng.`,
    });
  }
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return { rawText: cleaned, tokenUsage: data.usage ?? null };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { maxRetries?: number } = {}
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const isTransient = res.status === 502 || res.status === 503 || res.status === 504;
    if (isTransient && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
      lastResponse = res;
      continue;
    }
    return res;
  }
  return lastResponse!;
}

function throwProviderError(
  provider: Provider,
  model: string,
  status: number,
  errText: string
): never {
  if (status === 429) {
    throw new ConvexError({
      code: "quota_exceeded",
      provider,
      model,
      message: `Model "${model}" (${provider}) đã hết quota.`,
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    throw new ConvexError({
      code: "overloaded",
      provider,
      model,
      status,
      message: `Model "${model}" (${provider}) đang quá tải (HTTP ${status}). Đợi 30 giây rồi thử lại hoặc đổi model.`,
    });
  }
  if (status === 402) {
    throw new ConvexError({
      code: "no_balance",
      provider,
      model,
      message:
        provider === "deepseek"
          ? "Tài khoản DeepSeek hết balance. Dùng OpenRouter free thay thế."
          : `${provider}: hết balance.`,
    });
  }
  if (status === 404) {
    throw new ConvexError({
      code: "model_not_found",
      provider,
      model,
      message: `Model "${model}" không tồn tại / đã retire.`,
    });
  }
  if (status === 403 || status === 401) {
    throw new ConvexError({
      code: "auth",
      provider,
      model,
      message: `API key cho ${provider} không hợp lệ.`,
    });
  }
  throw new ConvexError({
    code: "provider_error",
    provider,
    model,
    status,
    message: `${provider} lỗi HTTP ${status} (model ${model}): ${errText.slice(0, 200)}`,
  });
}

// ===== Action chính =====

export const generateSessionInsights = action({
  args: {
    sessionId: v.id("sessions"),
    run: v.optional(v.number()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    insights: {
      topMistakes?: Array<{ activityTitle: string; wrongPct?: number; slidePage?: string; advice: string }>;
      lowEngagement?: Array<{ activityTitle: string; answerRate?: number; advice: string }>;
      themes?: Array<{ name: string; summary: string; fromActivity?: string }>;
      summary: string;
      actionItems: string[];
      studentFacingSummary: string;
    };
    modelUsed: string;
    providerUsed: Provider;
    tokenUsage: unknown;
  }> => {
    // Resolve provider
    const provider: Provider = ALLOWED_PROVIDERS.includes(args.provider as Provider)
      ? (args.provider as Provider)
      : "gemini";

    const model = args.model || (provider === "gemini" ? "gemini-2.5-flash" : "");
    if (!model) {
      throw new ConvexError({
        code: "no_model",
        provider,
        message: `Vui lòng chọn model cho provider ${provider}.`,
      });
    }

    // Resolve key
    const apiKey = args.apiKey?.trim();
    if (!apiKey) {
      throw new ConvexError({
        code: "no_key",
        provider,
        model,
        message: `Chưa có API key ${provider}. Mở ⚙️ Cài đặt → 🔑 API key để nhập.`,
      });
    }

    // Gather data
    const data: SessionInsightsData = await ctx.runQuery(
      internal.insightsData.gatherSessionInsightsData,
      { sessionId: args.sessionId, run: args.run }
    );

    if (data.activityCount === 0) {
      throw new ConvexError({
        code: "no_activities",
        message: "Buổi giảng chưa có hoạt động nào để phân tích.",
      });
    }

    const prompt = buildInsightsPrompt(data);

    const { rawText, tokenUsage } =
      provider === "gemini"
        ? await callGeminiForInsights({ apiKey, model, prompt })
        : await callOpenAICompatForInsights({ provider, apiKey, model, prompt });

    let parsed: {
      topMistakes?: unknown;
      lowEngagement?: unknown;
      themes?: unknown;
      summary?: unknown;
      actionItems?: unknown;
      studentFacingSummary?: unknown;
    };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new ConvexError({
        code: "invalid_json",
        provider,
        model,
        message: `${provider} (${model}) trả về JSON không hợp lệ. Thử model khác.`,
      });
    }

    return {
      insights: {
        topMistakes: Array.isArray(parsed.topMistakes)
          ? (parsed.topMistakes as Array<{
              activityTitle: string;
              wrongPct?: number;
              slidePage?: string;
              advice: string;
            }>)
          : [],
        lowEngagement: Array.isArray(parsed.lowEngagement)
          ? (parsed.lowEngagement as Array<{
              activityTitle: string;
              answerRate?: number;
              advice: string;
            }>)
          : [],
        themes: Array.isArray(parsed.themes)
          ? (parsed.themes as Array<{ name: string; summary: string; fromActivity?: string }>)
          : [],
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        actionItems: Array.isArray(parsed.actionItems)
          ? (parsed.actionItems as unknown[]).map((x) => String(x))
          : [],
        studentFacingSummary:
          typeof parsed.studentFacingSummary === "string" ? parsed.studentFacingSummary : "",
      },
      modelUsed: model,
      providerUsed: provider,
      tokenUsage,
    };
  },
});
