// Danh sách model AI dùng chung cho mọi modal (SessionSummaryModal,
// AiGenFromPdfModal, SurveyAiGenModal, OpentextGradingModal, SmartInsightsModal).
// Whitelist phải khớp ALLOWED_MODELS_BY_PROVIDER trong convex/ai.ts.

export type Provider =
  | "gemini"
  | "deepseek"
  | "openrouter"
  | "groq"
  | "cerebras"
  | "github"
  | "mistral"
  | "together";

export type ModelDef = {
  id: string;
  provider: Provider;
  label: string;
  hint: string;
};

export const MODELS: ModelDef[] = [
  // ─── Groq (free, cực nhanh) ───
  { id: "llama-3.3-70b-versatile", provider: "groq", label: "Llama 3.3 70B Versatile", hint: "Groq · free · ~600 tok/s" },
  { id: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant", hint: "Groq · nhanh, dùng cho task đơn giản" },
  { id: "llama-3.2-90b-vision-preview", provider: "groq", label: "Llama 3.2 90B Vision", hint: "Groq · hỗ trợ ảnh" },
  { id: "mixtral-8x7b-32768", provider: "groq", label: "Mixtral 8x7B", hint: "Groq · context 32K" },
  { id: "gemma2-9b-it", provider: "groq", label: "Gemma 2 9B", hint: "Groq · Google open" },
  { id: "deepseek-r1-distill-llama-70b", provider: "groq", label: "DeepSeek R1 Distill 70B", hint: "Groq · reasoning" },

  // ─── Cerebras (free, fastest inference) ───
  { id: "llama-4-scout-17b-16e-instruct", provider: "cerebras", label: "Llama 4 Scout 17B", hint: "Cerebras · ~2500 tok/s, model mới nhất" },
  { id: "llama-3.3-70b", provider: "cerebras", label: "Llama 3.3 70B", hint: "Cerebras · cực nhanh" },
  { id: "llama3.1-8b", provider: "cerebras", label: "Llama 3.1 8B", hint: "Cerebras · nhanh nhất" },
  { id: "qwen-3-32b", provider: "cerebras", label: "Qwen 3 32B", hint: "Cerebras · Alibaba" },

  // ─── GitHub Models (free với GitHub PAT) ───
  { id: "gpt-4o-mini", provider: "github", label: "GPT-4o Mini", hint: "GitHub · OpenAI · free, quota tốt" },
  { id: "gpt-4o", provider: "github", label: "GPT-4o", hint: "GitHub · OpenAI · quota thấp hơn 4o-mini" },
  { id: "Llama-3.3-70B-Instruct", provider: "github", label: "Llama 3.3 70B", hint: "GitHub · Meta" },
  { id: "Phi-3.5-mini-instruct", provider: "github", label: "Phi 3.5 Mini", hint: "GitHub · Microsoft small model" },
  { id: "Phi-3.5-MoE-instruct", provider: "github", label: "Phi 3.5 MoE", hint: "GitHub · Microsoft MoE" },
  { id: "Mistral-large-2407", provider: "github", label: "Mistral Large", hint: "GitHub · Mistral 123B" },
  { id: "Mistral-Nemo", provider: "github", label: "Mistral Nemo 12B", hint: "GitHub · nhanh" },
  { id: "Cohere-command-r-plus-08-2024", provider: "github", label: "Cohere Command R+", hint: "GitHub · 104B" },

  // ─── Gemini (free generous) ───
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash", hint: "Google · cân bằng, key free 1500 req/ngày" },
  { id: "gemini-2.5-flash-lite", provider: "gemini", label: "Gemini 2.5 Flash Lite", hint: "Google · quota cao nhất" },
  { id: "gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro", hint: "Google · thông minh nhất, quota thấp" },
  { id: "gemini-flash-latest", provider: "gemini", label: "Gemini Flash (latest)", hint: "Google · auto-route" },
  { id: "gemini-2.0-flash-lite", provider: "gemini", label: "Gemini 2.0 Flash Lite", hint: "Google · phiên bản cũ" },

  // ─── Mistral (free tier) ───
  { id: "mistral-large-latest", provider: "mistral", label: "Mistral Large", hint: "Mistral · best model" },
  { id: "mistral-small-latest", provider: "mistral", label: "Mistral Small", hint: "Mistral · cân bằng" },
  { id: "ministral-3b-latest", provider: "mistral", label: "Ministral 3B", hint: "Mistral · siêu nhanh" },
  { id: "ministral-8b-latest", provider: "mistral", label: "Ministral 8B", hint: "Mistral · cân bằng nhỏ" },
  { id: "open-mistral-nemo", provider: "mistral", label: "Mistral Nemo 12B", hint: "Mistral · open weights" },
  { id: "codestral-latest", provider: "mistral", label: "Codestral", hint: "Mistral · code-focused" },

  // ─── Together AI (model :free) ───
  { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", provider: "together", label: "Llama 3.3 70B Turbo", hint: "Together · free" },
  { id: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free", provider: "together", label: "DeepSeek R1 Distill 70B", hint: "Together · reasoning · free" },
  { id: "meta-llama/Llama-Vision-Free", provider: "together", label: "Llama Vision", hint: "Together · vision · free" },

  // ─── OpenRouter (aggregator, model :free) ───
  { id: "deepseek/deepseek-v4-flash:free", provider: "openrouter", label: "DeepSeek V4 Flash", hint: "OpenRouter · context 1M" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", provider: "openrouter", label: "Llama 3.3 70B", hint: "OpenRouter · ổn định" },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", provider: "openrouter", label: "Qwen3 Next 80B", hint: "OpenRouter · context 256K" },
  { id: "qwen/qwen3-coder:free", provider: "openrouter", label: "Qwen3 Coder 480B", hint: "OpenRouter · context 1M" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", provider: "openrouter", label: "Nemotron 3 Super 120B", hint: "OpenRouter · NVIDIA" },
  { id: "google/gemma-4-31b-it:free", provider: "openrouter", label: "Gemma 4 31B", hint: "OpenRouter · Google" },
  { id: "openai/gpt-oss-120b:free", provider: "openrouter", label: "GPT-OSS 120B", hint: "OpenRouter · OpenAI open" },
  { id: "z-ai/glm-4.5-air:free", provider: "openrouter", label: "GLM 4.5 Air", hint: "OpenRouter · Zhipu" },

  // ─── DeepSeek direct (trả phí) ───
  { id: "deepseek-chat", provider: "deepseek", label: "DeepSeek Chat", hint: "DeepSeek · cần nạp ≥ $2" },
  { id: "deepseek-reasoner", provider: "deepseek", label: "DeepSeek Reasoner", hint: "DeepSeek · reasoning, cần balance" },
];

export const PROVIDER_INFO: Record<Provider, { label: string }> = {
  groq: { label: "Groq (free, nhanh)" },
  cerebras: { label: "Cerebras (free, cực nhanh)" },
  github: { label: "GitHub Models (free)" },
  gemini: { label: "Google Gemini (free)" },
  mistral: { label: "Mistral AI (free)" },
  together: { label: "Together AI (free)" },
  openrouter: { label: "OpenRouter (free aggregator)" },
  deepseek: { label: "DeepSeek (trả phí)" },
};

export const PROVIDER_ORDER: Provider[] = [
  "groq",
  "cerebras",
  "github",
  "gemini",
  "mistral",
  "together",
  "openrouter",
  "deepseek",
];

// ============================================================================
// Helper hook: lấy API key của provider hiện tại từ Convex DB
// Fallback localStorage (legacy) trong giai đoạn transition.
// ============================================================================
// Note: import từ "convex/react" + "@/convex/_generated/api" CHỈ khi dùng hook.
// Để file aiModels.ts pure data (no React deps), hook ở file riêng useAiKey.ts.
