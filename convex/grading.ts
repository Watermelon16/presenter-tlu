"use node";

import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

/**
 * Auto-grade opentext responses bằng AI.
 *
 * Yêu cầu: activity type = "opentext" với config.referenceAnswer (đáp án mẫu).
 * Action gửi reference + tất cả student answers cho AI, AI trả về grade cho từng câu.
 *
 * Re-use cùng provider system (Gemini/DeepSeek/OpenRouter) với key user.
 */

const PROVIDERS = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
} as const;

type Provider = keyof typeof PROVIDERS;

const ALLOWED_PROVIDERS: Provider[] = ["gemini", "deepseek", "openrouter"];

type RawGrade = { index?: number; grade?: string; reason?: string };

async function callGeminiGrade(args: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<RawGrade[]> {
  const url = `${PROVIDERS.gemini.baseUrl}/models/${args.model}:generateContent?key=${args.apiKey}`;
  const body = {
    contents: [{ parts: [{ text: args.prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          grades: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                index: { type: "INTEGER" },
                grade: { type: "STRING", enum: ["correct", "partial", "wrong"] },
                reason: { type: "STRING" },
              },
              required: ["index", "grade", "reason"],
            },
          },
        },
        required: ["grades"],
      },
    },
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throwProviderError("gemini", args.model, res.status, await res.text());
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return parseGrades(text, "gemini", args.model);
}

async function callOpenAICompatGrade(args: {
  provider: "deepseek" | "openrouter";
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<RawGrade[]> {
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
          "Bạn là giảng viên chấm bài. CHỈ trả về JSON đúng schema { \"grades\": [{ index, grade, reason }] }, KHÔNG markdown fence.",
      },
      { role: "user", content: args.prompt },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throwProviderError(args.provider, args.model, res.status, await res.text());
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = (data.choices?.[0]?.message?.content ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  return parseGrades(text, args.provider, args.model);
}

function parseGrades(rawText: string, provider: Provider, model: string): RawGrade[] {
  let parsed: { grades?: unknown };
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
  return Array.isArray(parsed.grades) ? (parsed.grades as RawGrade[]) : [];
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
  if (status === 502 || status === 503 || status === 504) {
    throw new ConvexError({
      code: "overloaded",
      provider,
      model,
      status,
      message: `Model "${model}" (${provider}) đang quá tải (HTTP ${status}). Đợi 30s rồi thử lại hoặc đổi model.`,
    });
  }
  if (status === 429) {
    throw new ConvexError({
      code: "quota_exceeded",
      provider,
      model,
      message: `Model "${model}" (${provider}) đã hết quota.`,
    });
  }
  if (status === 402) {
    throw new ConvexError({
      code: "no_balance",
      provider,
      model,
      message:
        provider === "deepseek"
          ? "DeepSeek hết balance. Dùng OpenRouter free model."
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
  if (status === 401 || status === 403) {
    throw new ConvexError({
      code: "auth",
      provider,
      model,
      message: `API key ${provider} không hợp lệ.`,
    });
  }
  throw new ConvexError({
    code: "provider_error",
    provider,
    model,
    status,
    message: `${provider} HTTP ${status}: ${errText.slice(0, 200)}`,
  });
}

export const gradeOpentextResponses = action({
  args: {
    activityId: v.id("activities"),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    graded: number;
    skipped: number;
    modelUsed: string;
    providerUsed: Provider;
  }> => {
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

    const apiKey = args.apiKey?.trim();
    if (!apiKey) {
      throw new ConvexError({
        code: "no_key",
        provider,
        model,
        message: `Chưa có API key ${provider}. Mở ⚙️ Cài đặt → 🔑 API key để nhập.`,
      });
    }

    // Fetch activity + responses
    const activity: Doc<"activities"> | null = await ctx.runQuery(
      internal.gradingData.getActivity,
      { activityId: args.activityId }
    );
    if (!activity) {
      throw new ConvexError({ code: "not_found", message: "Không tìm thấy hoạt động." });
    }
    if (activity.type !== "opentext") {
      throw new ConvexError({
        code: "wrong_type",
        message: `Chỉ chấm được hoạt động type "opentext", không phải "${activity.type}".`,
      });
    }

    const cfg = activity.config as { referenceAnswer?: string } | undefined;
    const reference = cfg?.referenceAnswer?.trim();
    if (!reference) {
      throw new ConvexError({
        code: "no_reference",
        message: "Activity này chưa có đáp án mẫu. Thêm field 'Đáp án mẫu' khi sửa hoạt động.",
      });
    }

    const responses: Doc<"responses">[] = await ctx.runQuery(
      internal.gradingData.listAnsweredResponses,
      { activityId: args.activityId }
    );

    // Chỉ chấm response có text + chưa được manual grade (tôn trọng override của GV)
    const toGrade = responses.filter((r) => {
      if (r.manualGrade) return false;
      const text = typeof r.value === "string" ? r.value.trim() : "";
      return text.length > 0;
    });

    if (toGrade.length === 0) {
      return { graded: 0, skipped: responses.length, modelUsed: model, providerUsed: provider };
    }

    // Build prompt: cho AI biết câu hỏi + đáp án mẫu + numbered list student answers
    const lines: string[] = [];
    lines.push("Bạn chấm bài cho giảng viên ĐH Việt Nam. Đánh giá từng câu trả lời của SV so với đáp án mẫu.");
    lines.push("");
    lines.push(`CÂU HỎI: ${activity.title}`);
    lines.push(`ĐÁP ÁN MẪU: ${reference}`);
    lines.push("");
    lines.push("CÁC CÂU TRẢ LỜI CỦA SV (numbered):");
    toGrade.forEach((r, i) => {
      const text = typeof r.value === "string" ? r.value.trim() : "";
      lines.push(`${i}. ${text}`);
    });
    lines.push("");
    lines.push("YÊU CẦU: Với mỗi câu, đánh giá:");
    lines.push("- 'correct': đúng đủ ý chính, dù diễn đạt khác.");
    lines.push("- 'partial': đúng 1 phần, thiếu ý quan trọng.");
    lines.push("- 'wrong': sai hoặc lạc đề.");
    lines.push("reason: 1 câu ngắn (<25 từ) giải thích bằng tiếng Việt.");
    lines.push("Trả về JSON: { \"grades\": [{ \"index\": <số>, \"grade\": \"correct\"|\"partial\"|\"wrong\", \"reason\": \"...\" }] }");

    const prompt = lines.join("\n");

    const rawGrades =
      provider === "gemini"
        ? await callGeminiGrade({ apiKey, model, prompt })
        : await callOpenAICompatGrade({ provider, apiKey, model, prompt });

    // Apply grades via mutation
    let saved = 0;
    for (const g of rawGrades) {
      if (typeof g.index !== "number") continue;
      if (g.index < 0 || g.index >= toGrade.length) continue;
      const grade = g.grade;
      if (grade !== "correct" && grade !== "partial" && grade !== "wrong") continue;
      const target = toGrade[g.index];
      await ctx.runMutation(internal.gradingData.applyGrade, {
        responseId: target._id,
        aiGrade: grade as "correct" | "partial" | "wrong",
        aiGradeReason: typeof g.reason === "string" ? g.reason.trim().slice(0, 300) : "",
        aiGradeModel: `${provider}/${model}`,
      });
      saved++;
    }

    return {
      graded: saved,
      skipped: responses.length - toGrade.length,
      modelUsed: model,
      providerUsed: provider,
    };
  },
});
