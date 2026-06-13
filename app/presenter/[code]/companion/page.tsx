"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PresenterCompanionView } from "@/components/PresenterCompanionView";

/**
 * COMPANION WINDOW - "Trợ lý Kịch bản" (Giải pháp sâu cho B: Liền mạch PowerPoint)
 * 
 * Mục tiêu:
 * - Mở như cửa sổ nhỏ (popup) trên màn hình laptop của giảng viên
 * - Trong khi PowerPoint chạy fullscreen trên máy chiếu (HDMI)
 * - Chỉ hiển thị thông tin tối thiểu, cực lớn, dễ nhìn lướt:
 *    + Slide cue hiện tại (nếu có) → "CHUYỂN NGAY"
 *    + Tên hoạt động
 *    + Nút "TIẾP THEO" khổng lồ (Spacebar cũng được)
 *    + Slide cue tiếp theo (chuẩn bị trước)
 * 
 * Ưu điểm so với chỉ có Presentation Mode:
 * - Không cần alt-tab giữa tab presenter lớn và PowerPoint
 * - Có thể để companion trên built-in screen, PPT projected
 * - Realtime sync từ bất kỳ ai bấm (main presenter hoặc companion)
 */
export default function ScriptCompanion() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const isPipMode = searchParams.get('pip') === 'true';

  const upperCode = code?.toUpperCase();

  const session = useQuery(
    api.sessions.getSessionByCode,
    upperCode ? { code: upperCode } : "skip"
  );

  // Script state từ server (realtime)
  const scriptState = useQuery(
    api.activities.getScriptState,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // PDF (cho Presenter View) — chỉ khi buổi có slide trong app
  const pdfUrl = useQuery(
    api.sessions.getSessionPdfUrl,
    session?._id ? { sessionId: session._id } : "skip"
  );
  const hasPdf = !!session?.pdfStorageId && !!pdfUrl;

  const advance = useMutation(api.activities.advanceInScript);
  const jump = useMutation(api.activities.jumpToScriptPosition);
  const stop = useMutation(api.activities.stopScriptRunner);

  const isRunning = scriptState?.isRunning ?? false;
  const pos = scriptState?.position ?? 0;
  const total = scriptState?.total ?? 0;
  const current = scriptState?.currentActivity;
  const next = scriptState?.nextActivity;

  // Small transition effect when activity changes (for smoother handoff feel)
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [lastActivityId, setLastActivityId] = useState<string | null>(null);

  useEffect(() => {
    if (current?._id && current._id !== lastActivityId) {
      setIsTransitioning(true);
      const timer = setTimeout(() => setIsTransitioning(false), 450);
      setLastActivityId(current._id);
      return () => clearTimeout(timer);
    }
  }, [current?._id, lastActivityId]);

  const handleAdvance = async () => {
    if (!session?._id) return;
    try {
      await advance({ sessionId: session._id });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Hết kịch bản";
      toast.error(msg);
    }
  };

  const handlePrev = async () => {
    if (!session?._id) return;
    const prevPos = Math.max(0, pos - 1);
    try {
      await jump({ sessionId: session._id, position: prevPos });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Lỗi không xác định";
      toast.error(msg);
    }
  };

  const handleStop = async () => {
    if (!session?._id) return;
    await stop({ sessionId: session._id });
    // Companion tự đóng hoặc hiện thông báo
    toast("Đã dừng kịch bản. Cửa sổ này có thể đóng.");
  };

  // Phím tắt giống PowerPoint: Space / → = Tiếp theo, ← = Quay lại, Esc = thoát
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!session?._id) return;
      if (hasPdf) return; // Presenter View tự xử lý phím đổi slide

      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        handleAdvance();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      }
      if (e.key === "Escape") {
        handleStop();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?._id, pos, hasPdf]);

  // Chưa có session
  if (!session) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-6xl mb-4">📍</div>
          <div className="text-2xl font-semibold">Đang kết nối...</div>
        </div>
      </div>
    );
  }

  // Presenter View — khi buổi có slide PDF trong app (kiểu PowerPoint/Keynote).
  // Ưu tiên hơn giao diện kịch bản; chỉ áp cho cửa sổ thường (không phải PiP siêu nhỏ).
  if (hasPdf && pdfUrl && !isPipMode) {
    return (
      <PresenterCompanionView
        sessionId={session._id}
        code={upperCode ?? ""}
        pdfUrl={pdfUrl}
        totalPages={session.pdfNumPages ?? 0}
        currentPage={session.pdfCurrentPage ?? 1}
        currentActivityTitle={isRunning ? current?.title : undefined}
      />
    );
  }

  // Kịch bản chưa chạy
  if (!isRunning || !current) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="text-7xl mb-6">🎬</div>
          <div className="text-3xl font-semibold mb-3 tracking-tight">Kịch bản chưa chạy</div>
          <div className="text-lg text-zinc-400 mb-6">
            Vào trang Presenter chính → bấm <span className="text-emerald-400 font-medium">"▶ Chạy theo kịch bản"</span>
          </div>

          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-left text-sm text-zinc-400">
            <div className="font-medium text-white mb-2">Mẹo dùng với PowerPoint:</div>
            <ul className="space-y-1.5 list-disc pl-5">
              <li>Mở cửa sổ này ở góc màn hình laptop</li>
              <li>Để PowerPoint fullscreen trên máy chiếu</li>
              <li>Chỉ cần nhìn Companion để biết chuyển slide nào</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const progress = total > 0 ? Math.round(((pos + 1) / total) * 100) : 0;

  // ==================== PICTURE-IN-PICTURE MODE (Siêu nhỏ, kéo vào góc màn hình) ====================
  if (isPipMode) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col select-none overflow-hidden border border-zinc-700">
        {/* Draggable header cho PiP */}
        <div className="h-7 bg-zinc-900 flex items-center justify-between px-3 text-[10px] font-mono tracking-widest border-b border-zinc-700 cursor-move">
          <div className="flex items-center gap-2 text-emerald-400">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            KỊCH BẢN • {pos + 1}/{total}
          </div>
          <button onClick={handleStop} className="text-red-400 hover:text-red-300 text-[10px]">DỪNG</button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-3 text-center">
          {/* Slide Cue - rất lớn cho PiP nhỏ */}
          {current.slideCue ? (
            <div className="mb-2">
              <div className="text-amber-400 text-[9px] tracking-[2px] mb-0.5">CHUYỂN SLIDE</div>
              <div className="text-4xl font-bold text-amber-400 leading-none tracking-[-1px]">
                {current.slideCue}
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-400 mb-2">Không cần chuyển slide</div>
          )}

          {/* Tên hoạt động */}
          <div className="text-emerald-400 text-xs tracking-widest mb-0.5">HIỆN TẠI</div>
          <div className="text-white text-xl font-semibold leading-tight mb-4 px-2 line-clamp-2">
            {current.title}
          </div>

          {/* Nút Tiếp Theo - to nhưng vừa với cửa sổ nhỏ */}
          <button
            onClick={handleAdvance}
            disabled={pos >= total - 1}
            className="w-full h-11 text-xl font-semibold rounded-2xl bg-emerald-600 active:bg-emerald-500 disabled:bg-zinc-800 transition-all shadow-lg"
          >
            TIẾP THEO <span className="text-sm opacity-70">(Space)</span>
          </button>

          {/* Next cue nhỏ */}
          {next?.slideCue && (
            <div className="mt-3 text-amber-300 text-sm">
              Sau: <span className="font-medium">{next.slideCue}</span>
            </div>
          )}
        </div>

        <div className="h-6 bg-zinc-900 border-t border-zinc-700 flex items-center justify-between px-3 text-[10px] text-zinc-500">
          <button onClick={handlePrev} disabled={pos === 0} className="hover:text-white disabled:opacity-40">← Trước</button>
          <div>Esc = dừng</div>
        </div>
      </div>
    );
  }

  // ==================== NORMAL COMPANION MODE ====================
  return (
    <div className="min-h-screen bg-black text-white flex flex-col select-none">
      {/* Header cực mỏng - chỉ progress + vị trí */}
      <div className="h-9 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-4 text-xs font-mono tracking-[3px]">
        <div className="flex items-center gap-2 text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          KỊCH BẢN • {pos + 1}/{total}
        </div>
        <div className="text-zinc-500">{progress}%</div>
        <button 
          onClick={handleStop}
          className="text-red-400 hover:text-red-300 active:opacity-70"
        >
          DỪNG
        </button>
      </div>

      {/* Nội dung chính - cực lớn, dễ nhìn từ xa / góc nhìn chéo */}
      <div 
        className={`flex-1 flex flex-col items-center justify-center px-6 py-8 text-center transition-all duration-300 ${
          isTransitioning ? 'scale-[0.985] opacity-80' : 'scale-100 opacity-100'
        }`}
      >
        
        {/* SLIDE CUE HIỆN TẠI - PHẦN QUAN TRỌNG NHẤT CHO PPT */}
        {current.slideCue ? (
          <div className="mb-6">
            <div className="text-amber-400 text-xs tracking-[4px] mb-2">CHUYỂN SLIDE POWERPOINT NGAY</div>
            <div className="text-7xl md:text-8xl font-bold text-amber-400 leading-none tracking-[-3px]">
              {current.slideCue}
            </div>
          </div>
        ) : (
          <div className="mb-6">
            <div className="text-amber-400/70 text-xs tracking-[3px] mb-1.5">KHÔNG CẦN CHUYỂN SLIDE</div>
            <div className="text-2xl text-zinc-400">Hoạt động này không có mốc slide</div>
            <div className="text-sm text-zinc-500 mt-1">Bạn có thể tiếp tục mà không cần thao tác PowerPoint</div>
          </div>
        )}

        {/* Tên hoạt động hiện tại */}
        <div className="text-[17px] text-emerald-400 tracking-[3px] mb-1">HOẠT ĐỘNG HIỆN TẠI</div>
        <div className="text-white text-3xl md:text-4xl font-semibold leading-tight tracking-[-1.5px] mb-8 max-w-[20ch]">
          {current.title}
        </div>

        {/* NÚT TIẾP THEO - KHỔNG LỒ */}
        <button
          onClick={handleAdvance}
          disabled={pos >= total - 1}
          className="w-full max-w-md h-16 text-3xl font-semibold rounded-3xl bg-emerald-600 active:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 transition-all active:scale-[0.985] shadow-2xl"
        >
          TIẾP THEO → <span className="text-xl opacity-60">(Space)</span>
        </button>

        {/* Chuẩn bị slide cho hoạt động SAU (nếu có) */}
        {next && next.slideCue && (
          <div className="mt-8 text-left w-full max-w-md">
            <div className="text-xs text-amber-400/70 tracking-widest mb-1">SAU KHI XONG → CHUẨN BỊ SLIDE</div>
            <div className="text-2xl font-semibold text-amber-300 leading-tight">
              {next.slideCue}
            </div>
            <div className="text-lg text-zinc-400 mt-0.5">{next.title}</div>
          </div>
        )}
      </div>

      {/* Tip nhỏ ở dưới cùng - giúp lecturer dùng như màn hình phụ */}
      <div className="h-10 border-t border-zinc-800 flex items-center justify-center text-[11px] text-zinc-500 bg-zinc-950">
        Dùng cửa sổ này như màn hình phụ • Để PowerPoint fullscreen trên máy chiếu
      </div>

      {/* Footer nhỏ: nút trước + vị trí */}
      <div className="h-14 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between px-4">
        <button
          onClick={handlePrev}
          disabled={pos === 0}
          className="px-6 py-2 text-lg rounded-xl border border-zinc-700 disabled:opacity-30 active:bg-zinc-900"
        >
          ← Trước
        </button>

        <div className="text-xs font-mono text-zinc-500">
          {pos + 1} / {total}
        </div>

        <div className="text-xs text-zinc-500">Esc = dừng</div>
      </div>
    </div>
  );
}
