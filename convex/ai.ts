"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

/**
 * Generate gợi ý hoạt động từ text các slide PDF — gọi Google Gemini.
 *
 * Yêu cầu env var GEMINI_API_KEY (set qua `npx convex env set GEMINI_API_KEY ...`).
 * Free tier Gemini 2.0 Flash: ~1500 requests/ngày, đủ cho 1 lecturer.
 *
 * Lecturer extract text trên client (pdfjs đã có sẵn), gửi `pages` lên đây.
 * Action không lưu gì vào DB — chỉ trả về suggestions để client preview + edit.
 */
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
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY chưa được cấu hình. Chạy: npx convex env set GEMINI_API_KEY <key>"
      );
    }

    const maxSuggestions = Math.max(1, Math.min(args.maxSuggestions ?? 8, 20));

    // Bỏ trang trắng + chuẩn hoá whitespace
    const cleanPages = args.pages
      .map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text.replace(/\s+/g, " ").trim(),
      }))
      .filter((p) => p.text.length > 20);

    if (cleanPages.length === 0) {
      throw new Error(
        "Không trích xuất được text có nghĩa từ PDF. Có thể slide là ảnh scan — cần OCR trước."
      );
    }

    // Build context, truncate để tránh vượt token (Gemini Flash ~1M nhưng input lớn vẫn tốn quota)
    const MAX_CHARS = 60_000;
    let totalChars = 0;
    const pieces: string[] = [];
    for (const p of cleanPages) {
      const piece = `=== Trang ${p.pageNumber} ===\n${p.text}`;
      if (totalChars + piece.length > MAX_CHARS) {
        pieces.push("\n\n[...nội dung còn lại đã được cắt bớt do giới hạn token]");
        break;
      }
      pieces.push(piece);
      totalChars += piece.length;
    }
    const slidesText = pieces.join("\n\n");

    const titleHint = args.sessionTitle
      ? `Buổi giảng: "${args.sessionTitle}".`
      : "";

    const prompt = `Bạn là trợ lý giảng viên đại học Việt Nam. ${titleHint} Dưới đây là text trích xuất từ slide PDF. Hãy đề xuất ${maxSuggestions} hoạt động tương tác cho sinh viên, gắn với từng trang slide cụ thể, để tăng engagement và kiểm tra hiểu biết.

NỘI DUNG SLIDE:
${slidesText}

YÊU CẦU:
- Tiếng Việt học thuật, ngắn gọn, rõ ràng.
- Đa dạng loại hoạt động: pha trộn poll trắc nghiệm (có đáp án đúng), wordcloud (1-3 từ), opentext (câu ngắn).
- Mỗi suggestion gắn với 1 slidePage cụ thể (từ nội dung trang đó).
- Poll: 3-5 options, ngắn gọn. Nếu có đáp án đúng → isQuiz=true + correctOptionIndexes (0-based, có thể nhiều).
- Tránh câu hỏi quá dễ (định nghĩa hiển nhiên) hoặc quá khó (cần tính toán phức tạp).
- suggestedTimeLimit (phút): 1-3 cho poll/wordcloud, 2-5 cho opentext.
- reasoning: 1 câu ngắn giải thích vì sao chọn hoạt động này (để lecturer hiểu ý đồ).`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
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
                  type: {
                    type: "STRING",
                    enum: ["poll", "wordcloud", "opentext"],
                  },
                  title: { type: "STRING" },
                  options: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                  },
                  isQuiz: { type: "BOOLEAN" },
                  correctOptionIndexes: {
                    type: "ARRAY",
                    items: { type: "INTEGER" },
                  },
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Gemini API lỗi (${response.status}): ${errText.slice(0, 300)}`
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      throw new Error(
        `Gemini từ chối xử lý: ${data.promptFeedback.blockReason}`
      );
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      throw new Error("Gemini trả về dữ liệu rỗng. Thử lại sau.");
    }

    let parsed: { suggestions?: unknown };
    try {
      parsed = JSON.parse(textContent);
    } catch {
      throw new Error("Gemini trả về JSON không hợp lệ");
    }

    const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
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
            ? s.correctOptionIndexes.filter(
                (i) => typeof i === "number" && i >= 0
              )
            : [],
        suggestedTimeLimit:
          typeof s.suggestedTimeLimit === "number" && s.suggestedTimeLimit > 0
            ? Math.min(10, s.suggestedTimeLimit)
            : 2,
        reasoning:
          typeof s.reasoning === "string" ? s.reasoning.trim() : undefined,
      }));

    return {
      suggestions: cleaned,
      tokenUsage: data.usageMetadata ?? null,
      pagesProcessed: cleanPages.length,
    };
  },
});
