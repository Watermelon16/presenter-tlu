"use client";

// Trang KHẢO SÁT "mở đến hạn" cho SV — truy cập qua link/QR cố định bất kỳ lúc nào
// trước deadline. Nộp & SỬA được. Độc lập với luồng hoạt động trực tiếp của phòng.

import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SurveyForm } from "@/components/survey/SurveyForm";
import { Logo } from "@/components/Logo";
import { VnInput } from "@/components/VnInput";
import { Button } from "@/components/ui/button";
import {
  type SurveyConfig,
  type SurveyAnswer,
  surveyOpenState,
  surveyAllowsEdit,
  formatDeadline,
  isSurveyAsync,
} from "@/lib/survey";

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "presenter_tlu_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

type Identity = { studentCode: string; fullName: string; className: string };

export default function SurveySharePage() {
  const params = useParams();
  const code = String(params.code ?? "").toUpperCase();
  const surveyId = String(params.surveyId ?? "") as Id<"activities">;

  const survey = useQuery(api.responses.getSurveyForStudent, surveyId ? { activityId: surveyId } : "skip");
  const join = useMutation(api.participants.joinSession);
  const submit = useMutation(api.responses.submitSurveyResponse);

  const [mounted, setMounted] = useState(false);
  const [dev, setDev] = useState("");
  const [now, setNow] = useState(0);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [justDone, setJustDone] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDev(getOrCreateDeviceId());
    setNow(Date.now());
    try {
      const raw = localStorage.getItem(`student_${code}`) || localStorage.getItem("student_identity_global");
      if (raw) setIdentity(JSON.parse(raw));
    } catch {}
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [code]);

  const mine = useQuery(
    api.responses.getMySurveyResponse,
    mounted && surveyId ? { activityId: surveyId, studentCode: identity?.studentCode, deviceId: dev } : "skip"
  );

  const config = (survey?.config ?? null) as SurveyConfig | null;
  const state = config ? surveyOpenState(config, now) : "not_async";
  const myAnswers = (mine?.value as { answers?: Record<string, SurveyAnswer> } | undefined)?.answers;

  // Danh tính HIỆU LỰC: ưu tiên localStorage; nếu trống thì KHÔI PHỤC từ bài đã nộp
  // trên server (theo thiết bị/mã SV) → không hỏi lại khi reload/sửa.
  const effectiveIdentity: Identity | null = identity?.studentCode
    ? identity
    : mine?.studentCode
      ? { studentCode: mine.studentCode, fullName: mine.fullName ?? "", className: mine.className ?? "" }
      : null;

  const handleSubmit = async (answers: Record<string, SurveyAnswer>) => {
    if (!survey) return;
    if (survey.requiresStudentCode && !effectiveIdentity?.studentCode) {
      toast.error("Cần nhập danh tính trước");
      return;
    }
    setSubmitting(true);
    try {
      // Đăng ký participant để GV theo dõi (best-effort — bỏ qua nếu buổi đã đóng)
      if (effectiveIdentity?.studentCode) {
        try {
          await join({ code, studentCode: effectiveIdentity.studentCode, fullName: effectiveIdentity.fullName, className: effectiveIdentity.className, deviceId: dev });
        } catch {}
      }
      await submit({ activityId: surveyId, studentCode: effectiveIdentity?.studentCode, value: { answers }, deviceId: dev });
      setEditing(false);
      setJustDone(true);
      toast.success("Đã gửi khảo sát. Cảm ơn bạn!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gửi thất bại");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- nội dung theo trạng thái (tính 1 lần, bọc 1 lần để tránh tạo component khi render) ----
  const header = config ? (
    <div className="mb-4">
      <h1 className="text-2xl font-semibold text-zinc-900">{survey?.title}</h1>
      {survey?.sessionTitle && <p className="text-sm text-zinc-500 mt-0.5">{survey.sessionTitle}</p>}
      {config.deadline ? (
        <p className="text-xs text-zinc-500 mt-1">⏳ Hạn nộp: <b>{formatDeadline(config.deadline)}</b></p>
      ) : (
        <p className="text-xs text-zinc-500 mt-1">Mở đến khi giảng viên đóng.</p>
      )}
    </div>
  ) : null;

  const hasSubmitted = (!!mine || justDone) && !editing;

  let body: React.ReactNode;
  if (!mounted || survey === undefined) {
    body = <div className="text-center text-sm text-zinc-400 py-16">Đang tải…</div>;
  } else if (survey === null || !config) {
    body = <Card tone="zinc">Không tìm thấy khảo sát này.</Card>;
  } else if (!isSurveyAsync(config)) {
    body = <Card tone="amber">Khảo sát này chạy trực tiếp trong buổi, không mở qua link riêng.</Card>;
  } else if (state === "past_deadline" || state === "closed_by_teacher") {
    body = (
      <>
        {header}
        <Card tone="amber">
          {state === "past_deadline" ? "Đã hết hạn nộp khảo sát này." : "Giảng viên đã đóng nhận phản hồi."}
        </Card>
        {myAnswers && (
          <div className="mt-4">
            <p className="text-sm text-zinc-500 mb-2">Bài bạn đã nộp:</p>
            <SurveyForm config={config} initialAnswers={myAnswers} readOnly />
          </div>
        )}
      </>
    );
  } else if (survey.requiresStudentCode && !effectiveIdentity?.studentCode) {
    body = (
      <>
        {header}
        <IdentityForm
          onDone={(id) => {
            setIdentity(id);
            try {
              localStorage.setItem(`student_${code}`, JSON.stringify(id));
              localStorage.setItem("student_identity_global", JSON.stringify(id));
            } catch {}
          }}
        />
      </>
    );
  } else if (hasSubmitted) {
    body = (
      <>
        {header}
        <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 text-center">
          <div className="text-5xl mb-3">✅</div>
          <div className="text-2xl font-semibold text-emerald-800 mb-1">Đã ghi nhận!</div>
          <p className="text-emerald-700 text-sm">
            Cảm ơn bạn đã trả lời khảo sát.
            {surveyAllowsEdit(config) ? " Bạn có thể sửa lại trước hạn." : ""}
          </p>
          {surveyAllowsEdit(config) && (
            <Button variant="outline" className="mt-4" onClick={() => setEditing(true)}>✏️ Xem / Sửa bài</Button>
          )}
        </div>
        {myAnswers && (
          <details className="bg-white border border-zinc-200 rounded-2xl p-4 mt-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-600">Xem lại câu trả lời</summary>
            <div className="mt-4"><SurveyForm config={config} initialAnswers={myAnswers} readOnly /></div>
          </details>
        )}
      </>
    );
  } else {
    body = (
      <>
        {header}
        {effectiveIdentity?.studentCode && (
          <p className="text-xs text-zinc-500 mb-3">
            Đang trả lời với tư cách <b>{effectiveIdentity.fullName || effectiveIdentity.studentCode}</b>
            {effectiveIdentity.className ? ` · ${effectiveIdentity.className}` : ""}
          </p>
        )}
        <SurveyForm
          config={config}
          initialAnswers={editing ? myAnswers : undefined}
          submitting={submitting}
          onSubmit={handleSubmit}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <Logo />
          <span className="text-xs text-zinc-400">Phòng {code}</span>
        </div>
        {body}
      </div>
    </div>
  );
}

function Card({ tone, children }: { tone: "zinc" | "amber"; children: React.ReactNode }) {
  const cls = tone === "amber" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-white border-zinc-200 text-zinc-600";
  return <div className={`border rounded-2xl px-5 py-6 text-center text-sm ${cls}`}>{children}</div>;
}

function IdentityForm({ onDone }: { onDone: (id: Identity) => void }) {
  const [studentCode, setStudentCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [className, setClassName] = useState("");
  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 space-y-3">
      <p className="text-sm text-zinc-600">Nhập thông tin để làm khảo sát:</p>
      <div className="space-y-2">
        <VnInput value={studentCode} onValueChange={setStudentCode} placeholder="Mã sinh viên *"
          className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500" />
        <VnInput value={fullName} onValueChange={setFullName} placeholder="Họ và tên *"
          className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500" />
        <VnInput value={className} onValueChange={setClassName} placeholder="Lớp (nếu có)"
          className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500" />
      </div>
      <button
        onClick={() => {
          if (!studentCode.trim() || !fullName.trim()) {
            toast.error("Nhập mã sinh viên và họ tên");
            return;
          }
          onDone({ studentCode: studentCode.trim(), fullName: fullName.trim(), className: className.trim() });
        }}
        className="w-full py-3 rounded-2xl bg-zinc-900 text-white font-medium active:bg-black"
      >
        Tiếp tục →
      </button>
    </div>
  );
}
