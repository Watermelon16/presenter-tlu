"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type Tool = {
  id: string;
  icon: string;
  label: string;
  desc: string;
  needsKey: boolean;
  /** Click handler. Sẽ tự đóng panel sau khi gọi. */
  onClick: () => void;
  /** Nếu disable thì tool vẫn hiện nhưng grey + hint lý do. */
  disabled?: boolean;
  disabledHint?: string;
};

export function FloatingAiTools({
  onOpenSingleActivity,
  onOpenPdfGen,
  onOpenSurvey,
  onOpenSummary,
  onOpenInsights,
  onOpenApiKeys,
  hasPdf,
}: {
  onOpenSingleActivity: () => void;
  onOpenPdfGen: () => void;
  onOpenSurvey: () => void;
  onOpenSummary: () => void;
  onOpenInsights: () => void;
  onOpenApiKeys: () => void;
  hasPdf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);
  const hasAnyKey = !!dbKeys && Object.values(dbKeys).some((v) => !!v?.trim());

  // Đóng khi bấm Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const tools: Tool[] = [
    {
      id: "single",
      icon: "✨",
      label: "Tạo 1 hoạt động",
      desc: "Nêu chủ đề + phần tập trung → AI sinh câu hỏi, lựa chọn, đáp án + nhiễu (poll/wordcloud/rating/opentext/board/Q&A)",
      needsKey: true,
      onClick: () => { onOpenSingleActivity(); setOpen(false); },
    },
    {
      id: "pdf",
      icon: "📄",
      label: "Sinh hàng loạt từ PDF",
      desc: hasPdf ? "Chọn slide range + chủ đề trọng tâm → AI sinh 5-10 hoạt động bám sát" : "Cần upload PDF trước",
      needsKey: true,
      disabled: !hasPdf,
      disabledHint: "Upload PDF qua nút 📑 trên topbar trước",
      onClick: () => { onOpenPdfGen(); setOpen(false); },
    },
    {
      id: "survey",
      icon: "🗳",
      label: "Khảo sát theo chủ đề",
      desc: "Gen chuỗi 3-5 câu hỏi khảo sát SV (cảm nhận, hiểu biết, mong muốn)",
      needsKey: true,
      onClick: () => { onOpenSurvey(); setOpen(false); },
    },
    {
      id: "summary",
      icon: "📋",
      label: "Tóm tắt buổi giảng",
      desc: "AI đọc toàn bộ responses + Q&A + board → insight: hiểu rõ / nhầm / câu hỏi đáng chú ý / gợi ý buổi sau",
      needsKey: true,
      onClick: () => { onOpenSummary(); setOpen(false); },
    },
    {
      id: "insights",
      icon: "🧠",
      label: "Smart insights cho SV",
      desc: "Phân tích sâu kết quả: top mistakes, themes, gợi ý cho từng SV",
      needsKey: true,
      onClick: () => { onOpenInsights(); setOpen(false); },
    },
  ];

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[100] w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-purple-700 hover:from-violet-500 hover:to-purple-600 text-white shadow-xl flex items-center justify-center text-xl ring-4 ring-white"
        title="Mở AI Tools"
        aria-label="AI Tools"
      >
        ✨
      </button>

      {/* Backdrop + Panel */}
      {open && (
        <div
          className="fixed inset-0 z-[110] bg-black/40 flex items-end sm:items-center justify-end sm:justify-end p-0 sm:p-5"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[80vh] sm:max-h-[calc(100vh-2.5rem)] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-violet-600 text-lg">✨</span>
                <h3 className="font-semibold text-zinc-900">AI Tools</h3>
              </div>
              <button
                onClick={onOpenApiKeys}
                className="text-xs text-violet-600 hover:underline font-medium"
              >
                Cài đặt key →
              </button>
            </div>

            {/* No-key warning */}
            {dbKeys !== undefined && !hasAnyKey && (
              <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-900">
                ⚠ Chưa có API key.{" "}
                <button onClick={onOpenApiKeys} className="font-semibold underline">
                  Vào AI Settings
                </button>
                {" "}để thêm — sau đó dùng được tất cả tool free.
              </div>
            )}

            {/* Tools list */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100">
              {tools.map((t) => (
                <button
                  key={t.id}
                  onClick={t.onClick}
                  disabled={t.disabled}
                  className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-violet-50/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="text-2xl shrink-0 mt-0.5">{t.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-zinc-900 text-sm">{t.label}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">
                      {t.disabled && t.disabledHint ? t.disabledHint : t.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-zinc-200 bg-zinc-50 text-[11px] text-zinc-500 shrink-0">
              🔒 Key gọi trực tiếp browser → provider. Server không thấy key.{" "}
              <Link href="/me" className="text-violet-600 underline hover:no-underline">
                ?
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
