// Client-side AI caller — gọi provider TRỰC TIẾP từ browser.
// API key chỉ chạy qua HTTPS từ trình duyệt → provider. Convex server KHÔNG nhìn
// thấy key. Tránh log key trong function args.
//
// Hỗ trợ:
//   - Gemini (responseSchema)
//   - Mọi OpenAI-compat: Groq, Cerebras, GitHub Models, Mistral, Together,
//     OpenRouter, DeepSeek (response_format: json_object, fallback nếu ko support)
//
// Tất cả provider listed đều cho phép CORS direct browser call.

import type { Provider } from "./aiModels";

const BASE_URLS: Record<Provider, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  github: "https://models.inference.ai.azure.com",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
};

// Provider không hỗ trợ response_format json_object
const NO_JSON_MODE = new Set<Provider>(["cerebras", "github"]);

export class AiClientError extends Error {
  code: string;
  provider: Provider;
  model: string;
  status?: number;
  constructor(args: {
    message: string;
    code: string;
    provider: Provider;
    model: string;
    status?: number;
  }) {
    super(args.message);
    this.code = args.code;
    this.provider = args.provider;
    this.model = args.model;
    this.status = args.status;
  }
}

type CallArgs = {
  provider: Provider;
  model: string;
  apiKey: string;
  systemPrompt?: string;
  userPrompt: string;
  /** Schema JSON cho Gemini structured output. OpenAI-compat tự dùng json_object mode. */
  geminiSchema?: object;
  /** Cho phép retry 2 lần với 5xx errors (default true). */
  retryTransient?: boolean;
};

/**
 * Gọi AI provider, trả về raw text response (kỳ vọng là JSON string nếu prompt yêu cầu).
 * Caller tự `JSON.parse` (có cleanup markdown fences).
 */
export async function callAiRaw(args: CallArgs): Promise<{ rawText: string; tokenUsage: unknown }> {
  if (!args.apiKey.trim()) {
    throw new AiClientError({
      code: "no_key",
      provider: args.provider,
      model: args.model,
      message: `Chưa có API key ${args.provider}. Vào ⚙️ Cài đặt → 🔑 API key để paste.`,
    });
  }

  if (args.provider === "gemini") {
    return callGeminiDirect(args);
  }
  return callOpenAICompatDirect(args);
}

/**
 * Gọi AI + parse JSON response. Tự strip markdown code fence nếu có.
 */
export async function callAiJson<T = unknown>(args: CallArgs): Promise<{ data: T; tokenUsage: unknown }> {
  const { rawText, tokenUsage } = await callAiRaw(args);
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return { data: JSON.parse(cleaned) as T, tokenUsage };
  } catch {
    throw new AiClientError({
      code: "invalid_json",
      provider: args.provider,
      model: args.model,
      message: `${args.provider} (${args.model}) trả về JSON không hợp lệ. Thử model khác.`,
    });
  }
}

async function callGeminiDirect(args: CallArgs): Promise<{ rawText: string; tokenUsage: unknown }> {
  const url = `${BASE_URLS.gemini}/models/${args.model}:generateContent?key=${args.apiKey}`;
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: args.userPrompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      ...(args.geminiSchema ? { responseSchema: args.geminiSchema } : {}),
    },
  };
  if (args.systemPrompt) {
    body.systemInstruction = { parts: [{ text: args.systemPrompt }] };
  }
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, args.retryTransient !== false);
  if (!res.ok) {
    const text = await res.text();
    throw mapProviderError("gemini", args.model, res.status, text);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: unknown;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new AiClientError({
      code: "blocked",
      provider: "gemini",
      model: args.model,
      message: `Gemini từ chối xử lý: ${data.promptFeedback.blockReason}`,
    });
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new AiClientError({
      code: "empty_response",
      provider: "gemini",
      model: args.model,
      message: "Gemini trả về dữ liệu rỗng. Thử model khác.",
    });
  }
  return { rawText: text, tokenUsage: data.usageMetadata ?? null };
}

async function callOpenAICompatDirect(args: CallArgs): Promise<{ rawText: string; tokenUsage: unknown }> {
  const provider = args.provider as Exclude<Provider, "gemini">;
  const url = `${BASE_URLS[provider]}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.apiKey}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://presenter-tlu.vercel.app";
    headers["X-Title"] = "Presenter TLU";
  }
  if (provider === "github") {
    headers["api-key"] = args.apiKey;
  }

  const supportsJsonMode = !NO_JSON_MODE.has(provider);
  const messages: Array<{ role: string; content: string }> = [];
  if (args.systemPrompt) messages.push({ role: "system", content: args.systemPrompt });
  messages.push({ role: "user", content: args.userPrompt });

  const body: Record<string, unknown> = {
    model: args.model,
    messages,
    temperature: 0.7,
  };
  if (supportsJsonMode) body.response_format = { type: "json_object" };

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, args.retryTransient !== false);
  if (!res.ok) {
    const text = await res.text();
    throw mapProviderError(provider, args.model, res.status, text);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
    error?: { message?: string; code?: string };
  };
  if (data.error) {
    throw new AiClientError({
      code: "provider_error",
      provider,
      model: args.model,
      message: `${provider} lỗi: ${data.error.message ?? "unknown"}`,
    });
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new AiClientError({
      code: "empty_response",
      provider,
      model: args.model,
      message: `${provider} trả về dữ liệu rỗng. Thử model khác.`,
    });
  }
  return { rawText: text, tokenUsage: data.usage ?? null };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retry: boolean,
  maxRetries = 2
): Promise<Response> {
  if (!retry) return fetch(url, init);
  let last: Response | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const transient = res.status === 502 || res.status === 503 || res.status === 504;
    if (transient && i < maxRetries) {
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
      last = res;
      continue;
    }
    return res;
  }
  return last!;
}

function mapProviderError(provider: Provider, model: string, status: number, errText: string): AiClientError {
  if (status === 401 || status === 403) {
    return new AiClientError({
      code: "auth_error",
      provider, model, status,
      message: `${provider}: API key sai hoặc hết hạn. Kiểm tra ⚙️ Cài đặt → 🔑 API key.`,
    });
  }
  if (status === 402) {
    return new AiClientError({
      code: "quota_paid",
      provider, model, status,
      message: `${provider}: hết credit, cần nạp thêm. Đổi sang model free khác.`,
    });
  }
  if (status === 404) {
    return new AiClientError({
      code: "model_not_found",
      provider, model, status,
      message: `Model "${model}" (${provider}) không tồn tại / đã retire. Đổi model khác.`,
    });
  }
  if (status === 429) {
    return new AiClientError({
      code: "rate_limit",
      provider, model, status,
      message: `${provider} hết quota / rate limit. Đổi model khác hoặc đợi 1 phút.`,
    });
  }
  return new AiClientError({
    code: "provider_error",
    provider, model, status,
    message: `${provider} lỗi HTTP ${status} (${model}): ${errText.slice(0, 200)}`,
  });
}
