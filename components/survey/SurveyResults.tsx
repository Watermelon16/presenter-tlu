"use client";

// Kết quả KHẢO SÁT (phía giảng viên). Trình bày THEO BẢN CHẤT từng loại câu:
//   - Gộp được (chọn 1/nhiều/danh sách, Likert/sao/NPS, từ khoá) → biểu đồ + %/TB.
//   - Dữ liệu riêng từng SV (trả lời ngắn/đoạn văn) → BẢNG: STT · Mã SV · Họ tên · Trả lời.
// Có 2 chế độ xem: "Theo câu hỏi" và "Theo sinh viên" (mỗi SV 1 hàng × các câu).
// Kèm phân tích AI + export Excel/PDF (chọn nội dung).

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PollBarChart, RatingBarChart, WordcloudBars } from "@/components/ResultCharts";
import { aggregateWordCloud } from "@/lib/wordcloud";
import {
  type SurveyConfig,
  type SurveyAnswer,
  type SurveyQuestion,
  type SurveyQuestionStat,
  aggregateSurvey,
  flattenQuestions,
  answerToText,
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

type Respondent = {
  studentCode: string | null;
  fullName: string;
  className: string;
  answers: Record<string, SurveyAnswer>;
  submittedAt: number;
};

interface Props {
  activityId: Id<"activities">;
  surveyTitle: string;
  onClose: () => void;
}

export function SurveyResults({ activityId, surveyTitle, onClose }: Props) {
  const data = useQuery(api.responses.getSurveyResponses, { activityId });
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);

  const config = (data?.config ?? null) as SurveyConfig | null;
  const questions = useMemo(() => flattenQuestions(config), [config]);
  const respondents = useMemo(() => (data?.responses ?? []) as Respondent[], [data]);
  const hasIdentity = data?.requiresStudentCode ?? false;

  const results = useMemo(() => {
    if (!config || !data) return null;
    return aggregateSurvey(
      config,
      respondents,
      aggregateWordCloud
    );
  }, [config, data, respondents]);

  const [view, setView] = useState<"byQuestion" | "byStudent" | "progress">("byQuestion");

  // Tiến độ "Đã/Chưa làm" (chỉ tải khi mở tab) + nhắc SV chưa nộp
  const participation = useQuery(
    api.responses.getSurveyParticipation,
    view === "progress" ? { activityId } : "skip"
  );
  const remind = useMutation(api.responses.remindSurveyNonResponders);
  const [reminding, setReminding] = useState(false);
  const handleRemind = async () => {
    setReminding(true);
    try {
      const r = await remind({ activityId });
      toast.success(
        r.reminded > 0
          ? `Đã gửi nhắc tới ${r.reminded} SV chưa làm`
          : "Không có SV nào để nhắc (chưa ai bật thông báo, hoặc tất cả đã làm)"
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi gửi nhắc");
    } finally {
      setReminding(false);
    }
  };

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
      hasIdentity,
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
        className="bg-zinc-50 rounded-2xl shadow-xl w-full max-w-4xl my-4 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
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
          {/* view toggle */}
          <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden text-xs">
            <button
              onClick={() => setView("byQuestion")}
              className={`px-3 py-1.5 ${view === "byQuestion" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"}`}
            >
              Theo câu hỏi
            </button>
            <button
              onClick={() => setView("byStudent")}
              className={`px-3 py-1.5 border-l border-zinc-200 ${view === "byStudent" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"}`}
            >
              Theo sinh viên
            </button>
            {hasIdentity && (
              <button
                onClick={() => setView("progress")}
                className={`px-3 py-1.5 border-l border-zinc-200 ${view === "progress" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"}`}
              >
                Tiến độ
              </button>
            )}
          </div>

          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); try { localStorage.setItem(MODEL_KEY, e.target.value); } catch {} }}
            className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300 max-w-[150px]"
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
            <p className="text-[11px] text-zinc-500 mt-1.5">Cần dữ liệu chi tiết từng SV (SĐT, email…) → dùng <b>📗 Excel</b> (sheet “Dữ liệu thô”).</p>
            <div className="mt-2.5">
              <Button size="sm" onClick={handlePdf}>📕 Mở bản in PDF</Button>
            </div>
          </div>
        )}

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!data && <div className="text-center text-sm text-zinc-400 py-10">Đang tải kết quả…</div>}
          {data && results?.totalRespondents === 0 && view !== "progress" && (
            <div className="text-center text-sm text-zinc-400 py-10">Chưa có sinh viên nào trả lời.</div>
          )}

          {view === "progress" && <ProgressPanel data={participation} reminding={reminding} onRemind={handleRemind} />}

          {results && results.totalRespondents > 0 && view === "byQuestion" && (
            <>
              {analysis && <AnalysisCard analysis={analysis} />}
              {results.questions.map((qs, i) => {
                const q = questions.find((x) => x.id === qs.id);
                return (
                  <QuestionResultCard
                    key={qs.id}
                    stat={qs}
                    index={i + 1}
                    question={q}
                    respondents={respondents}
                    hasIdentity={hasIdentity}
                  />
                );
              })}
            </>
          )}

          {results && results.totalRespondents > 0 && view === "byStudent" && (
            <RespondentTable questions={questions} respondents={respondents} hasIdentity={hasIdentity} />
          )}
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

function QuestionResultCard({
  stat, index, question, respondents, hasIdentity,
}: {
  stat: SurveyQuestionStat;
  index: number;
  question?: SurveyQuestion;
  respondents: Respondent[];
  hasIdentity: boolean;
}) {
  const isText = stat.type === "short_text" || stat.type === "long_text";
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
      ) : isText && question ? (
        <AnswerTable question={question} respondents={respondents} hasIdentity={hasIdentity} />
      ) : stat.texts && stat.texts.length > 0 ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {stat.texts.map((t, i) => (
            <div key={i} className="text-sm text-zinc-700 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2">{t}</div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">—</p>
      )}
    </div>
  );
}

// Bảng câu trả lời cho 1 câu "dữ liệu riêng" (text): STT · [Mã SV · Họ tên] · Trả lời
function AnswerTable({
  question, respondents, hasIdentity,
}: {
  question: SurveyQuestion;
  respondents: Respondent[];
  hasIdentity: boolean;
}) {
  const [q, setQ] = useState("");
  const rows = respondents
    .map((r) => ({ r, text: answerToText(question, r.answers[question.id]) }))
    .filter((x) => x.text.trim());
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((x) =>
        x.text.toLowerCase().includes(needle) ||
        (x.r.fullName ?? "").toLowerCase().includes(needle) ||
        (x.r.studentCode ?? "").toLowerCase().includes(needle))
    : rows;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[11px] text-zinc-400">Mỗi SV một giá trị riêng — không tính %/trung bình.</span>
        {rows.length > 8 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm…"
            className="h-7 w-32 px-2 rounded-md border border-zinc-200 text-xs focus:outline-none focus:border-violet-400"
          />
        )}
      </div>
      <div className="max-h-72 overflow-auto border border-zinc-100 rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-zinc-50">
            <tr className="text-left text-[11px] text-zinc-500">
              <th className="px-2 py-1.5 w-8 font-medium">#</th>
              {hasIdentity && <th className="px-2 py-1.5 font-medium whitespace-nowrap">Mã SV</th>}
              {hasIdentity && <th className="px-2 py-1.5 font-medium whitespace-nowrap">Họ tên</th>}
              <th className="px-2 py-1.5 font-medium">Trả lời</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((x, i) => (
              <tr key={i} className="border-t border-zinc-100 align-top">
                <td className="px-2 py-1.5 text-zinc-400 tabular-nums">{i + 1}</td>
                {hasIdentity && <td className="px-2 py-1.5 text-zinc-600 whitespace-nowrap font-mono text-xs">{x.r.studentCode || "—"}</td>}
                {hasIdentity && <td className="px-2 py-1.5 text-zinc-700 whitespace-nowrap">{x.r.fullName || "—"}</td>}
                <td className="px-2 py-1.5 text-zinc-800 break-words">{x.text}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={hasIdentity ? 4 : 2} className="px-2 py-3 text-center text-zinc-400 text-xs">Không có kết quả khớp.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Bảng "Theo sinh viên": mỗi SV 1 hàng × tất cả câu (giống sheet Dữ liệu thô).
function RespondentTable({
  questions, respondents, hasIdentity,
}: {
  questions: SurveyQuestion[];
  respondents: Respondent[];
  hasIdentity: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? respondents.filter((r) =>
        (r.fullName ?? "").toLowerCase().includes(needle) ||
        (r.studentCode ?? "").toLowerCase().includes(needle) ||
        (r.className ?? "").toLowerCase().includes(needle))
    : respondents;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-xs text-zinc-500">{respondents.length} sinh viên · {questions.length} câu</span>
        {hasIdentity && respondents.length > 8 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm SV…"
            className="h-7 w-40 px-2 rounded-md border border-zinc-200 text-xs focus:outline-none focus:border-violet-400"
          />
        )}
      </div>
      <div className="max-h-[60vh] overflow-auto border border-zinc-100 rounded-lg">
        <table className="text-sm border-collapse">
          <thead className="sticky top-0 bg-zinc-50 z-10">
            <tr className="text-left text-[11px] text-zinc-500">
              <th className="px-2 py-1.5 w-8 font-medium sticky left-0 bg-zinc-50">#</th>
              {hasIdentity && <th className="px-2 py-1.5 font-medium whitespace-nowrap">Mã SV</th>}
              {hasIdentity && <th className="px-2 py-1.5 font-medium whitespace-nowrap">Họ tên</th>}
              {questions.map((qq, i) => (
                <th key={qq.id} className="px-2 py-1.5 font-medium whitespace-nowrap max-w-[220px] truncate" title={qq.title}>
                  C{i + 1}. {qq.title || "(không tên)"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className="border-t border-zinc-100 align-top hover:bg-zinc-50/50">
                <td className="px-2 py-1.5 text-zinc-400 tabular-nums sticky left-0 bg-white">{i + 1}</td>
                {hasIdentity && <td className="px-2 py-1.5 text-zinc-600 font-mono text-xs whitespace-nowrap">{r.studentCode || "—"}</td>}
                {hasIdentity && <td className="px-2 py-1.5 text-zinc-700 whitespace-nowrap">{r.fullName || "—"}</td>}
                {questions.map((qq) => {
                  const txt = answerToText(qq, r.answers[qq.id]);
                  return (
                    <td key={qq.id} className="px-2 py-1.5 text-zinc-800 max-w-[260px]">
                      <div className="line-clamp-3 break-words">{txt || <span className="text-zinc-300">—</span>}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={questions.length + (hasIdentity ? 3 : 1)} className="px-2 py-3 text-center text-zinc-400 text-xs">Không có kết quả khớp.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {!hasIdentity && (
        <p className="text-[11px] text-zinc-400 mt-1.5">Khảo sát ẩn danh — không có cột Mã SV/Họ tên. Bật “Gắn danh tính” khi tạo để theo dõi theo từng SV.</p>
      )}
    </div>
  );
}

// ---- Tiến độ "Đã / Chưa làm" + nhắc SV chưa nộp ----
type ProgressPerson = { studentCode: string; fullName: string; className: string; isGuest?: boolean; submittedAt?: number };
type ProgressData = {
  totalShould: number;
  doneCount: number;
  notDoneCount: number;
  anonymousCount: number;
  done: ProgressPerson[];
  notDone: ProgressPerson[];
};

function ProgressPanel({
  data, reminding, onRemind,
}: {
  data: ProgressData | null | undefined;
  reminding: boolean;
  onRemind: () => void;
}) {
  if (data === undefined) return <div className="text-center text-sm text-zinc-400 py-10">Đang tải tiến độ…</div>;
  if (data === null) return <div className="text-center text-sm text-zinc-400 py-10">Không có dữ liệu tiến độ.</div>;
  const pct = data.totalShould > 0 ? Math.round((data.doneCount / data.totalShould) * 100) : 0;
  return (
    <div className="space-y-3">
      <div className="bg-white border border-zinc-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="text-sm">
            <span className="text-2xl font-bold text-emerald-600 tabular-nums">{data.doneCount}</span>
            <span className="text-zinc-500"> / {data.totalShould} đã làm</span>
            {data.anonymousCount > 0 && <span className="text-xs text-zinc-400 ml-2">+ {data.anonymousCount} ẩn danh</span>}
          </div>
          <Button size="sm" variant="outline" onClick={onRemind} disabled={reminding || data.notDoneCount === 0}>
            {reminding ? "Đang nhắc…" : `🔔 Nhắc ${data.notDoneCount} SV chưa làm`}
          </Button>
        </div>
        <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-zinc-400 mt-1">Nhắc qua thông báo đẩy — chỉ tới SV đã bật thông báo trên thiết bị.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <PeopleList title={`Chưa làm (${data.notDoneCount})`} tone="rose" people={data.notDone} />
        <PeopleList title={`Đã làm (${data.doneCount})`} tone="emerald" people={data.done} showTime />
      </div>
      {data.totalShould === 0 && (
        <p className="text-xs text-zinc-500 text-center px-4">
          Chưa có danh sách lớp/SV để đối chiếu. Khi SV vào phòng hoặc có roster LMS, danh sách “chưa làm” sẽ hiện ở đây.
        </p>
      )}
    </div>
  );
}

function PeopleList({
  title, tone, people, showTime,
}: {
  title: string;
  tone: "rose" | "emerald";
  people: ProgressPerson[];
  showTime?: boolean;
}) {
  const head = tone === "rose" ? "text-rose-700" : "text-emerald-700";
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3">
      <div className={`text-xs font-semibold mb-2 ${head}`}>{title}</div>
      <div className="max-h-72 overflow-auto space-y-0.5">
        {people.length === 0 ? (
          <p className="text-xs text-zinc-400">—</p>
        ) : (
          people.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm border-b border-zinc-50 py-1">
              <span className="truncate min-w-0">
                <span className="font-mono text-xs text-zinc-500 mr-2">{p.studentCode}</span>
                {p.fullName || <span className="text-zinc-400">—</span>}
              </span>
              {showTime && p.submittedAt && (
                <span className="text-[10px] text-zinc-400 shrink-0">{new Date(p.submittedAt).toLocaleString("vi-VN")}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
