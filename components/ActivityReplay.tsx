"use client";

import { useState } from "react";
import { sameWordGroup } from "@/lib/wordcloud";

type Option = { id: string; text: string };
type PollConfig = {
  options?: Option[];
  isQuiz?: boolean;
  correctOptionIds?: string[];
  pollType?: string;
};

type ReplayActivity = {
  _id: string;
  type: "poll" | "wordcloud" | "rating" | "board" | "qa" | "opentext" | "video";
  title: string;
  status: "draft" | "active" | "closed" | "expired";
  slideCue?: string | null;
  closedAt?: number;
  startedAt?: number;
  config: PollConfig | Record<string, unknown>;
  myResponse: { value?: unknown; status?: string } | null;
  myBoardPosts: Array<{ _id: string; content: string; likes?: number; columnId?: string }>;
  totalAnswers: number;
  pollBreakdown: Record<string, number> | null;
  wordcloudTop: Array<{ word: string; count: number }> | null;
  ratingBreakdown: { average: number; count: number; distribution: Record<number, number> } | null;
};

const TYPE_LABEL: Record<string, { icon: string; label: string }> = {
  poll: { icon: "📊", label: "Trắc nghiệm" },
  wordcloud: { icon: "💬", label: "Word Cloud" },
  rating: { icon: "⭐", label: "Đánh giá" },
  board: { icon: "📌", label: "Board" },
  qa: { icon: "❓", label: "Q&A" },
  opentext: { icon: "📝", label: "Tự luận" },
};

export function ActivityReplay({ items }: { items: ReplayActivity[] }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Chỉ hiện activities đã closed/expired. Bỏ video — SV không tham gia.
  const closed = items.filter(
    (a) => (a.status === "closed" || a.status === "expired") && a.type !== "video"
  );
  if (closed.length === 0) return null;

  const participated = closed.filter((a) => a.myResponse?.status === "answered" || a.myBoardPosts.length > 0).length;

  return (
    <div className="mb-6 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-zinc-50"
      >
        <div className="text-left">
          <div className="font-semibold text-zinc-900 text-sm flex items-center gap-1.5">
            📚 Lịch sử buổi này <span className="text-xs text-zinc-500 font-normal">({closed.length} hoạt động đã đóng · bạn tham gia {participated})</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Bấm để xem lại câu trả lời + đáp án + stats lớp</div>
        </div>
        <span className="text-zinc-400 text-lg">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 divide-y divide-zinc-100">
          {closed.map((act) => {
            const meta = TYPE_LABEL[act.type] || { icon: "📦", label: act.type };
            const isExpanded = expandedId === act._id;
            const participated = act.myResponse?.status === "answered" || act.myBoardPosts.length > 0;
            return (
              <div key={act._id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : act._id)}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-zinc-50"
                >
                  <div className="text-left min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm">{meta.icon}</span>
                      <span className="text-sm font-medium text-zinc-900 truncate">{act.title}</span>
                      {!participated && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">không tham gia</span>
                      )}
                      {participated && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">✓ đã trả lời</span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {meta.label} · {act.totalAnswers} câu trả lời · {act.status === "expired" ? "hết giờ" : "đã đóng"}
                    </div>
                  </div>
                  <span className="text-zinc-400 text-sm">{isExpanded ? "▲" : "▼"}</span>
                </button>

                {isExpanded && (
                  <div className="px-5 py-3 bg-zinc-50/60">
                    <ReplayDetail act={act} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReplayDetail({ act }: { act: ReplayActivity }) {
  if (act.type === "poll") return <PollReplay act={act} />;
  if (act.type === "wordcloud") return <WordCloudReplay act={act} />;
  if (act.type === "rating") return <RatingReplay act={act} />;
  if (act.type === "opentext") return <OpenTextReplay act={act} />;
  if (act.type === "board") return <BoardReplay act={act} />;
  if (act.type === "qa") return <QAReplay act={act} />;
  return null;
}

function PollReplay({ act }: { act: ReplayActivity }) {
  const cfg = act.config as PollConfig;
  const options = cfg.options ?? [];
  const myValue = act.myResponse?.value as { selectedOptions?: string[] } | undefined;
  const mySelected = new Set(myValue?.selectedOptions ?? []);
  const correctIds = new Set(cfg.correctOptionIds ?? []);
  const isQuiz = !!cfg.isQuiz;
  const counts = act.pollBreakdown ?? {};
  const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1;

  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const count = counts[opt.id] ?? 0;
        const pct = Math.round((count / total) * 100);
        const isMine = mySelected.has(opt.id);
        const isCorrect = isQuiz && correctIds.has(opt.id);
        return (
          <div
            key={opt.id}
            className={`px-3 py-2 rounded-lg border ${
              isCorrect ? "border-emerald-400 bg-emerald-50" :
              isMine && isQuiz && !isCorrect ? "border-rose-300 bg-rose-50" :
              "border-zinc-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isMine && <span className="text-xs px-1 rounded bg-zinc-900 text-white">Bạn chọn</span>}
                {isCorrect && <span className="text-xs">✅</span>}
                <span className="text-sm">{opt.text}</span>
              </div>
              <span className="text-xs text-zinc-500 tabular-nums shrink-0">{count}/{total} ({pct}%)</span>
            </div>
            <div className="mt-1.5 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
              <div className={`h-full ${isCorrect ? "bg-emerald-500" : isMine ? "bg-zinc-700" : "bg-zinc-300"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {isQuiz && (
        <div className="text-xs text-zinc-600 mt-2">
          {mySelected.size === 0 ? (
            <span className="text-zinc-500">Bạn không trả lời câu này.</span>
          ) : Array.from(mySelected).every((id) => correctIds.has(id)) && mySelected.size === correctIds.size ? (
            <span className="text-emerald-700 font-medium">✓ Câu trả lời đúng!</span>
          ) : (
            <span className="text-rose-700 font-medium">✗ Câu trả lời chưa đúng.</span>
          )}
        </div>
      )}
    </div>
  );
}

function WordCloudReplay({ act }: { act: ReplayActivity }) {
  const myText = typeof act.myResponse?.value === "string" ? act.myResponse.value : "";
  const top = act.wordcloudTop ?? [];
  return (
    <div className="space-y-3">
      {myText && (
        <div className="text-sm">
          <span className="text-xs text-zinc-500">Bạn đã gõ: </span>
          <span className="font-semibold text-emerald-700">{myText}</span>
        </div>
      )}
      <div>
        <div className="text-xs text-zinc-500 mb-1.5">Top {top.length} từ phổ biến nhất:</div>
        <div className="flex flex-wrap gap-1.5">
          {top.map((w, i) => {
            const isMine = !!myText && sameWordGroup(w.word, myText);
            const size = Math.max(11, Math.min(20, 11 + w.count * 2));
            return (
              <span
                key={i}
                style={{ fontSize: size }}
                className={`px-2 py-0.5 rounded ${isMine ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-700"}`}
              >
                {w.word} <span className="text-[10px] opacity-70">×{w.count}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RatingReplay({ act }: { act: ReplayActivity }) {
  const myRating = (act.myResponse?.value as { rating?: number } | undefined)?.rating;
  const b = act.ratingBreakdown;
  if (!b) return null;
  return (
    <div className="space-y-2">
      {myRating != null && (
        <div className="text-sm">
          <span className="text-xs text-zinc-500">Bạn đã chấm: </span>
          <span className="font-bold text-emerald-700">{myRating}</span>
        </div>
      )}
      <div className="text-sm">
        Điểm trung bình lớp: <strong>{b.average}</strong> ({b.count} lượt)
      </div>
      <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
        {Object.entries(b.distribution).sort(([a], [b]) => Number(a) - Number(b)).map(([val, cnt]) => (
          <div key={val} className={`p-2 rounded ${Number(val) === myRating ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>
            <div className="font-bold tabular-nums">{val}</div>
            <div className="text-[10px]">{cnt}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpenTextReplay({ act }: { act: ReplayActivity }) {
  const myText = typeof act.myResponse?.value === "string"
    ? act.myResponse.value
    : (act.myResponse?.value as { text?: string } | undefined)?.text ?? "";
  if (!myText) {
    return <div className="text-sm text-zinc-500 italic">Bạn không trả lời câu này.</div>;
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-500">Câu trả lời của bạn:</div>
      <div className="text-sm bg-white border border-zinc-200 px-3 py-2 rounded-lg whitespace-pre-wrap">{myText}</div>
      <div className="text-[11px] text-zinc-500">{act.totalAnswers} bạn khác cũng đã trả lời.</div>
    </div>
  );
}

function BoardReplay({ act }: { act: ReplayActivity }) {
  if (act.myBoardPosts.length === 0) {
    return <div className="text-sm text-zinc-500 italic">Bạn không đăng bài nào.</div>;
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-500">{act.myBoardPosts.length} bài của bạn:</div>
      {act.myBoardPosts.map((p) => (
        <div key={p._id} className="text-sm bg-white border border-zinc-200 px-3 py-2 rounded-lg">
          {p.content}
          {(p.likes ?? 0) > 0 && <span className="ml-2 text-xs text-zinc-500">👍 {p.likes}</span>}
        </div>
      ))}
    </div>
  );
}

function QAReplay({ act }: { act: ReplayActivity }) {
  const myValue = act.myResponse?.value as { question?: string; isAnswered?: boolean } | undefined;
  if (!myValue?.question) {
    return <div className="text-sm text-zinc-500 italic">Bạn không gửi câu hỏi.</div>;
  }
  return (
    <div className="text-sm space-y-1">
      <div className="text-xs text-zinc-500">Câu hỏi của bạn:</div>
      <div className="bg-white border border-zinc-200 px-3 py-2 rounded-lg">{myValue.question}</div>
      {myValue.isAnswered && <div className="text-xs text-emerald-700">✓ Giảng viên đã trả lời</div>}
    </div>
  );
}
