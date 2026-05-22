"use node";

import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";

/**
 * Sinh hoạt động từ slide PDF — hỗ trợ 3 provider:
 *
 * 1. Gemini (Google AI Studio) — direct API, structured output qua responseSchema
 *    - Server key: env GEMINI_API_KEY (do admin set)
 *    - User key: client truyền qua args.apiKey
 *
 * 2. DeepSeek — OpenAI-compatible API
 *    - User key: bắt buộc (truyền args.apiKey)
 *    - Lấy tại https://platform.deepseek.com/api_keys
 *
 * 3. OpenRouter — OpenAI-compatible aggregator, nhiều model :free
 *    - User key: bắt buộc
 *    - Lấy tại https://openrouter.ai/keys
 */

// Provider config — endpoint + cách parse response
const PROVIDERS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyEnv: "GEMINI_API_KEY",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    keyEnv: null, // user-only
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: null, // user-only
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
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
    const envKeyName = PROVIDERS[provider].keyEnv;
    const apiKey = args.apiKey?.trim() || (envKeyName ? process.env[envKeyName] : undefined);
    if (!apiKey) {
      throw new ConvexError({
        code: "no_key",
        provider,
        model,
        message:
          provider === "gemini"
            ? "Chưa có API key Gemini. Nhập key ở dropdown hoặc liên hệ admin."
            : `Chưa có API key ${provider}. Bấm "Cài đặt key" trong modal AI gen để nhập.`,
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
  const res = await fetch(url, {
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

    const envKeyName = PROVIDERS[provider].keyEnv;
    const apiKey = args.apiKey?.trim() || (envKeyName ? process.env[envKeyName] : undefined);
    if (!apiKey) {
      throw new ConvexError({
        code: "no_key",
        provider,
        model,
        message:
          provider === "gemini"
            ? "Chưa có API key Gemini."
            : `Cần API key ${provider}. Nhập trong modal AI gen.`,
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
