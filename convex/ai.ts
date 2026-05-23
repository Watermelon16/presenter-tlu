"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";

/**
 * Sinh hoạt động từ slide PDF — hỗ trợ 3 provider:
 *
 * MỖI USER tự nhập API key của mình (lưu localStorage). Server KHÔNG có
 * key fallback — không dùng key chung của nền tảng/admin.
 *
 * 1. Gemini (Google AI Studio) — direct API, structured output qua responseSchema
 *    - User key: client truyền qua args.apiKey. Lấy tại https://aistudio.google.com/apikey
 *
 * 2. DeepSeek — OpenAI-compatible API
 *    - User key: bắt buộc. Lấy tại https://platform.deepseek.com/api_keys
 *
 * 3. OpenRouter — OpenAI-compatible aggregator, nhiều model :free
 *    - User key: bắt buộc. Lấy tại https://openrouter.ai/keys
 */

// Provider config — endpoint only (không còn keyEnv vì mỗi user tự dùng key)
const PROVIDERS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
  },
} as const;

type Provider = keyof typeof PROVIDERS;

const ALLOWED_MODELS_BY_PROVIDER: Record<Provider, string[]> = {
  gemini: [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  // OpenRouter free models — verified từ https://openrouter.ai/api/v1/models
  // tag :free thay đổi theo thời gian. Nếu user gặp 404 → đổi model.
  openrouter: [
    "deepseek/deepseek-v4-flash:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "qwen/qwen3-coder:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "openai/gpt-oss-120b:free",
    "z-ai/glm-4.5-air:free",
  ],
};

const SUGGESTION_SCHEMA_DESCRIPTION = `Trả về JSON với shape sau:
{
  "suggestions": [
    {
      "slidePage": <number>,
      "type": "poll" | "wordcloud" | "opentext",
      "title": "<string>",
      "options": ["<string>", ...],  // chỉ cho poll, 3-5 options
      "isQuiz": <boolean>,            // chỉ cho poll
      "correctOptionIndexes": [<int>], // 0-based, chỉ cho poll quiz
      "suggestedTimeLimit": <number>,  // phút
      "reasoning": "<string>"
    }
  ]
}`;

function buildPrompt(args: {
  slidesText: string;
  maxSuggestions: number;
  sessionTitle?: string;
}): string {
  const titleHint = args.sessionTitle ? `Buổi giảng: "${args.sessionTitle}".` : "";
  return `Bạn là trợ lý giảng viên đại học Việt Nam. ${titleHint} Dưới đây là text trích xuất từ slide PDF. Hãy đề xuất ${args.maxSuggestions} hoạt động tương tác cho sinh viên, gắn với từng trang slide cụ thể.

NỘI DUNG SLIDE:
${args.slidesText}

YÊU CẦU:
- Tiếng Việt học thuật, ngắn gọn, rõ ràng.
- Đa dạng loại: poll trắc nghiệm (có đáp án đúng), wordcloud (1-3 từ), opentext (câu ngắn).
- Mỗi suggestion gắn với 1 slidePage cụ thể.
- Poll: 3-5 options. Nếu là quiz → isQuiz=true + correctOptionIndexes (0-based).
- Tránh câu hỏi quá dễ hoặc quá khó.
- suggestedTimeLimit (phút): 1-3 cho poll/wordcloud, 2-5 cho opentext.

${SUGGESTION_SCHEMA_DESCRIPTION}`;
}

async function callGemini(args: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<{ rawText: string; tokenUsage: unknown }> {
  const url = `${PROVIDERS.gemini.baseUrl}/models/${args.model}:generateContent?key=${args.apiKey}`;
  const body = {
    contents: [{ parts: [{ text: args.prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          suggestions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                slidePage: { type: "INTEGER" },
                type: { type: "STRING", enum: ["poll", "wordcloud", "opentext"] },
                title: { type: "STRING" },
                options: { type: "ARRAY", items: { type: "STRING" } },
                isQuiz: { type: "BOOLEAN" },
                correctOptionIndexes: { type: "ARRAY", items: { type: "INTEGER" } },
                suggestedTimeLimit: { type: "NUMBER" },
                reasoning: { type: "STRING" },
              },
              required: ["slidePage", "type", "title"],
            },
          },
        },
        required: ["suggestions"],
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
      message: "Gemini trả về dữ liệu rỗng. Thử model khác.",
    });
  }
  return { rawText: text, tokenUsage: data.usageMetadata ?? null };
}

async function callOpenAICompat(args: {
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
    // OpenRouter recommend các header này để hiện trong dashboard
    headers["HTTP-Referer"] = "https://presenter-tlu.vercel.app";
    headers["X-Title"] = "Presenter TLU";
  }
  const body = {
    model: args.model,
    messages: [
      {
        role: "system",
        content:
          "Bạn là trợ lý giảng viên ĐH Việt Nam. CHỈ trả về JSON đúng schema, KHÔNG kèm markdown code fence hay text thừa.",
      },
      { role: "user", content: args.prompt },
    ],
    temperature: 0.7,
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
    error?: { message?: string; code?: string };
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
      message: `${args.provider} trả về dữ liệu rỗng. Thử model khác.`,
    });
  }
  // Một số model OpenRouter trả JSON kèm ```json fence — chuẩn hoá
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  return { rawText: cleaned, tokenUsage: data.usage ?? null };
}

// Retry fetch với exponential backoff cho transient 5xx errors.
// 503 ("UNAVAILABLE", model overload) là lỗi phổ biến nhất với Gemini Flash khi high demand.
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
    // Retry transient errors: 502 bad gateway, 503 unavailable, 504 timeout
    const isTransient = res.status === 502 || res.status === 503 || res.status === 504;
    if (isTransient && attempt < maxRetries) {
      const delay = 800 * Math.pow(2, attempt); // 800ms, 1.6s, 3.2s
      await new Promise((r) => setTimeout(r, delay));
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
      message: `Model "${model}" (${provider}) đã hết quota. Đổi sang model khác và thử lại.`,
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    // Server provider quá tải / không phản hồi. Sau khi đã retry vẫn fail.
    throw new ConvexError({
      code: "overloaded",
      provider,
      model,
      status,
      message: `Model "${model}" (${provider}) đang quá tải (HTTP ${status}). Đợi 30 giây rồi thử lại, hoặc đổi sang model khác.`,
    });
  }
  if (status === 402) {
    // DeepSeek "Insufficient Balance" — account hết credit
    throw new ConvexError({
      code: "no_balance",
      provider,
      model,
      message:
        provider === "deepseek"
          ? "Tài khoản DeepSeek của bạn hết balance. DeepSeek đã bỏ free credit — cần nạp ≥ $2 tại platform.deepseek.com hoặc dùng OpenRouter free models thay thế."
          : `${provider}: tài khoản hết balance / credit. Cần nạp.`,
    });
  }
  if (status === 404) {
    // OpenRouter "No endpoints found" — model id sai/retired
    throw new ConvexError({
      code: "model_not_found",
      provider,
      model,
      message:
        provider === "openrouter"
          ? `Model "${model}" không còn trên OpenRouter (có thể đã retire). Đổi sang model khác trong dropdown.`
          : `Model "${model}" không tồn tại trên ${provider}.`,
    });
  }
  if (status === 403 || status === 401) {
    throw new ConvexError({
      code: "auth",
      provider,
      model,
      message: `API key cho ${provider} không hợp lệ hoặc bị thu hồi.`,
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

export const generateActivitiesFromPdf = action({
  args: {
    pages: v.array(
      v.object({
        pageNumber: v.number(),
        text: v.string(),
      })
    ),
    maxSuggestions: v.optional(v.number()),
    sessionTitle: v.optional(v.string()),
    provider: v.optional(v.string()),     // "gemini" | "deepseek" | "openrouter"
    model: v.optional(v.string()),
    apiKey: v.optional(v.string()),       // user-provided key (ưu tiên hơn env)
  },
  handler: async (_ctx, args): Promise<{
    suggestions: Array<{
      slidePage: number;
      type: "poll" | "wordcloud" | "opentext";
      title: string;
      options: string[];
      isQuiz: boolean;
      correctOptionIndexes: number[];
      suggestedTimeLimit: number;
      reasoning?: string;
    }>;
    tokenUsage: unknown;
    pagesProcessed: number;
    modelUsed: string;
    providerUsed: Provider;
  }> => {
    // Resolve provider + model
    const provider: Provider = ((): Provider => {
      const p = (args.provider as Provider) ?? "gemini";
      return p in PROVIDERS ? p : "gemini";
    })();

    const defaultModel = ALLOWED_MODELS_BY_PROVIDER[provider][0];
    const requestedModel = args.model || defaultModel;
    const allowed = ALLOWED_MODELS_BY_PROVIDER[provider];
    const model = allowed.includes(requestedModel) ? requestedModel : defaultModel;

    // Resolve API key — ưu tiên args.apiKey (user-provided), fallback env (chỉ Gemini)
    const apiKey = args.apiKey?.trim();
    if (!apiKey) {
      throw new ConvexError({
        code: "no_key",
        provider,
        model,
        message: `Chưa có API key ${provider}. Mở ⚙️ Cài đặt → 🔑 API key để nhập key của bạn.`,
      });
    }

    // Clean + truncate slide text
    const maxSuggestions = Math.max(1, Math.min(args.maxSuggestions ?? 8, 20));
    const cleanPages = args.pages
      .map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text.replace(/\s+/g, " ").trim(),
      }))
      .filter((p) => p.text.length > 20);
    if (cleanPages.length === 0) {
      throw new ConvexError({
        code: "empty_pdf",
        provider,
        model,
        message:
          "Không trích xuất được text có nghĩa từ PDF. Có thể slide là ảnh scan — cần OCR trước.",
      });
    }
    const MAX_CHARS = 60_000;
    let total = 0;
    const pieces: string[] = [];
    for (const p of cleanPages) {
      const piece = `=== Trang ${p.pageNumber} ===\n${p.text}`;
      if (total + piece.length > MAX_CHARS) {
        pieces.push("\n[...nội dung còn lại đã cắt bớt do giới hạn token]");
        break;
      }
      pieces.push(piece);
      total += piece.length;
    }

    const prompt = buildPrompt({
      slidesText: pieces.join("\n\n"),
      maxSuggestions,
      sessionTitle: args.sessionTitle,
    });

    // Call provider
    const { rawText, tokenUsage } =
      provider === "gemini"
        ? await callGemini({ apiKey, model, prompt })
        : await callOpenAICompat({ provider, apiKey, model, prompt });

    // Parse JSON
    let parsed: { suggestions?: unknown };
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

    type RawSuggestion = {
      slidePage?: number;
      type?: string;
      title?: string;
      options?: string[];
      isQuiz?: boolean;
      correctOptionIndexes?: number[];
      suggestedTimeLimit?: number;
      reasoning?: string;
    };
    const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const cleaned = rawList
      .map((s: unknown) => s as RawSuggestion)
      .filter(
        (s) =>
          typeof s.title === "string" &&
          s.title.trim().length > 0 &&
          (s.type === "poll" || s.type === "wordcloud" || s.type === "opentext")
      )
      .map((s) => ({
        slidePage:
          typeof s.slidePage === "number" && s.slidePage > 0
            ? Math.floor(s.slidePage)
            : 1,
        type: s.type as "poll" | "wordcloud" | "opentext",
        title: s.title!.trim(),
        options:
          s.type === "poll" && Array.isArray(s.options)
            ? s.options.map((o) => String(o).trim()).filter(Boolean)
            : [],
        isQuiz: s.type === "poll" ? !!s.isQuiz : false,
        correctOptionIndexes:
          s.type === "poll" && Array.isArray(s.correctOptionIndexes)
            ? s.correctOptionIndexes.filter((i) => typeof i === "number" && i >= 0)
            : [],
        suggestedTimeLimit:
          typeof s.suggestedTimeLimit === "number" && s.suggestedTimeLimit > 0
            ? Math.min(10, s.suggestedTimeLimit)
            : 2,
        reasoning: typeof s.reasoning === "string" ? s.reasoning.trim() : undefined,
      }));

    return {
      suggestions: cleaned,
      tokenUsage,
      pagesProcessed: cleanPages.length,
      modelUsed: model,
      providerUsed: provider,
    };
  },
});

// ============================================================
// KHẢO SÁT (SURVEY) — gen hoạt động từ chủ đề, không cần PDF
// ============================================================

const SURVEY_TYPES = ["poll", "wordcloud", "opentext", "rating"] as const;
type SurveyType = (typeof SURVEY_TYPES)[number];

function buildSurveyPrompt(args: {
  topic: string;
  context?: string;
  count: number;
  enabledTypes: SurveyType[];
}): string {
  const ctx = args.context?.trim() ? `\nCONTEXT THÊM: ${args.context.trim()}` : "";
  return `Bạn là chuyên gia thiết kế khảo sát giáo dục đại học Việt Nam. Hãy tạo ${args.count} câu hỏi khảo sát về chủ đề dưới đây.

CHỦ ĐỀ KHẢO SÁT: ${args.topic}${ctx}

YÊU CẦU:
- Loại câu hỏi được phép: ${args.enabledTypes.join(", ")}.
- Đa dạng loại — pha trộn để khảo sát toàn diện (đo lường định lượng + thu thập ý kiến mở).
- Tiếng Việt rõ ràng, không leading question (tránh dẫn dắt).
- rating: dùng thang Likert 1-5. ratingMinLabel = "Rất không đồng ý" / "Rất kém". ratingMaxLabel = "Rất đồng ý" / "Rất tốt". Phù hợp cho đánh giá mức độ.
- poll: 3-5 options, KHÔNG quá nhiều. Có thể là quiz nếu muốn kiểm tra hiểu biết, hoặc plain survey nếu chỉ thu opinion.
- wordcloud: dùng khi muốn thu từ khóa ngắn 1-3 từ về chủ đề.
- opentext: cho câu trả lời mở dài 1-2 câu, lý do, đề xuất cải tiến.
- suggestedTimeLimit (phút): 1-2 cho rating/poll, 2-3 cho opentext/wordcloud.
- reasoning: 1 câu giải thích mục tiêu của câu hỏi.

Trả về JSON theo schema:
{
  "suggestions": [
    {
      "type": "rating" | "poll" | "wordcloud" | "opentext",
      "title": "<câu hỏi>",
      "options": ["<a>", "<b>"],
      "isQuiz": false,
      "correctOptionIndexes": [],
      "ratingMin": 1,
      "ratingMax": 5,
      "ratingMinLabel": "...",
      "ratingMaxLabel": "...",
      "suggestedTimeLimit": <số phút>,
      "reasoning": "..."
    }
  ]
}`;
}

async function callGeminiSurvey(args: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<{ rawText: string; tokenUsage: unknown }> {
  const url = `${PROVIDERS.gemini.baseUrl}/models/${args.model}:generateContent?key=${args.apiKey}`;
  const body = {
    contents: [{ parts: [{ text: args.prompt }] }],
    generationConfig: {
      temperature: 0.8,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          suggestions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                type: { type: "STRING", enum: ["poll", "wordcloud", "opentext", "rating"] },
                title: { type: "STRING" },
                options: { type: "ARRAY", items: { type: "STRING" } },
                isQuiz: { type: "BOOLEAN" },
                correctOptionIndexes: { type: "ARRAY", items: { type: "INTEGER" } },
                ratingMin: { type: "INTEGER" },
                ratingMax: { type: "INTEGER" },
                ratingMinLabel: { type: "STRING" },
                ratingMaxLabel: { type: "STRING" },
                suggestedTimeLimit: { type: "NUMBER" },
                reasoning: { type: "STRING" },
              },
              required: ["type", "title"],
            },
          },
        },
        required: ["suggestions"],
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
      message: "Gemini trả về rỗng.",
    });
  }
  return { rawText: text, tokenUsage: data.usageMetadata ?? null };
}

export const generateSurveyActivities = action({
  args: {
    topic: v.string(),
    context: v.optional(v.string()),
    count: v.optional(v.number()),
    enabledTypes: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{
    suggestions: Array<{
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
    }>;
    tokenUsage: unknown;
    modelUsed: string;
    providerUsed: Provider;
  }> => {
    const topic = args.topic.trim();
    if (!topic) {
      throw new ConvexError({
        code: "no_topic",
        message: "Vui lòng nhập chủ đề khảo sát.",
      });
    }

    const count = Math.max(1, Math.min(args.count ?? 6, 15));
    const enabledTypes: SurveyType[] =
      Array.isArray(args.enabledTypes) && args.enabledTypes.length > 0
        ? (args.enabledTypes.filter((t) =>
            (SURVEY_TYPES as readonly string[]).includes(t)
          ) as SurveyType[])
        : ["rating", "opentext", "poll"];

    // Provider + model + key
    const provider: Provider = ((): Provider => {
      const p = (args.provider as Provider) ?? "gemini";
      return p in PROVIDERS ? p : "gemini";
    })();
    const allowed = ALLOWED_MODELS_BY_PROVIDER[provider];
    const requestedModel = args.model || allowed[0];
    const model = allowed.includes(requestedModel) ? requestedModel : allowed[0];

    const apiKey = args.apiKey?.trim();
    if (!apiKey) {
      throw new ConvexError({
        code: "no_key",
        provider,
        model,
        message: `Chưa có API key ${provider}. Mở ⚙️ Cài đặt → 🔑 API key để nhập.`,
      });
    }

    const prompt = buildSurveyPrompt({ topic, context: args.context, count, enabledTypes });

    // Call AI (cùng helper với main gen — chỉ Gemini có schema riêng, OpenAI-compat dùng prompt-only)
    const { rawText, tokenUsage } =
      provider === "gemini"
        ? await callGeminiSurvey({ apiKey, model, prompt })
        : await callOpenAICompat({ provider, apiKey, model, prompt });

    let parsed: { suggestions?: unknown };
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

    type Raw = {
      type?: string;
      title?: string;
      options?: string[];
      isQuiz?: boolean;
      correctOptionIndexes?: number[];
      ratingMin?: number;
      ratingMax?: number;
      ratingMinLabel?: string;
      ratingMaxLabel?: string;
      suggestedTimeLimit?: number;
      reasoning?: string;
    };
    const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const cleaned = (rawList as unknown[])
      .map((s) => s as Raw)
      .filter(
        (s) =>
          typeof s.title === "string" &&
          s.title.trim().length > 0 &&
          typeof s.type === "string" &&
          enabledTypes.includes(s.type as SurveyType)
      )
      .map((s) => {
        const t = s.type as SurveyType;
        return {
          type: t,
          title: s.title!.trim(),
          options:
            t === "poll" && Array.isArray(s.options)
              ? s.options.map((o) => String(o).trim()).filter(Boolean)
              : [],
          isQuiz: t === "poll" ? !!s.isQuiz : false,
          correctOptionIndexes:
            t === "poll" && Array.isArray(s.correctOptionIndexes)
              ? s.correctOptionIndexes.filter((i) => typeof i === "number" && i >= 0)
              : [],
          ratingMin: t === "rating" ? s.ratingMin ?? 1 : undefined,
          ratingMax: t === "rating" ? s.ratingMax ?? 5 : undefined,
          ratingMinLabel: t === "rating" ? (s.ratingMinLabel ?? "").trim() : undefined,
          ratingMaxLabel: t === "rating" ? (s.ratingMaxLabel ?? "").trim() : undefined,
          suggestedTimeLimit:
            typeof s.suggestedTimeLimit === "number" && s.suggestedTimeLimit > 0
              ? Math.min(10, s.suggestedTimeLimit)
              : 2,
          reasoning: typeof s.reasoning === "string" ? s.reasoning.trim() : undefined,
        };
      });

    return {
      suggestions: cleaned,
      tokenUsage,
      modelUsed: model,
      providerUsed: provider,
    };
  },
});

// ============================================================
// TÓM TẮT BUỔI GIẢNG (Feature A) — AI đọc engagement + Q&A và rút insight cho GV
// ============================================================

const SUMMARY_SCHEMA_DESCRIPTION = `Trả về JSON với shape đúng:
{
  "overview": "<1-2 câu tóm tắt buổi học>",
  "understandings": ["<3 điểm SV nắm rõ>", ...],
  "confusions": ["<2-3 điểm SV còn nhầm/lúng túng>", ...],
  "notableQuestions": ["<3-5 câu hỏi Q&A đáng chú ý>", ...],
  "nextSuggestions": ["<2-3 gợi ý cho buổi sau>", ...]
}
KHÔNG markdown code fence, KHÔNG text thừa.`;

function buildSummaryPrompt(snapshot: {
  sessionTitle: string;
  className: string | null;
  participantCount: number;
  attendanceCounts: { present: number; late: number; absent: number; excused: number };
  activities: Array<{
    type: string;
    title: string;
    slideCue: string | null;
    responseCount: number;
    detail: Record<string, unknown>;
  }>;
  board: Array<{ content: string; column: string; likes: number }>;
}): string {
  const activitiesText = snapshot.activities
    .map((a, i) => {
      const detailLines: string[] = [];
      const d = a.detail as Record<string, unknown>;
      if (a.type === "poll" && Array.isArray(d.options)) {
        const opts = d.options as Array<{ text: string; count: number; isCorrect: boolean }>;
        const total = opts.reduce((s, o) => s + o.count, 0) || 1;
        detailLines.push(...opts.map((o) => `      - ${o.text}: ${o.count}/${total} (${Math.round((o.count / total) * 100)}%)${o.isCorrect ? " ✓ ĐÁP ÁN ĐÚNG" : ""}`));
      } else if ((a.type === "wordcloud" || a.type === "opentext") && Array.isArray(d.answers)) {
        const answers = d.answers as string[];
        detailLines.push(...answers.slice(0, 20).map((s) => `      - ${s.slice(0, 200)}`));
      } else if (a.type === "rating") {
        detailLines.push(`      Avg ${d.average}/${d.max} (n=${d.count})`);
      } else if (a.type === "qa" && Array.isArray(d.questions)) {
        const qs = d.questions as Array<{ question: string; upvotes?: number; isAnswered?: boolean }>;
        detailLines.push(...qs.slice(0, 15).map((q) => `      - "${q.question}" (${q.upvotes ?? 0} 👍${q.isAnswered ? ", đã trả lời" : ""})`));
      }
      return `${i + 1}. [${a.type}] "${a.title}"${a.slideCue ? ` @${a.slideCue}` : ""} — ${a.responseCount} câu trả lời\n${detailLines.join("\n")}`;
    })
    .join("\n\n");

  const boardText = snapshot.board.length > 0
    ? snapshot.board.slice(0, 30).map((b) => `   - ${b.content.slice(0, 200)} (👍${b.likes})`).join("\n")
    : "(không có)";

  return `Bạn là trợ lý giảng viên ĐH Việt Nam. Hãy tóm tắt buổi giảng dưới đây và đưa ra insight để cải thiện chất lượng dạy. Trả lời bằng tiếng Việt, ngắn gọn, thực tế.

THÔNG TIN BUỔI:
- Tên: ${snapshot.sessionTitle}
- Lớp: ${snapshot.className ?? "không rõ"}
- ${snapshot.participantCount} SV tham gia (có mặt ${snapshot.attendanceCounts.present}, muộn ${snapshot.attendanceCounts.late}, vắng ${snapshot.attendanceCounts.absent}, có phép ${snapshot.attendanceCounts.excused})

CÁC HOẠT ĐỘNG TƯƠNG TÁC:
${activitiesText || "(không có hoạt động nào)"}

BÀI ĐĂNG TRÊN BOARD:
${boardText}

YÊU CẦU:
- "overview": 1-2 câu thực tế, không ca ngợi rỗng. Nêu mức độ tham gia + chủ đề chính.
- "understandings": 3 điểm SV nắm rõ. Dựa vào % đáp án đúng / chất lượng câu trả lời.
- "confusions": 2-3 điểm SV nhầm/lúng túng. Dựa vào câu sai nhiều, câu trả lời hời hợt, Q&A liên quan.
- "notableQuestions": 3-5 câu hỏi Q&A đáng chú ý (có thể rephrase cho gọn).
- "nextSuggestions": 2-3 gợi ý cụ thể buổi sau (ví dụ: "Dành 10p ôn lại khái niệm X vì 60% SV nhầm").

${SUMMARY_SCHEMA_DESCRIPTION}`;
}

export const summarizeSession = action({
  args: {
    sessionId: v.id("sessions"),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    overview: string;
    understandings: string[];
    confusions: string[];
    notableQuestions: string[];
    nextSuggestions: string[];
    activityCount: number;
    responseCount: number;
    modelUsed: string;
    providerUsed: Provider;
    tokenUsage: unknown;
  }> => {
    const provider: Provider = ((): Provider => {
      const p = (args.provider as Provider) ?? "gemini";
      return p in PROVIDERS ? p : "gemini";
    })();
    const defaultModel = ALLOWED_MODELS_BY_PROVIDER[provider][0];
    const requestedModel = args.model || defaultModel;
    const allowed = ALLOWED_MODELS_BY_PROVIDER[provider];
    const model = allowed.includes(requestedModel) ? requestedModel : defaultModel;

    const apiKey = args.apiKey?.trim();
    if (!apiKey) {
      throw new ConvexError({
        code: "no_key",
        provider, model,
        message: `Chưa có API key ${provider}. Mở ⚙️ Cài đặt → 🔑 API key để nhập.`,
      });
    }

    const snapshot = await ctx.runQuery(internal.sessionSummary.getSessionSnapshot, {
      sessionId: args.sessionId,
    });
    if (!snapshot) {
      throw new ConvexError({ code: "no_session", provider, model, message: "Không tìm thấy buổi giảng." });
    }
    if (snapshot.activities.length === 0 && snapshot.board.length === 0) {
      throw new ConvexError({
        code: "no_data",
        provider, model,
        message: "Buổi giảng chưa có hoạt động nào để tóm tắt. Hãy chạy ít nhất 1 activity trước.",
      });
    }

    const prompt = buildSummaryPrompt(snapshot as Parameters<typeof buildSummaryPrompt>[0]);
    const { rawText, tokenUsage } =
      provider === "gemini"
        ? await callGemini({ apiKey, model, prompt })
        : await callOpenAICompat({ provider, apiKey, model, prompt });

    let parsed: {
      overview?: string;
      understandings?: string[];
      confusions?: string[];
      notableQuestions?: string[];
      nextSuggestions?: string[];
    };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new ConvexError({
        code: "invalid_json",
        provider, model,
        message: `${provider} (${model}) trả về JSON không hợp lệ. Thử model khác.`,
      });
    }

    const responseCount = snapshot.activities.reduce(
      (s: number, a: { responseCount: number }) => s + a.responseCount,
      0
    );

    return {
      overview: (parsed.overview ?? "").trim() || "Không có dữ liệu để tóm tắt.",
      understandings: (parsed.understandings ?? []).map((s) => String(s).trim()).filter(Boolean),
      confusions: (parsed.confusions ?? []).map((s) => String(s).trim()).filter(Boolean),
      notableQuestions: (parsed.notableQuestions ?? []).map((s) => String(s).trim()).filter(Boolean),
      nextSuggestions: (parsed.nextSuggestions ?? []).map((s) => String(s).trim()).filter(Boolean),
      activityCount: snapshot.activities.length,
      responseCount,
      modelUsed: model,
      providerUsed: provider,
      tokenUsage,
    };
  },
});
