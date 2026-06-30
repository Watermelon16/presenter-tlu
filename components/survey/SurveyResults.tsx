"use client";

// Kết quả KHẢO SÁT (phía giảng viên): thống kê per câu + biểu đồ, phân tích AI,
// và export Excel/PDF (chọn nội dung). Mở dạng modal cuộn dọc.

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PollBarChart, RatingBarChart, WordcloudBars } from "@/components/ResultCharts";
import { aggregateWordCloud } from "@/lib/wordcloud";
import {
  type SurveyConfig,
  type SurveyAnswer,
  type SurveyQuestionStat,
  aggregateSurvey,
  questionTypeLabel,
} from "@/lib/survey";
import { runSurveyAnalysis, type SurveyAnalysis } from "@/lib/surveyAiClient";
import {
  exportSurveyExcel,
  exportSurveyPdf,
  type SurveyExportOptions,
  DEFAULT_EXPORT_OPTIONS,
} from "@/lib/surveyExport";
import { MODELS, type Provider } from "@/lib/aiModels";

const MODEL_KEY = "ai_gen_model_v1";
const KEY_PREFIX = "ai_gen_apikey_";
function loadKey(p: Provider): string {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(KEY_PREFIX + p) || ""; } catch { return ""; }
}

interface Props {
  activityId: Id<"activities">;
  surveyTitle: string;
  onClose: () => void;
}

export function SurveyResults({ activityId, surveyTitle, onClose }: Props) {
  const data = useQuery(api.responses.getSurveyResponses, { activityId });
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);

  const config = (data?.config ?? null) as SurveyConfig | null;
  const results = useMemo(() => {
    if (!config || !data) return null;
    return aggregateSurvey(
      config,
      data.responses as Array<{ answers?: Record<string, SurveyAnswer> }>,
      aggregateWordCloud
    );
  }, [config, data]);

  // AI analysis
  const [analysis, setAnalysis] = useState<SurveyAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [model, setModel] = useState<string>(() => {
    if (typeof window === "undefined") return MODELS[0].id;
    try { const s = localStorage.getItem(MODEL_KEY); if (s && MODELS.some((m) => m.id === s)) return s; } catch {}
    return MODELS[0].id;
  });
  const modelDef = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const provider = modelDef.provider;
  const key = ((dbKeys ?? {})[provider] ?? "") || loadKey(provider);

  // Export options
  const [showExport, setShowExport] = useState(false);
  const [exportOpts, setExportOpts] = useState<SurveyExportOptions>(DEFAULT_EXPORT_OPTIONS);

  const handleAnalyze = async () => {
    if (!config || !results) return;
    if (results.totalRespondents === 0) { toast.error("Chưa có phản hồi để phân tích"); return; }
    if (!key) { toast.error(`Cần API key ${provider} — mở ⚙️ Cài đặt → 🔑 API key`); return; }
    setAnalyzing(true);
    try {
      const { analysis: a } = await runSurveyAnalysis({
        surveyTitle, results, config, provider, model, apiKey: key,
      });
      setAnalysis(a);
      toast.success("Đã phân tích khảo sát");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi phân tích", { duration: 8000 });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExcel = () => {
    if (!config || !results || !data) return;
    exportSurveyExcel({
      surveyTitle,
      config,
      results,
      respondents: data.responses as unknown as Parameters<typeof exportSurveyExcel>[0]["respondents"],
      analysis,
      hasIdentity: data.requiresStudentCode,
    });
    toast.success("Đã xuất Excel");
  };

  const handlePdf = () => {
    if (!config || !results) return;
    const ok = exportSurveyPdf({ surveyTitle, results, analysis, options: exportOpts });
    if (!ok) toast.error("Trình duyệt chặn cửa sổ in — cho phép pop-up rồi thử lại.");
    setShowExport(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-3 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-zinc-50 rounded-2xl shadow-xl w-full max-w-3xl my-4 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="px-5 py-3 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0 gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">📊 {surveyTitle}</h2>
            <p className="text-xs text-zinc-500">
              {results ? `${results.totalRespondents} người trả lời` : "Đang tải…"}
              {data && data.totalNoResponse > 0 ? ` · ${data.totalNoResponse} chưa trả lời` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none px-1 shrink-0">✕</button>
        </div>

        {/* toolbar */}
        <div className="px-5 py-2.5 border-b border-zinc-100 bg-white flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); try { localStorage.setItem(MODEL_KEY, e.target.value); } catch {} }}
            className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300 max-w-[180px]"
          >
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={handleAnalyze} disabled={analyzing || !results?.totalRespondents}>
            {analyzing ? "Đang phân tích…" : "🧠 Phân tích AI"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExcel} disabled={!results}>📗 Excel</Button>
            <Button size="sm" variant="outline" onClick={() => setShowExport((v) => !v)} disabled={!results}>📕 PDF</Button>
          </div>
        </div>

        {/* export options */}
        {showExport && (
          <div className="px-5 py-3 border-b border-zinc-100 bg-amber-50/50 shrink-0">
            <div className="text-xs font-medium text-zinc-700 mb-2">Chọn nội dung xuất PDF:</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              <ExportCheck label="Thống kê per câu" k="includeSummary" opts={exportOpts} set={setExportOpts} />
              <ExportCheck label="Biểu đồ" k="includeCharts" opts={exportOpts} set={setExportOpts} />
              <ExportCheck label="Phân tích AI" k="includeAnalysis" opts={exportOpts} set={setExportOpts} />
              <ExportCheck label="Câu tự luận" k="includeOpenText" opts={exportOpts} set={setExportOpts} />
            </div>
            {exportOpts.includeAnalysis && !analysis && (
              <p className="text-[11px] text-amber-700 mt-1.5">Chưa có phân tích AI — bấm “🧠 Phân tích AI” trước nếu muốn kèm.</p>
            )}
            <div className="mt-2.5">
              <Button size="sm" onClick={handlePdf}>📕 Mở bản in PDF</Button>
            </div>
          </div>
        )}

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!data && <div className="text-center text-sm text-zinc-400 py-10">Đang tải kết quả…</div>}
          {data && results?.totalRespondents === 0 && (
            <div className="text-center text-sm text-zinc-400 py-10">Chưa có sinh viên nào trả lời.</div>
          )}

          {analysis && <AnalysisCard analysis={analysis} />}

          {results && results.questions.map((qs, i) => (
            <QuestionResultCard key={qs.id} stat={qs} index={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ExportCheck({
  label, k, opts, set,
}: {
  label: string;
  k: keyof SurveyExportOptions;
  opts: SurveyExportOptions;
  set: React.Dispatch<React.SetStateAction<SurveyExportOptions>>;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={opts[k]} onChange={(e) => set((o) => ({ ...o, [k]: e.target.checked }))} />
      {label}
    </label>
  );
}

function AnalysisCard({ analysis }: { analysis: SurveyAnalysis }) {
  const tone = analysis.sentiment === "positive" ? "bg-emerald-50 border-emerald-200"
    : analysis.sentiment === "negative" ? "bg-rose-50 border-rose-200"
    : "bg-violet-50 border-violet-200";
  return (
    <div className={`border rounded-xl p-4 ${tone}`}>
      <h3 className="font-semibold text-zinc-900 mb-1.5">🧠 Phân tích</h3>
      <p className="text-sm text-zinc-800">{analysis.overview}</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        {analysis.strengths.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-emerald-700 mb-1">✓ Điểm mạnh</div>
            <ul className="text-sm text-zinc-700 space-y-0.5 list-disc list-inside">
              {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
        {analysis.weaknesses.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-rose-700 mb-1">! Cần cải thiện</div>
            <ul className="text-sm text-zinc-700 space-y-0.5 list-disc list-inside">
              {analysis.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
      </div>
      {analysis.suggestions.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-zinc-700 mb-1">→ Gợi ý</div>
          <ul className="text-sm text-zinc-700 space-y-0.5 list-disc list-inside">
            {analysis.suggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuestionResultCard({ stat, index }: { stat: SurveyQuestionStat; index: number }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-medium text-zinc-900">
          <span className="text-zinc-400 mr-1">{index}.</span>
          {stat.title}
        </p>
        <span className="shrink-0 text-[11px] text-zinc-400 border border-zinc-200 rounded px-1.5 py-0.5">
          {questionTypeLabel(stat.type)} · {stat.answeredCount}
        </span>
      </div>

      {stat.answeredCount === 0 ? (
        <p className="text-sm text-zinc-400">Chưa có trả lời.</p>
      ) : stat.options ? (
        <PollBarChart
          options={stat.options.map((o) => ({ id: o.id, text: o.text, voteCount: o.count }))}
          totalVotes={stat.answeredCount}
          height={Math.max(140, stat.options.length * 42)}
        />
      ) : stat.average !== undefined && stat.distribution ? (
        <div>
          {stat.nps && (
            <div className="mb-2 flex items-center gap-3 text-sm">
              <span className="text-2xl font-bold text-violet-700 tabular-nums">{stat.nps.score}</span>
              <span className="text-xs text-zinc-500">
                NPS · Khuyến nghị {stat.nps.promoters} · Trung lập {stat.nps.passives} · Phê phán {stat.nps.detractors}
              </span>
            </div>
          )}
          <RatingBarChart
            responses={stat.distribution.flatMap((d) => Array<number>(d.count).fill(d.value))}
            min={stat.scaleMin ?? 1}
            max={stat.scaleMax ?? 5}
            height={200}
          />
        </div>
      ) : stat.words && stat.words.length > 0 ? (
        <WordcloudBars words={stat.words.map((w) => ({ text: w.word, count: w.count }))} maxItems={12} />
      ) : stat.texts ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {stat.texts.map((t, i) => (
            <div key={i} className="text-sm text-zinc-700 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2">
              {t}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">—</p>
      )}
    </div>
  );
}
