"use client";

// Trình tạo / sửa KHẢO SÁT (biểu mẫu gộp) — phía giảng viên.
// Hỗ trợ: soạn thủ công (mục + câu hỏi đa dạng), gợi ý bằng AI rồi chỉnh từng câu,
// xem trước đúng như SV thấy, lưu thành 1 activity type="survey".

import { useState, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VnInput, VnTextarea } from "@/components/VnInput";
import { SurveyQuestionEditor } from "./SurveyQuestionEditor";
import { SurveyForm } from "./SurveyForm";
import {
  type SurveyConfig,
  type SurveySection,
  type SurveyQuestion,
  type SurveyQuestionType,
  QUESTION_TYPE_META,
  newQuestion,
  newSection,
  defaultSurveyConfig,
  countQuestions,
} from "@/lib/survey";
import { generateSurveyForm } from "@/lib/surveyAiClient";
import { MODELS, type Provider } from "@/lib/aiModels";

const MODEL_KEY = "ai_gen_model_v1";
const KEY_PREFIX = "ai_gen_apikey_";

function loadKey(p: Provider): string {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(KEY_PREFIX + p) || ""; } catch { return ""; }
}

// epoch ms → chuỗi cho <input type="datetime-local"> (giờ địa phương)
function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ActivityLite = {
  _id: Id<"activities">;
  title: string;
  config: unknown;
  requiresStudentCode: boolean;
  timeLimit?: number;
  slideCue?: string;
};

interface Props {
  sessionId: Id<"sessions">;
  existingActivityCount: number;
  collectStudentCode: boolean;
  activity?: ActivityLite; // có = chế độ sửa
  onClose: () => void;
}

export function SurveyBuilder({
  sessionId,
  existingActivityCount,
  collectStudentCode,
  activity,
  onClose,
}: Props) {
  const isEdit = !!activity;
  const createActivity = useMutation(api.activities.createActivity);
  const updateActivity = useMutation(api.activities.updateActivity);
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);

  const [title, setTitle] = useState(activity?.title ?? "Khảo sát");
  const [config, setConfig] = useState<SurveyConfig>(() => {
    const c = activity?.config as SurveyConfig | undefined;
    if (c?.sections?.length) return c;
    return defaultSurveyConfig();
  });
  const [requiresStudentCode, setRequiresStudentCode] = useState(activity?.requiresStudentCode ?? false);
  const [timeLimit, setTimeLimit] = useState<string>(activity?.timeLimit ? String(activity.timeLimit) : "");
  const [slideCue, setSlideCue] = useState(activity?.slideCue ?? "");

  const initSurveyCfg = activity?.config as SurveyConfig | undefined;
  const [openMode, setOpenMode] = useState<"live" | "deadline">(
    initSurveyCfg?.openMode === "deadline" ? "deadline" : "live"
  );
  const [deadlineLocal, setDeadlineLocal] = useState<string>(
    initSurveyCfg?.deadline ? msToLocalInput(initSurveyCfg.deadline) : ""
  );
  const [allowEdit, setAllowEdit] = useState<boolean>(initSurveyCfg?.allowEdit !== false);

  const [showPreview, setShowPreview] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const qCount = useMemo(() => countQuestions(config), [config]);

  // ---- mutate config helpers ----
  const updateSection = (sid: string, patch: Partial<SurveySection>) =>
    setConfig((c) => ({ ...c, sections: c.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }));

  const addSection = () =>
    setConfig((c) => ({ ...c, sections: [...c.sections, newSection("")] }));

  const removeSection = (sid: string) =>
    setConfig((c) => ({
      ...c,
      sections: c.sections.length > 1 ? c.sections.filter((s) => s.id !== sid) : c.sections,
    }));

  const moveSection = (sid: string, dir: -1 | 1) =>
    setConfig((c) => {
      const i = c.sections.findIndex((s) => s.id === sid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.sections.length) return c;
      const next = [...c.sections];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...c, sections: next };
    });

  const addQuestion = (sid: string, type: SurveyQuestionType) =>
    setConfig((c) => ({
      ...c,
      sections: c.sections.map((s) =>
        s.id === sid ? { ...s, questions: [...s.questions, newQuestion(type, "")] } : s
      ),
    }));

  const updateQuestion = (sid: string, qid: string, patch: Partial<SurveyQuestion>) =>
    setConfig((c) => ({
      ...c,
      sections: c.sections.map((s) =>
        s.id === sid
          ? { ...s, questions: s.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) }
          : s
      ),
    }));

  const changeQuestionType = (sid: string, qid: string, type: SurveyQuestionType) =>
    setConfig((c) => ({
      ...c,
      sections: c.sections.map((s) =>
        s.id === sid
          ? {
              ...s,
              questions: s.questions.map((q) =>
                q.id === qid ? { ...newQuestion(type, q.title), id: q.id, description: q.description, required: q.required } : q
              ),
            }
          : s
      ),
    }));

  const duplicateQuestion = (sid: string, qid: string) =>
    setConfig((c) => ({
      ...c,
      sections: c.sections.map((s) => {
        if (s.id !== sid) return s;
        const i = s.questions.findIndex((q) => q.id === qid);
        if (i < 0) return s;
        const clone = { ...newQuestion(s.questions[i].type, s.questions[i].title), ...structuredClone(s.questions[i]), id: newQuestion(s.questions[i].type).id };
        const next = [...s.questions];
        next.splice(i + 1, 0, clone);
        return { ...s, questions: next };
      }),
    }));

  const deleteQuestion = (sid: string, qid: string) =>
    setConfig((c) => ({
      ...c,
      sections: c.sections.map((s) =>
        s.id === sid ? { ...s, questions: s.questions.filter((q) => q.id !== qid) } : s
      ),
    }));

  const moveQuestion = (sid: string, qid: string, dir: -1 | 1) =>
    setConfig((c) => ({
      ...c,
      sections: c.sections.map((s) => {
        if (s.id !== sid) return s;
        const i = s.questions.findIndex((q) => q.id === qid);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.questions.length) return s;
        const next = [...s.questions];
        [next[i], next[j]] = [next[j], next[i]];
        return { ...s, questions: next };
      }),
    }));

  // ---- save ----
  const handleSave = async () => {
    const cleaned: SurveyConfig = {
      intro: config.intro?.trim() || undefined,
      sections: config.sections
        .map((s) => ({
          ...s,
          title: s.title?.trim() || "",
          description: s.description?.trim() || undefined,
          questions: s.questions
            .map((q) => ({
              ...q,
              title: q.title.trim(),
              options: q.options?.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text),
            }))
            .filter((q) => q.title.length > 0),
        }))
        .filter((s) => s.questions.length > 0),
      openMode,
    };
    if (openMode === "deadline") {
      cleaned.deadline = deadlineLocal ? new Date(deadlineLocal).getTime() : undefined;
      cleaned.allowEdit = allowEdit;
      // giữ trạng thái mở/đóng hiện có (mặc định: đang nhận phản hồi)
      cleaned.acceptingResponses = initSurveyCfg?.acceptingResponses ?? true;
    }

    if (countQuestions(cleaned) === 0) {
      toast.error("Cần ít nhất 1 câu hỏi có nội dung");
      return;
    }
    if (!title.trim()) {
      toast.error("Đặt tên cho khảo sát");
      return;
    }
    if (requiresStudentCode && !collectStudentCode) {
      toast.error("Buổi đang tắt thu thập mã SV. Tắt 'Tính danh tính' hoặc bật trong cài đặt buổi.");
      return;
    }

    // Chế độ "mở đến hạn" dùng deadline, không dùng time limit của phiên live
    const tl = openMode === "deadline"
      ? undefined
      : timeLimit.trim() ? Math.max(0, Number(timeLimit)) : undefined;
    setSaving(true);
    try {
      if (isEdit && activity) {
        await updateActivity({
          activityId: activity._id,
          title: title.trim(),
          config: cleaned,
          requiresStudentCode,
          timeLimit: tl,
          slideCue: slideCue.trim() || undefined,
        });
        toast.success("Đã lưu khảo sát");
      } else {
        await createActivity({
          sessionId,
          type: "survey",
          title: title.trim(),
          config: cleaned,
          requiresStudentCode,
          timeLimit: tl && tl > 0 ? tl : undefined,
          order: existingActivityCount + 1,
          slideCue: slideCue.trim() || undefined,
        });
        toast.success(`Đã tạo khảo sát ${countQuestions(cleaned)} câu`);
      }
      onClose();
    } catch (e: unknown) {
      const msg =
        e instanceof ConvexError ? (e.data as { message?: string })?.message ?? "Lỗi" :
        e instanceof Error ? e.message : "Lỗi khi lưu";
      toast.error(msg);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-zinc-50 rounded-2xl shadow-xl w-full max-w-4xl my-4 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]">
        {/* header */}
        <div className="px-5 py-3 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0 gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">{isEdit ? "✏️ Sửa khảo sát" : "🗳 Tạo khảo sát"}</h2>
            <p className="text-xs text-zinc-500">{qCount} câu · {config.sections.length} mục · biểu mẫu SV điền 1 lần</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "← Soạn" : "👁 Xem trước"}
            </Button>
            <button onClick={onClose} disabled={saving} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 text-xl leading-none px-1">✕</button>
          </div>
        </div>

        {/* body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto">
          {showPreview ? (
            <div className="p-4 sm:p-6 max-w-2xl mx-auto">
              <div className="text-xs text-zinc-400 mb-3 text-center">— Xem trước như sinh viên thấy —</div>
              <h1 className="text-2xl font-semibold mb-4">{title}</h1>
              <SurveyForm config={config} readOnly />
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* settings */}
              <div className="bg-white border border-zinc-200 rounded-xl p-3 space-y-3">
                <VnInput
                  value={title}
                  onValueChange={setTitle}
                  placeholder="Tên khảo sát"
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-base font-medium focus:outline-none focus:border-violet-500"
                />
                <VnTextarea
                  value={config.intro ?? ""}
                  onValueChange={(v) => setConfig((c) => ({ ...c, intro: v }))}
                  placeholder="Lời dẫn đầu biểu mẫu (tuỳ chọn)"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-violet-400 resize-y"
                />

                {/* Chế độ trả lời: trực tiếp vs mở đến hạn */}
                <div className="rounded-lg border border-zinc-200 p-2.5 space-y-2">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-medium text-zinc-700">Chế độ:</span>
                    <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden text-xs">
                      <button type="button" onClick={() => setOpenMode("live")}
                        className={`px-3 py-1.5 ${openMode === "live" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"}`}>
                        ▶ Trực tiếp
                      </button>
                      <button type="button" onClick={() => setOpenMode("deadline")}
                        className={`px-3 py-1.5 border-l border-zinc-200 ${openMode === "deadline" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"}`}>
                        🗓 Mở đến hạn
                      </button>
                    </div>
                  </div>
                  {openMode === "live" ? (
                    <p className="text-[11px] text-zinc-500">GV kích hoạt → SV trả lời cùng lúc rồi đóng (như poll).</p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-zinc-500">
                        SV vào bằng <b>link/QR cố định</b> bất kỳ lúc nào trước hạn, nộp &amp; sửa được (kể cả SV vắng). Lấy QR ở thẻ hoạt động sau khi lưu.
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <label className="flex items-center gap-1.5 text-zinc-600">
                          Hạn nộp
                          <input type="datetime-local" value={deadlineLocal} onChange={(e) => setDeadlineLocal(e.target.value)}
                            className="h-8 px-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={allowEdit} onChange={(e) => setAllowEdit(e.target.checked)} />
                          Cho SV sửa bài trước hạn
                        </label>
                      </div>
                      {!deadlineLocal && <p className="text-[11px] text-amber-600">Chưa đặt hạn → mở đến khi GV bấm “Đóng nhận”.</p>}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  {openMode === "live" && (
                    <label className="flex items-center gap-1.5 text-zinc-600">
                      Thời gian (phút)
                      <Input
                        type="number" min={0} step={0.5} value={timeLimit}
                        onChange={(e) => setTimeLimit(e.target.value)}
                        placeholder="∞" className="w-20 h-8"
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox" checked={requiresStudentCode}
                      onChange={(e) => setRequiresStudentCode(e.target.checked)}
                      disabled={!collectStudentCode}
                    />
                    <span className={collectStudentCode ? "" : "text-zinc-400"}>Gắn danh tính (mã SV)</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-zinc-600">
                    Mốc slide
                    <VnInput value={slideCue} onValueChange={setSlideCue} placeholder="VD: Slide 12"
                      className="w-28 h-8 px-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
                  </label>
                  <button
                    onClick={() => setShowAi((v) => !v)}
                    className="ml-auto text-sm font-medium text-violet-700 hover:text-violet-900"
                  >
                    ✨ Gợi ý bằng AI
                  </button>
                </div>
                {showAi && (
                  <AiSeedPanel
                    dbKeys={dbKeys ?? {}}
                    onApply={(c, mode) => {
                      setConfig((prev) =>
                        mode === "replace"
                          ? c
                          : { intro: prev.intro || c.intro, sections: [...prev.sections, ...c.sections] }
                      );
                      setShowAi(false);
                      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
                    }}
                  />
                )}
              </div>

              {/* sections */}
              {config.sections.map((section, sIdx) => (
                <div key={section.id} className="bg-white border border-zinc-200 rounded-xl p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 w-7 h-7 grid place-items-center rounded-lg bg-violet-100 text-violet-700 text-sm font-semibold">
                      {sIdx + 1}
                    </span>
                    <VnInput
                      value={section.title ?? ""}
                      onValueChange={(v) => updateSection(section.id, { title: v })}
                      placeholder={`Tên mục ${sIdx + 1} (tuỳ chọn)`}
                      className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 text-sm font-medium focus:outline-none focus:border-violet-400"
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      <SmallBtn title="Lên" disabled={sIdx === 0} onClick={() => moveSection(section.id, -1)}>↑</SmallBtn>
                      <SmallBtn title="Xuống" disabled={sIdx === config.sections.length - 1} onClick={() => moveSection(section.id, 1)}>↓</SmallBtn>
                      <SmallBtn title="Xoá mục" disabled={config.sections.length <= 1} onClick={() => removeSection(section.id)} danger>✕</SmallBtn>
                    </div>
                  </div>
                  <VnInput
                    value={section.description ?? ""}
                    onValueChange={(v) => updateSection(section.id, { description: v })}
                    placeholder="Mô tả mục (tuỳ chọn)"
                    className="w-full px-3 py-1.5 rounded-lg border border-zinc-100 text-xs text-zinc-600 focus:outline-none focus:border-violet-300"
                  />

                  {section.questions.map((q, qIdx) => (
                    <SurveyQuestionEditor
                      key={q.id}
                      question={q}
                      index={qIdx + 1}
                      canMoveUp={qIdx > 0}
                      canMoveDown={qIdx < section.questions.length - 1}
                      onChange={(patch) => updateQuestion(section.id, q.id, patch)}
                      onChangeType={(t) => changeQuestionType(section.id, q.id, t)}
                      onDuplicate={() => duplicateQuestion(section.id, q.id)}
                      onDelete={() => deleteQuestion(section.id, q.id)}
                      onMoveUp={() => moveQuestion(section.id, q.id, -1)}
                      onMoveDown={() => moveQuestion(section.id, q.id, 1)}
                    />
                  ))}

                  <AddQuestionBar onAdd={(t) => addQuestion(section.id, t)} />
                </div>
              ))}

              <button
                onClick={addSection}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-violet-400 hover:text-violet-700 transition-colors"
              >
                + Thêm mục
              </button>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-zinc-200 bg-white flex justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>Huỷ</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu…" : isEdit ? "💾 Lưu thay đổi" : `💾 Tạo khảo sát (${qCount})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- thanh thêm câu hỏi ----
function AddQuestionBar({ onAdd }: { onAdd: (t: SurveyQuestionType) => void }) {
  const [open, setOpen] = useState(false);
  const groups = ["Trắc nghiệm", "Thang đo", "Tự luận"] as const;
  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full py-2 rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-violet-400 hover:text-violet-700"
        >
          + Thêm câu hỏi
        </button>
      ) : (
        <div className="border border-zinc-200 rounded-lg p-2 space-y-2 bg-zinc-50">
          {groups.map((g) => (
            <div key={g} className="space-y-1">
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">{g}</div>
              <div className="flex flex-wrap gap-1.5">
                {QUESTION_TYPE_META.filter((m) => m.group === g).map((m) => (
                  <button
                    key={m.type}
                    title={m.hint}
                    onClick={() => { onAdd(m.type); setOpen(false); }}
                    className="px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs hover:border-violet-400 hover:bg-violet-50"
                  >
                    <span className="mr-1">{m.icon}</span>{m.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button onClick={() => setOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-700">Đóng</button>
        </div>
      )}
    </div>
  );
}

// ---- panel AI seed ----
function AiSeedPanel({
  dbKeys,
  onApply,
}: {
  dbKeys: Record<string, string>;
  onApply: (c: SurveyConfig, mode: "replace" | "append") => void;
}) {
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string>(() => {
    if (typeof window === "undefined") return MODELS[0].id;
    try {
      const s = localStorage.getItem(MODEL_KEY);
      if (s && MODELS.some((m) => m.id === s)) return s;
    } catch {}
    return MODELS[0].id;
  });
  const modelDef = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const provider = modelDef.provider;
  const key = (dbKeys[provider] ?? "") || loadKey(provider);

  const run = async () => {
    if (!topic.trim()) { toast.error("Nhập chủ đề khảo sát"); return; }
    if (!key) { toast.error(`Cần API key ${provider} — mở ⚙️ Cài đặt → 🔑 API key`); return; }
    setBusy(true);
    try {
      const { config } = await generateSurveyForm({
        topic: topic.trim(),
        context: context.trim() || undefined,
        count,
        allowedTypes: [], // tất cả loại
        provider,
        model,
        apiKey: key,
      });
      toast.success(`AI gợi ý ${countQuestions(config)} câu — chỉnh lại tuỳ ý`);
      onApply(config, "replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi gọi AI", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-violet-200 bg-violet-50/60 rounded-lg p-3 space-y-2">
      <VnTextarea
        value={topic}
        onValueChange={setTopic}
        placeholder="Chủ đề khảo sát — VD: Đánh giá buổi giảng môn Thủy công hôm nay"
        rows={2}
        className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500 resize-y"
      />
      <VnInput
        value={context}
        onValueChange={setContext}
        placeholder="Bối cảnh thêm (tuỳ chọn): lớp, môn, nội dung đã giảng…"
        className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-xs focus:outline-none focus:border-violet-400"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1 text-xs text-zinc-600">
          Số câu
          <Input type="number" min={2} max={20} value={count}
            onChange={(e) => setCount(Number(e.target.value) || 6)} className="w-16 h-8" />
        </label>
        <select
          value={model}
          onChange={(e) => { setModel(e.target.value); try { localStorage.setItem(MODEL_KEY, e.target.value); } catch {} }}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300 max-w-[200px]"
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <Button size="sm" onClick={run} disabled={busy || !topic.trim()} className="ml-auto">
          {busy ? "Đang soạn…" : "✨ Sinh câu hỏi"}
        </Button>
      </div>
      {!key && (
        <p className="text-[11px] text-amber-700">⚠ Provider {provider} chưa có API key — mở ⚙️ Cài đặt → 🔑 API key.</p>
      )}
      <p className="text-[11px] text-zinc-500">Gợi ý sẽ thay nội dung hiện tại để bạn chỉnh từng câu.</p>
    </div>
  );
}

function SmallBtn({
  children, title, onClick, disabled, danger,
}: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button" title={title} onClick={onClick} disabled={disabled}
      className={`w-7 h-7 grid place-items-center rounded-md text-sm disabled:opacity-25 ${
        danger ? "text-zinc-400 hover:text-red-600 hover:bg-red-50" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
