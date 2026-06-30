// Export KHẢO SÁT: Excel (.xlsx) + PDF (báo cáo in, font tiếng Việt chuẩn).
//
// PDF dùng cửa sổ in của trình duyệt (HTML + CSS) thay vì jsPDF → tiếng Việt
// hiển thị đúng 100%, biểu đồ vẽ bằng CSS, người dùng chọn "Lưu thành PDF".

import * as XLSX from "xlsx";
import {
  type SurveyConfig,
  type SurveyResults,
  type SurveyAnswer,
  flattenQuestions,
  answerToText,
  questionTypeLabel,
} from "./survey";
import type { SurveyAnalysis } from "./surveyAiClient";

export type SurveyExportRespondent = {
  studentCode?: string | null;
  fullName?: string;
  className?: string;
  answers: Record<string, SurveyAnswer>;
  submittedAt?: number;
};

export type SurveyExportOptions = {
  includeSummary: boolean;
  includeCharts: boolean;
  includeAnalysis: boolean;
  includeRawTable: boolean;
  includeOpenText: boolean;
};

export const DEFAULT_EXPORT_OPTIONS: SurveyExportOptions = {
  includeSummary: true,
  includeCharts: true,
  includeAnalysis: true,
  includeRawTable: true,
  includeOpenText: true,
};

function safeName(s: string): string {
  return (s || "khao-sat").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
}

function dateStr(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

// ============================ EXCEL ============================
export function exportSurveyExcel(args: {
  surveyTitle: string;
  config: SurveyConfig;
  results: SurveyResults;
  respondents: SurveyExportRespondent[];
  analysis?: SurveyAnalysis | null;
  hasIdentity: boolean;
}) {
  const { surveyTitle, config, results, respondents, analysis, hasIdentity } = args;
  const questions = flattenQuestions(config);
  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Tổng hợp theo câu ---
  const summaryRows: Record<string, string | number>[] = [];
  for (const qs of results.questions) {
    if (qs.options) {
      qs.options.forEach((o) => {
        summaryRows.push({
          "Câu hỏi": qs.title,
          Loại: questionTypeLabel(qs.type),
          "Phương án": o.text,
          "Số chọn": o.count,
          "Tỉ lệ %": o.pct,
        });
      });
    } else if (qs.average !== undefined) {
      summaryRows.push({
        "Câu hỏi": qs.title,
        Loại: questionTypeLabel(qs.type),
        "Phương án": qs.nps ? `Điểm NPS ${qs.nps.score}` : "Trung bình",
        "Số chọn": qs.answeredCount,
        "Tỉ lệ %": qs.average,
      });
      (qs.distribution ?? []).forEach((d) => {
        summaryRows.push({
          "Câu hỏi": "",
          Loại: "",
          "Phương án": `Mức ${d.value}`,
          "Số chọn": d.count,
          "Tỉ lệ %": qs.answeredCount > 0 ? Math.round((d.count / qs.answeredCount) * 100) : 0,
        });
      });
    } else {
      summaryRows.push({
        "Câu hỏi": qs.title,
        Loại: questionTypeLabel(qs.type),
        "Phương án": "(tự luận)",
        "Số chọn": qs.answeredCount,
        "Tỉ lệ %": "",
      });
    }
  }
  const ws1 = XLSX.utils.json_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 40 }, { wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Tổng hợp");

  // --- Sheet 2: Dữ liệu thô (mỗi người 1 dòng) ---
  const rawRows = respondents.map((r, i) => {
    const row: Record<string, string | number> = { STT: i + 1 };
    if (hasIdentity) {
      row["Mã SV"] = r.studentCode ?? "";
      row["Họ tên"] = r.fullName ?? "";
      row["Lớp"] = r.className ?? "";
    }
    questions.forEach((q, qi) => {
      row[`C${qi + 1}. ${q.title}`.slice(0, 80)] = answerToText(q, r.answers[q.id]);
    });
    if (r.submittedAt) row["Thời điểm"] = new Date(r.submittedAt).toLocaleString("vi-VN");
    return row;
  });
  const ws2 = XLSX.utils.json_to_sheet(rawRows.length ? rawRows : [{ "Chưa có": "phản hồi" }]);
  XLSX.utils.book_append_sheet(wb, ws2, "Dữ liệu thô");

  // --- Sheet 3: Phân tích AI (nếu có) ---
  if (analysis) {
    const aRows: Record<string, string>[] = [];
    aRows.push({ Mục: "Tổng quan", "Nội dung": analysis.overview });
    if (analysis.sentiment) aRows.push({ Mục: "Cảm nhận chung", "Nội dung": analysis.sentiment });
    analysis.strengths.forEach((s) => aRows.push({ Mục: "Điểm mạnh", "Nội dung": s }));
    analysis.weaknesses.forEach((s) => aRows.push({ Mục: "Cần cải thiện", "Nội dung": s }));
    analysis.perQuestion.forEach((p) => aRows.push({ Mục: `Câu: ${p.title}`, "Nội dung": p.insight }));
    analysis.suggestions.forEach((s) => aRows.push({ Mục: "Gợi ý", "Nội dung": s }));
    const ws3 = XLSX.utils.json_to_sheet(aRows);
    ws3["!cols"] = [{ wch: 24 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Phân tích");
  }

  // --- Sheet 4: Thông tin ---
  const meta = [
    { "Thông tin": "Tên khảo sát", "Giá trị": surveyTitle },
    { "Thông tin": "Số người trả lời", "Giá trị": String(results.totalRespondents) },
    { "Thông tin": "Số câu hỏi", "Giá trị": String(questions.length) },
    { "Thông tin": "Ngày xuất", "Giá trị": new Date().toLocaleString("vi-VN") },
  ];
  const ws4 = XLSX.utils.json_to_sheet(meta);
  ws4["!cols"] = [{ wch: 22 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Thông tin");

  XLSX.writeFile(wb, `KhaoSat_${safeName(surveyTitle)}_${dateStr()}.xlsx`);
}

// ============================ PDF (print) ============================
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function barRow(label: string, count: number, pct: number, accent = "#10b981"): string {
  return `<div class="bar">
    <div class="bar-label">${esc(label)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, pct)}%;background:${accent}"></div></div>
    <div class="bar-val">${count} · ${pct}%</div>
  </div>`;
}

function questionBlockHtml(qs: SurveyResults["questions"][number], opts: SurveyExportOptions, idx: number): string {
  let inner = "";
  if (qs.options && opts.includeCharts) {
    inner = qs.options.map((o) => barRow(o.text, o.count, o.pct)).join("");
    if (qs.otherTexts?.length && opts.includeOpenText) {
      inner += `<div class="texts"><b>Khác:</b> ${qs.otherTexts.map(esc).join(" • ")}</div>`;
    }
  } else if (qs.average !== undefined) {
    inner += `<div class="avg">TB <b>${qs.average}</b>/${qs.scaleMax ?? 5}${
      qs.nps ? ` · NPS <b>${qs.nps.score}</b>` : ""
    } · ${qs.answeredCount} trả lời</div>`;
    if (opts.includeCharts && qs.distribution) {
      const max = Math.max(1, ...qs.distribution.map((d) => d.count));
      inner += qs.distribution
        .map((d) => barRow(`Mức ${d.value}`, d.count, Math.round((d.count / max) * 100)))
        .join("");
    }
  } else if (qs.texts && opts.includeOpenText) {
    inner = `<ul class="texts">${qs.texts.slice(0, 40).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  }
  if (!inner) inner = `<div class="muted">${qs.answeredCount} trả lời</div>`;
  return `<div class="q">
    <div class="q-title">${idx}. ${esc(qs.title)} <span class="q-type">${esc(questionTypeLabel(qs.type))}</span></div>
    ${inner}
  </div>`;
}

export function buildSurveyReportHtml(args: {
  surveyTitle: string;
  results: SurveyResults;
  analysis?: SurveyAnalysis | null;
  options: SurveyExportOptions;
}): string {
  const { surveyTitle, results, analysis, options } = args;
  const sentimentLabel = analysis?.sentiment === "positive"
    ? "Tích cực" : analysis?.sentiment === "negative" ? "Tiêu cực" : analysis?.sentiment === "mixed" ? "Trái chiều" : "";

  const analysisHtml = options.includeAnalysis && analysis
    ? `<section class="analysis">
        <h2>Phân tích</h2>
        <p class="overview">${esc(analysis.overview)}</p>
        ${sentimentLabel ? `<p class="muted">Cảm nhận chung: <b>${esc(sentimentLabel)}</b></p>` : ""}
        ${analysis.strengths.length ? `<h3>✓ Điểm mạnh</h3><ul>${analysis.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        ${analysis.weaknesses.length ? `<h3>! Cần cải thiện</h3><ul>${analysis.weaknesses.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        ${analysis.suggestions.length ? `<h3>→ Gợi ý</h3><ul>${analysis.suggestions.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      </section>`
    : "";

  const summaryHtml = options.includeSummary
    ? `<section><h2>Kết quả theo câu hỏi</h2>${results.questions
        .map((qs, i) => questionBlockHtml(qs, options, i + 1))
        .join("")}</section>`
    : "";

  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${esc(surveyTitle)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #18181b; margin: 32px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 10px; border-bottom: 2px solid #10b981; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 12px 0 4px; color: #3f3f46; }
  .meta { color: #71717a; font-size: 13px; margin-bottom: 8px; }
  .muted { color: #71717a; font-size: 12px; }
  .q { break-inside: avoid; margin: 14px 0; padding: 12px 14px; border: 1px solid #e4e4e7; border-radius: 10px; }
  .q-title { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
  .q-type { font-weight: 400; font-size: 11px; color: #a1a1aa; border: 1px solid #e4e4e7; border-radius: 6px; padding: 1px 6px; }
  .bar { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; }
  .bar-label { width: 40%; }
  .bar-track { flex: 1; height: 14px; background: #f4f4f5; border-radius: 7px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 7px; }
  .bar-val { width: 70px; text-align: right; color: #52525b; }
  .avg { font-size: 13px; margin-bottom: 6px; }
  .texts { font-size: 12px; color: #3f3f46; }
  .texts li { margin: 2px 0; }
  ul { margin: 4px 0; padding-left: 18px; }
  li { font-size: 13px; margin: 3px 0; }
  .overview { font-size: 13px; }
  .analysis { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 4px 16px 12px; }
  @media print { body { margin: 12mm; } .no-print { display: none; } }
</style></head><body>
  <h1>${esc(surveyTitle)}</h1>
  <div class="meta">${results.totalRespondents} người trả lời · ${results.questions.length} câu hỏi · Xuất ${new Date().toLocaleString("vi-VN")}</div>
  ${analysisHtml}
  ${summaryHtml}
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`;
}

export function exportSurveyPdf(args: {
  surveyTitle: string;
  results: SurveyResults;
  analysis?: SurveyAnalysis | null;
  options: SurveyExportOptions;
}): boolean {
  const html = buildSurveyReportHtml(args);
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
