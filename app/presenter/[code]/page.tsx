"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation, useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import * as XLSX from "xlsx";
import { PdfSlideViewer } from "@/components/PdfSlideViewer";
import { VnInput, VnTextarea } from "@/components/VnInput";
import { AiGenFromPdfModal } from "@/components/AiGenFromPdfModal";
import { CountdownOverlay } from "@/components/CountdownOverlay";
import { Logo } from "@/components/Logo";
import { SmartInsightsModal } from "@/components/SmartInsightsModal";
import { OpentextGradingModal } from "@/components/OpentextGradingModal";
import { SurveyAiGenModal } from "@/components/SurveyAiGenModal";
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from "@/components/Dropdown";
// Note: PollBarChart / RatingBarChart / WordcloudBars vẫn export trong components/ResultCharts.tsx
// dùng cho fullscreen overlay nếu cần — không import ở đây vì block "Kết quả realtime" trên màn chính đã bỏ.

import {
  DndContext,
  closestCenter,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Input row dùng cho danh sách (Poll options, Board columns).
 * Có local state để TRÁNH parent re-render mỗi keystroke — fix bug
 * dính từ khi gõ tiếng Việt (IME bị reset bởi controlled value).
 * Sync về parent khi blur hoặc khi composition kết thúc.
 */
const TextInputRow = React.memo(function TextInputRow({
  initialValue,
  placeholder,
  onUpdate,
  onRemove,
  showRemove,
  className,
  ariaLabel,
}: {
  initialValue: string;
  placeholder: string;
  onUpdate: (value: string) => void;
  onRemove?: () => void;
  showRemove: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [local, setLocal] = useState(initialValue);

  // Sync nếu parent đổi initialValue (vd: openEditModal load lại)
  useEffect(() => {
    setLocal(initialValue);
  }, [initialValue]);

  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        aria-label={ariaLabel}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== initialValue) onUpdate(local);
        }}
        onCompositionEnd={(e) => {
          // Sync sau khi IME kết thúc composition (gõ tiếng Việt xong 1 từ)
          const v = e.currentTarget.value;
          setLocal(v);
          if (v !== initialValue) onUpdate(v);
        }}
        placeholder={placeholder}
        className={className ?? "flex-1 bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"}
      />
      {showRemove && onRemove && (
        <button
          onClick={onRemove}
          className="px-2 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg"
          title="Xóa"
        >
          ✕
        </button>
      )}
    </div>
  );
});

// Format slideCue: nếu là số thì hiển thị "Slide N", nếu là text cũ thì giữ nguyên
function fmtSlide(cue?: string | null) {
  if (!cue) return "";
  const trimmed = cue.trim();
  if (/^\d+$/.test(trimmed)) return `Slide ${trimmed}`;
  return trimmed;
}

function PresenterPage() {
  const { code } = useParams<{ code: string }>();
  const upperCode = code?.toUpperCase();

  // Lấy thông tin buổi
  const session = useQuery(api.sessions.getSessionByCode, 
    upperCode ? { code: upperCode } : "skip"
  );

  // Lấy danh sách hoạt động
  const activities = useQuery(
    api.activities.listActivities,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // Danh sách đã sắp xếp theo order (kịch bản) — tính sớm để dùng cho các query có điều kiện
  const sortedActivities = [...(activities || [])].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const activeActivity = sortedActivities.find((a) => a.status === "active");

  // === Reveal flow: khi đóng activity bằng X / nút Đóng, lưu ID để overlay tiếp tục hiển thị kết quả ===
  const [revealActivityId, setRevealActivityId] = useState<string | null>(null);
  const revealedActivity = revealActivityId
    ? sortedActivities.find((a) => a._id === revealActivityId)
    : null;

  // displayActivity = activity đang được "focus" để hiện kết quả: active hoặc activity vừa đóng
  const displayActivity = activeActivity || revealedActivity || undefined;

  // Reveal được bind vào key (activityId + startedAt) — đổi activity HOẶC restart =
  // mất reveal NGAY trong render. Không dùng useEffect (chạy sau render → flash đáp án quiz).
  const [answerRevealedKey, setAnswerRevealedKey] = useState<string | null>(null);
  const currentRevealKey = displayActivity
    ? `${displayActivity._id}:${displayActivity.startedAt ?? 0}`
    : null;
  const resultsRevealed = !!currentRevealKey && answerRevealedKey === currentRevealKey;
  const setResultsRevealed = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      if (!currentRevealKey) return;
      setAnswerRevealedKey((prevKey) => {
        const prev = prevKey === currentRevealKey;
        const value = typeof next === "function" ? next(prev) : next;
        return value ? currentRevealKey : null;
      });
    },
    [currentRevealKey]
  );

  // Chỉ hiển thị chi tiết kết quả khi: activity đã đóng/hết giờ, HOẶC giảng viên đã reveal
  const shouldShowResults =
    !displayActivity ? false
    : displayActivity.status !== "active" ? true
    : resultsRevealed;

  // Lấy số lượng sinh viên
  const participants = useQuery(
    api.responses.listSessionParticipants,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // Lấy kết quả vote realtime — query theo displayActivity để vẫn xem được sau khi đóng
  const pollResults = useQuery(
    api.responses.getPollVoteCounts,
    displayActivity && displayActivity.type === "poll"
      ? { activityId: displayActivity._id }
      : "skip"
  );

  // Lấy kết quả Word Cloud realtime (chỉ wordcloud, opentext có query riêng)
  const wordCloudResults = useQuery(
    api.responses.getWordCloudResults,
    displayActivity && displayActivity.type === "wordcloud"
      ? { activityId: displayActivity._id }
      : "skip"
  );

  // Lấy kết quả Rating realtime
  const ratingResults = useQuery(
    api.responses.getRatingResults,
    displayActivity && displayActivity.type === "rating"
      ? { activityId: displayActivity._id }
      : "skip"
  );

  // Lấy danh sách câu hỏi cho Q&A
  const qaResponses = useQuery(
    api.responses.getActivityResponses,
    displayActivity && displayActivity.type === "qa"
      ? { activityId: displayActivity._id }
      : "skip"
  );

  // Lấy bài đăng Board realtime
  const boardPosts = useQuery(
    api.board.listBoardPosts,
    displayActivity && displayActivity.type === "board"
      ? { activityId: displayActivity._id }
      : "skip"
  );

  // Lấy danh sách câu trả lời Open Text (không gom tần suất, hiển thị list)
  const opentextResponses = useQuery(
    api.responses.getActivityResponses,
    displayActivity && displayActivity.type === "opentext"
      ? { activityId: displayActivity._id }
      : "skip"
  );

  // === Script Runner State (server-backed, realtime cho companion + mọi tab) ===
  const scriptState = useQuery(
    api.activities.getScriptState,
    session?._id ? { sessionId: session._id } : "skip"
  );

  const setQaQuestionStatus = useMutation(api.responses.setQaQuestionStatus);
  const deleteQaQuestion = useMutation(api.responses.deleteQaQuestion);
  const answerQaQuestion = useMutation(api.responses.answerQaQuestion);

  // Bảng thành tích
  const updateScoringConfig = useMutation(api.leaderboard.updateScoringConfig);

  // Lưu kịch bản thành mẫu
  const saveScriptAsTemplate = useMutation(api.scriptTemplates.saveScriptAsTemplate);
  const applyTemplate = useMutation(api.scriptTemplates.applyTemplateToSession);
  const deleteTemplate = useMutation(api.scriptTemplates.deleteTemplate);
  const templatesList = useQuery(api.scriptTemplates.listTemplates);
  const leaderboardData = useQuery(
    api.leaderboard.getParticipationLeaderboard,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // Board moderation
  const setBoardPostStatus = useMutation(api.board.setBoardPostStatus);
  const deleteBoardPost = useMutation(api.board.deleteBoardPost);
  const toggleLikeBoardPostPresenter = useMutation(api.board.toggleLikeBoardPost); // có thể dùng chung

  // Quick create for fast B testing (kịch bản + Companion + slide cue)
  const quickCreateActivity = async (type: "poll" | "wordcloud" | "rating" | "qa" | "board" | "opentext" | "opentext", title: string, slideCue: string) => {
    if (!session?._id) {
      toast.error("Chưa có session");
      return;
    }

    let config: any = {};

    if (type === "wordcloud") {
      config = {};
    } else if (type === "poll") {
      config = {
        options: [
          { id: "1", text: "Rất hiểu" },
          { id: "2", text: "Hiểu" },
          { id: "3", text: "Bình thường" },
          { id: "4", text: "Không hiểu" },
        ],
        pollType: "single_choice",
      };
    } else if (type === "rating") {
      config = {
        min: 1,
        max: 5,
        minLabel: "Rất không hiểu",
        maxLabel: "Rất hiểu rõ",
      };
    } else if (type === "qa") {
      config = { allowAnonymous: true };
    } else if (type === "board") {
      config = {
        columns: [
          { id: "understood", title: "Tôi đã hiểu" },
          { id: "not-clear", title: "Chưa hiểu rõ" },
          { id: "question", title: "Câu hỏi thêm" },
        ],
      };
    }

    try {
      await createActivity({
        sessionId: session._id,
        type,
        title,
        config,
        requiresStudentCode: false,
        timeLimit: undefined,
        order: ((activities?.length || 0) + 1) * 10,
        slideCue,
      });
      toast.success(`Đã tạo "${title}" với slide: ${slideCue}`);
    } catch (err: any) {
      toast.error(err.message || "Tạo thất bại");
    }
  };

  // Lấy danh sách chi tiết sinh viên tham gia (chỉ khi hoạt động yêu cầu mã SV)
  const participationStatus = useQuery(
    api.responses.getActivityParticipationStatus,
    activeActivity && activeActivity.requiresStudentCode
      ? { activityId: activeActivity._id }
      : "skip"
  );

  // Ref để auto-scroll đến vùng kết quả khi hoạt động bắt đầu
  // resultsRef + highlightResults: dùng cho khối "Kết quả realtime" trên màn chính (đã bỏ).
  // Giữ lại để các effect không break, nhưng không gắn ref nữa.
  const resultsRef = useRef<HTMLDivElement>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null); // Dùng cho DragOverlay trong Dnd list

  // Ref cho danh sách hoạt động (dùng để cuộn xuống sau khi Làm lại)
  const activitiesListRef = useRef<HTMLDivElement>(null);

  const startActivity = useMutation(api.activities.startActivity);
  const closeActivity = useMutation(api.activities.closeActivity);
  const createActivity = useMutation(api.activities.createActivity);
  const reorderActivities = useMutation(api.activities.reorderActivities);
  const moveActivityUp = useMutation(api.activities.moveActivityUp);
  const moveActivityDown = useMutation(api.activities.moveActivityDown);
  const duplicateActivity = useMutation(api.activities.duplicateActivity);
  const restartActivity = useMutation(api.activities.restartActivity);
  const updateActivity = useMutation(api.activities.updateActivity);
  const deleteActivity = useMutation(api.activities.deleteActivity);
  const updateCollectStudentCode = useMutation(api.sessions.updateCollectStudentCode);
  const endSession = useMutation(api.sessions.endSession);
  const resetSessionForNewRun = useMutation(api.sessions.resetSessionForNewRun);

  // Script Runner mutations (B: server-backed kịch bản)
  const startScriptRunner = useMutation(api.activities.startScriptRunner);
  const stopScriptRunner = useMutation(api.activities.stopScriptRunner);
  const advanceInScript = useMutation(api.activities.advanceInScript);
  const jumpToScriptPosition = useMutation(api.activities.jumpToScriptPosition);
  const exportData = useQuery(
    api.responses.getSessionFullExport,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // Convex client để gọi query đặc biệt (vd: export phiên cũ)
  const convex = useConvex();

  // === Kịch bản (Script) state - BÂY GIỜ DÙNG SERVER (realtime) ===
  // isScriptMode + currentScriptIndex được lấy từ Convex để companion window hoạt động mượt
  const isScriptMode = scriptState?.isRunning ?? false;
  const currentScriptIndex = scriptState?.position ?? 0;
  const scriptTotal = scriptState?.total ?? 0;

  const [isPresentationMode, setIsPresentationMode] = useState(false); // Chế độ Trình diễn cực mạnh (Focus Mode)
  const [isAdvancing, setIsAdvancing] = useState(false); // Transition state in Presentation Mode

  // Panel hướng dẫn sử dụng (toggle để giảng viên xem nhanh khi cần)
  const [showHelp, setShowHelp] = useState(false);

  // Dropdown "+ Tạo hoạt động"
  const [showCreatePicker, setShowCreatePicker] = useState(false);
  // Dropdown "⋯ Thêm" trong block Kịch bản
  const [showScriptMenu, setShowScriptMenu] = useState(false);
  // Modal danh sách sinh viên (click vào "X sinh viên tham gia")
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);

  // Tab cho overlay kết quả (F): "result" = kết quả activity hiện tại, "leaderboard" = bảng thành tích
  const [resultTab, setResultTab] = useState<"result" | "leaderboard">("result");

  // Document Picture-in-Picture (Chrome 116+): cửa sổ nổi trên PPT, không cần Alt+Tab
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  const openFloatingPanel = useCallback(async () => {
    // @ts-expect-error documentPictureInPicture chưa có trong TS lib
    const dpip = typeof window !== "undefined" ? window.documentPictureInPicture : undefined;

    if (!dpip) {
      // Fallback: cửa sổ popup thường
      window.open(
        `/presenter/${upperCode}/companion?pip=true`,
        "pip-companion",
        "width=380,height=300,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
      );
      toast.message("Trình duyệt chưa hỗ trợ cửa sổ nổi. Đang dùng popup thường.", {
        description: "Dùng Chrome / Edge 116+ để có cửa sổ thực sự nổi trên PPT.",
      });
      return;
    }

    try {
      const pipWindow: Window = await dpip.requestWindow({ width: 380, height: 320 });
      pipWindowRef.current = pipWindow;

      // Copy stylesheets từ main document để Tailwind hoạt động trong PiP
      document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        try {
          pipWindow.document.head.appendChild(node.cloneNode(true));
        } catch {}
      });

      pipWindow.document.body.style.margin = "0";
      pipWindow.document.body.style.backgroundColor = "#0a0a0a";
      pipWindow.document.body.style.color = "white";
      pipWindow.document.body.style.fontFamily = "system-ui, -apple-system, sans-serif";

      pipWindow.addEventListener("pagehide", () => {
        setPipContainer(null);
        pipWindowRef.current = null;
      });

      setPipContainer(pipWindow.document.body);
      toast.success("Đã mở bảng điều khiển nổi. Cửa sổ này sẽ nổi trên mọi app khác.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Không thể mở cửa sổ nổi";
      toast.error(msg);
    }
  }, [upperCode]);

  // === Overlay toàn màn hình: QR mã phòng / kết quả activity / slide PDF ===
  // null = ẩn, "qr" = QR + mã phòng (Q), "result" = kết quả activity (F), "slides" = slide PDF (S)
  const [fullscreenOverlay, setFullscreenOverlay] = useState<null | "qr" | "result" | "slides">(null);
  // Nếu đang ở "slides" rồi bấm F (hoặc Q) → khi Esc, quay lại "slides" thay vì đóng hoàn toàn
  const [overlayReturnTo, setOverlayReturnTo] = useState<null | "slides">(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  // Helper: chuyển overlay với context (lưu trạng thái cũ nếu là "slides")
  const switchOverlay = useCallback((next: null | "qr" | "result" | "slides") => {
    setFullscreenOverlay((prev) => {
      // Nếu đang ở slides và chuyển sang result/qr → nhớ để quay về
      if (prev === "slides" && (next === "result" || next === "qr")) {
        setOverlayReturnTo("slides");
      }
      // Nếu chuyển về null/slides → reset returnTo
      if (next === null || next === "slides") {
        setOverlayReturnTo(null);
      }
      return next;
    });
  }, []);

  // Esc / đóng: nếu có returnTo, quay về slides; nếu không, đóng hẳn
  const closeOverlay = useCallback(() => {
    // Clear reveal khi đóng overlay (để lần sau bấm F lại thì hiện activity active)
    setRevealActivityId(null);
    if (overlayReturnTo) {
      setFullscreenOverlay(overlayReturnTo);
      setOverlayReturnTo(null);
    } else {
      setFullscreenOverlay(null);
    }
  }, [overlayReturnTo]);

  // === Slide PDF upload + chiếu ===
  const setSessionPdf = useMutation(api.sessions.setSessionPdf);
  const clearSessionPdf = useMutation(api.sessions.clearSessionPdf);
  const setPdfCurrentPage = useMutation(api.sessions.setPdfCurrentPage);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const pdfUrl = useQuery(
    api.sessions.getSessionPdfUrl,
    session?._id ? { sessionId: session._id } : "skip"
  );
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);
  const [showAiGenModal, setShowAiGenModal] = useState(false);
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [gradingActivityId, setGradingActivityId] = useState<Id<"activities"> | null>(null);

  const handleUploadPdf = async (file: File) => {
    if (!session?._id) return;
    if (file.type !== "application/pdf") {
      toast.error("Chỉ chấp nhận file PDF");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File PDF vượt quá 20MB. Hãy giảm chất lượng và thử lại.");
      return;
    }

    setIsUploadingPdf(true);
    try {
      // Đọc số trang trước (để lưu vào DB, dùng cho status hiển thị)
      const { pdfjs } = await import("react-pdf");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;

      // Upload file lên Convex Storage
      const uploadUrl = await generateUploadUrl();
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload thất bại");
      const { storageId } = await uploadRes.json();

      await setSessionPdf({
        sessionId: session._id,
        storageId,
        fileName: file.name,
        numPages,
      });

      toast.success(`Đã tải lên "${file.name}" (${numPages} trang)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload thất bại";
      toast.error(msg);
    } finally {
      setIsUploadingPdf(false);
      if (pdfFileInputRef.current) pdfFileInputRef.current.value = "";
    }
  };

  const pdfCurrentPage = session?.pdfCurrentPage ?? 1;
  const pdfTotalPages = session?.pdfNumPages ?? 0;
  const hasPdf = !!session?.pdfStorageId && !!pdfUrl;

  const goPdfFirst = async () => {
    if (!session?._id || !hasPdf) return;
    if (pdfCurrentPage !== 1) {
      await setPdfCurrentPage({ sessionId: session._id, page: 1 });
    }
  };

  const goPdfPrev = async () => {
    if (!session?._id || !hasPdf) return;
    const next = Math.max(1, pdfCurrentPage - 1);
    if (next !== pdfCurrentPage) {
      await setPdfCurrentPage({ sessionId: session._id, page: next });
    }
  };

  const goPdfNext = async () => {
    if (!session?._id || !hasPdf) return;
    const next = Math.min(pdfTotalPages, pdfCurrentPage + 1);
    if (next !== pdfCurrentPage) {
      await setPdfCurrentPage({ sessionId: session._id, page: next });
    }
  };

  const goPdfPage = async (page: number) => {
    if (!session?._id || !hasPdf) return;
    const clamped = Math.max(1, Math.min(pdfTotalPages, Math.floor(page)));
    if (clamped !== pdfCurrentPage) {
      await setPdfCurrentPage({ sessionId: session._id, page: clamped });
    }
  };

  // Slide jump shortcut: trong overlay "slides", gõ số (vd "12") + Enter → nhảy slide 12.
  // Buffer tự clear sau 1.5s không gõ. Esc cũng clear.
  const [slideJumpBuffer, setSlideJumpBuffer] = useState("");
  const slideJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetSlideJumpBuffer = useCallback((delayed = false) => {
    if (slideJumpTimerRef.current) {
      clearTimeout(slideJumpTimerRef.current);
      slideJumpTimerRef.current = null;
    }
    if (delayed) {
      slideJumpTimerRef.current = setTimeout(() => setSlideJumpBuffer(""), 1500);
    } else {
      setSlideJumpBuffer("");
    }
  }, []);

  // Big text mode — scale up text trên màn chiếu cho SV ngồi cuối lớp
  const [bigTextMode, setBigTextMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("big_text_mode_v1") === "1";
    } catch {
      return false;
    }
  });
  const toggleBigTextMode = useCallback(() => {
    setBigTextMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("big_text_mode_v1", next ? "1" : "0");
      } catch {}
      toast.message(next ? "Đã bật text lớn cho SV ngồi xa" : "Tắt text lớn");
      return next;
    });
  }, []);

  // Sinh QR code khi có upperCode
  useEffect(() => {
    if (!upperCode) return;
    const joinUrl = typeof window !== "undefined"
      ? `${window.location.origin}/join?code=${upperCode}`
      : `/join?code=${upperCode}`;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 512, color: { dark: "#000000", light: "#FFFFFF" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [upperCode]);

  // Tải QR thành file PNG để dán vào slide PPT
  const handleDownloadQr = useCallback(() => {
    if (!qrDataUrl || !upperCode) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `QR_PresenterTLU_${upperCode}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("Đã tải QR. Dán vào slide đầu của PPT để SV quét nhanh.");
  }, [qrDataUrl, upperCode]);

  // Phím tắt toàn cục:
  //   F     → overlay kết quả activity
  //   Q     → overlay QR + mã phòng
  //   S     → overlay slide PDF (chiếu thay PPT)
  //   ← →   → chuyển slide (chỉ khi đang ở overlay slide)
  //   Esc   → đóng overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Bỏ qua khi đang gõ trong input/textarea
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      if (e.key === "Escape" && fullscreenOverlay) {
        e.preventDefault();
        // Nếu đang gõ slide jump buffer → chỉ clear buffer, không đóng overlay
        if (fullscreenOverlay === "slides" && slideJumpBuffer.length > 0) {
          resetSlideJumpBuffer(false);
          return;
        }
        closeOverlay();
        return;
      }

      // Phím chuyển slide (khi đang ở slide mode)
      if (fullscreenOverlay === "slides") {
        // Slide jump: gõ số → tích vào buffer; Enter → nhảy; Backspace → xoá; Esc đã xử lý ở trên
        if (e.key >= "0" && e.key <= "9") {
          e.preventDefault();
          setSlideJumpBuffer((prev) => (prev + e.key).slice(0, 5));
          resetSlideJumpBuffer(true);
          return;
        }
        if (e.key === "Backspace" && slideJumpBuffer.length > 0) {
          e.preventDefault();
          setSlideJumpBuffer((prev) => prev.slice(0, -1));
          resetSlideJumpBuffer(true);
          return;
        }
        if (e.key === "Enter" && slideJumpBuffer.length > 0) {
          e.preventDefault();
          const page = parseInt(slideJumpBuffer, 10);
          if (page > 0) {
            if (page > pdfTotalPages) {
              toast.error(`Slide ${page} vượt quá số trang (${pdfTotalPages})`);
            } else {
              goPdfPage(page);
            }
          }
          resetSlideJumpBuffer(false);
          return;
        }
        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
          e.preventDefault();
          goPdfNext();
          return;
        }
        if (e.key === "ArrowLeft" || e.key === "PageUp") {
          e.preventDefault();
          goPdfPrev();
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          goPdfFirst();
          return;
        }
        if (e.key === "End") {
          e.preventDefault();
          goPdfPage(pdfTotalPages);
          return;
        }
      }

      // Phím F (overlay kết quả realtime) đã bỏ — không cần thiết.
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        if (fullscreenOverlay === "qr") {
          closeOverlay();
        } else {
          switchOverlay("qr");
        }
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        if (fullscreenOverlay === "slides") {
          setFullscreenOverlay(null);
          setOverlayReturnTo(null);
        } else {
          switchOverlay("slides");
        }
      }

      // A = Kích hoạt activity. (Trước đây mở overlay kết quả — đã bỏ.)
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        if (activeActivity) {
          toast.message(`Đang chạy: ${activeActivity.title}`);
        } else {
          // Tìm activity nháp để kích hoạt: ưu tiên match slide hiện tại, rồi script position, rồi first draft
          let target: { _id: string; title: string; slideCue?: string } | null = null;
          if (hasPdf) {
            const slideMatch = sortedActivities.find((a) =>
              a.status === "draft" &&
              a.slideCue &&
              /^\d+$/.test(a.slideCue.trim()) &&
              parseInt(a.slideCue.trim()) === pdfCurrentPage
            );
            if (slideMatch) target = slideMatch;
          }
          if (!target && isScriptMode && currentScriptActivity && currentScriptActivity.status === "draft") {
            target = currentScriptActivity;
          }
          if (!target) {
            const draft = sortedActivities.find((a) => a.status === "draft");
            if (draft) target = draft;
          }
          if (target) {
            handleStart(target._id);
            toast.success(`Đã kích hoạt: ${target.title}`);
          } else {
            toast.message("Không còn hoạt động nháp để kích hoạt");
          }
        }
      }

      // X = Đóng activity. Bấm lần 2 (khi không còn active) → đóng overlay như Esc
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        if (activeActivity) {
          handleCloseAndReveal(activeActivity._id);
        } else if (fullscreenOverlay) {
          // X lần 2 — đóng overlay (giống Esc, tôn trọng overlayReturnTo về slide)
          closeOverlay();
        } else {
          toast.message("Không có hoạt động đang chạy");
        }
      }

      // T = Toggle tab trong overlay Kết quả (Kết quả ↔ Bảng thành tích)
      if (e.key === "t" || e.key === "T") {
        if (fullscreenOverlay === "result") {
          e.preventDefault();
          setResultTab((prev) => (prev === "result" ? "leaderboard" : "result"));
        }
      }

      // R = Reveal — công bố / ẩn chi tiết kết quả (chỉ có hiệu lực khi activity còn active;
      // khi closed thì shouldShowResults đã = true rồi nên toggle không ảnh hưởng)
      if (e.key === "r" || e.key === "R") {
        if (fullscreenOverlay === "result") {
          e.preventDefault();
          setResultsRevealed((prev) => {
            const next = !prev;
            toast.message(next ? "✓ Đã công bố kết quả" : "Đã ẩn kết quả");
            return next;
          });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fullscreenOverlay, hasPdf, pdfCurrentPage, pdfTotalPages, closeOverlay, switchOverlay,
    // Cập nhật closure khi activity / display thay đổi để A/X/R nhận state mới nhất
    activeActivity?._id, displayActivity?._id, displayActivity?.status,
    isScriptMode, sortedActivities.length,
    // Slide jump buffer
    slideJumpBuffer, resetSlideJumpBuffer,
  ]);

  const [isStarting, setIsStarting] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Q&A moderation state (cho phần Results - B)
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");

  // Bảng thành tích
  const [showScoringConfig, setShowScoringConfig] = useState(false);
  const [scoringConfig, setScoringConfig] = useState({
    poll: 1,
    wordcloud: 1,
    rating: 1,
    board: 2,
    qa: 2,
    qaUpvote: 1,
  });

  // Quản lý kịch bản mẫu
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  // State cho danh sách sinh viên (tối ưu cho giảng viên chấm điểm)
  const [studentSearch, setStudentSearch] = useState("");

  // Form state for creating Poll
  const [pollTitle, setPollTitle] = useState("");
  const [pollDescription, setPollDescription] = useState("");
  // Opentext: đáp án mẫu để AI chấm tự động (optional)
  const [referenceAnswer, setReferenceAnswer] = useState("");
  const [pollType, setPollType] = useState<"single_choice" | "multiple_choice">("single_choice");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [requiresStudentCode, setRequiresStudentCode] = useState(false);
  const [timeLimitMode, setTimeLimitMode] = useState<"unlimited" | "preset" | "custom">("unlimited");
  const [timeLimitValue, setTimeLimitValue] = useState(1.5); // in minutes
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [minSelections, setMinSelections] = useState(1);
  // Quiz mode: nếu enabled, đánh dấu đáp án đúng (index trong options)
  const [isQuizMode, setIsQuizMode] = useState(false);
  const [correctOptionIndexes, setCorrectOptionIndexes] = useState<number[]>([]);

  // Mốc slide PowerPoint (tùy chọn)
  const [slideCue, setSlideCue] = useState("");

  // Cấu hình Rating / Thang điểm
  const [ratingMin, setRatingMin] = useState(1);
  const [ratingMax, setRatingMax] = useState(5);
  const [ratingMinLabel, setRatingMinLabel] = useState("Rất không hiểu");
  const [ratingMaxLabel, setRatingMaxLabel] = useState("Rất hiểu rõ");
  // Nhãn cho từng điểm (1-5). Key = số điểm, value = mô tả.
  const [ratingPointLabels, setRatingPointLabels] = useState<Record<number, string>>({});

  // Cấu hình Q&A
  const [qaAllowAnonymous, setQaAllowAnonymous] = useState(true);
  const [qaMaxQuestionsPerStudent, setQaMaxQuestionsPerStudent] = useState<number | null>(null);

  // Cấu hình Board (các cột)
  const [boardColumns, setBoardColumns] = useState<Array<{ id: string; title: string }>>([
    { id: "col1", title: "Điều tôi hiểu" },
    { id: "col2", title: "Điều tôi chưa hiểu rõ" },
    { id: "col3", title: "Câu hỏi thêm" },
  ]);

  // Inline editing state cho trả lời Q&A (thay thế hoàn toàn prompt())
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
  const [editingAnswerText, setEditingAnswerText] = useState("");

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [titleError, setTitleError] = useState("");

  // Loại hoạt động đang tạo
  const [createType, setCreateType] = useState<"poll" | "wordcloud" | "rating" | "qa" | "board" | "opentext">("poll");

  // Reset board columns khi chuyển loại hoạt động
  useEffect(() => {
    if (createType !== "board") return;
    // Nếu đang edit board thì giữ nguyên (đã load ở openEditModal)
    if (editingActivity && editingActivity.type === "board") return;

    // Reset về preset mặc định khi tạo mới
    setBoardColumns([
      { id: "understood", title: "Tôi đã hiểu" },
      { id: "not-clear", title: "Chưa hiểu rõ" },
      { id: "question", title: "Câu hỏi thêm" },
    ]);
  }, [createType, editingActivity]);

  // (đã bỏ) Auto scroll + highlight khi có hoạt động mới bắt đầu — khối "Kết quả realtime" trên màn chính đã xóa.

  // Ref for auto-focus new option input
  const optionInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Simple form validation
  const validOptions = options.filter(o => o.trim() !== "");
  const isTitleValid = pollTitle.trim().length > 0;
  const isOptionsValid = validOptions.length >= 2;
  const isFormValid = isTitleValid && isOptionsValid;

  const handleStart = useCallback(async (activityId: string) => {
    setIsStarting(activityId);
    try {
      await startActivity({ activityId: activityId as any });
    } finally {
      setIsStarting(null);
    }
  }, [startActivity]);

  const handleClose = useCallback(async (activityId: string) => {
    await closeActivity({ activityId: activityId as any });
  }, [closeActivity]);

  // Đóng activity + TỰ ĐỘNG hiện overlay Kết quả/Bảng thành tích (dùng cho X hotkey + nút Đóng khi trình chiếu)
  const handleCloseAndReveal = useCallback(async (activityId: string) => {
    setRevealActivityId(activityId);  // giữ activity để overlay hiển thị kết quả sau khi đóng
    // Nếu đang chiếu slide → khi Esc quay lại slide, không về dashboard
    setFullscreenOverlay((cur) => {
      if (cur === "slides") setOverlayReturnTo("slides");
      return "result";
    });
    setResultTab("result");
    await closeActivity({ activityId: activityId as any });
    toast.success("Đã đóng. Đang hiện kết quả + bảng thành tích.");
  }, [closeActivity]);

  // Kích hoạt activity + TỰ ĐỘNG mở overlay để giảng viên thấy đề + theo dõi realtime
  const handleStartAndReveal = useCallback(async (activityId: string) => {
    setRevealActivityId(activityId);
    setFullscreenOverlay((cur) => {
      if (cur === "slides") setOverlayReturnTo("slides");
      return "result";
    });
    setResultTab("result");
    await startActivity({ activityId: activityId as any });
  }, [startActivity]);

  const handleMoveUp = useCallback((activityId: string) => {
    moveActivityUp({ activityId: activityId as any });
  }, [moveActivityUp]);

  // Chạy lại: reset chính activity đó (xóa responses cũ, mở lại để SV trả lời)
  const handleRestart = useCallback(async (activityId: string, title: string) => {
    if (!confirm(`Chạy lại "${title}"? Toàn bộ câu trả lời cũ của SV sẽ bị xóa.`)) return;
    setIsDuplicating(activityId);
    try {
      await restartActivity({ activityId: activityId as Id<"activities"> });
      toast.success("Đã chạy lại hoạt động. SV có thể trả lời lại từ đầu.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể chạy lại. Vui lòng thử lại.";
      toast.error(msg);
    } finally {
      setIsDuplicating(null);
    }
  }, [restartActivity]);

  // Sao chép (tách riêng — cho trường hợp muốn dùng template)
  const handleDuplicate = useCallback(async (activityId: string) => {
    setIsDuplicating(activityId);
    try {
      await duplicateActivity({ activityId: activityId as Id<"activities"> });
      toast.success("Đã sao chép hoạt động xuống cuối danh sách.");
      setTimeout(() => {
        activitiesListRef.current?.scrollTo({
          top: activitiesListRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 120);
    } catch {
      toast.error("Không thể sao chép hoạt động.");
    } finally {
      setIsDuplicating(null);
    }
  }, [duplicateActivity]);

  // Xóa hoạt động
  const handleDelete = useCallback(async (activityId: string, title: string) => {
    if (!confirm(`Bạn có chắc muốn xóa hoạt động "${title}"?`)) return;
    try {
      await deleteActivity({ activityId: activityId as any });
      toast.success("Đã xóa hoạt động");
    } catch (err: any) {
      toast.error(err?.message || "Không thể xóa hoạt động");
    }
  }, [deleteActivity]);

  // Export kết quả buổi giảng ra CSV (dễ mở bằng Excel)
  const handleExportResults = async () => {
    if (!exportData || !session) return;

    setIsExporting(true);

    try {
      const { activities, students } = exportData;

      // Tạo header CSV
      const headers = [
        "Mã SV", "Họ và tên", "Lớp", "Tham gia lúc",
        ...activities.map((a: any) => a.title),
        "Board - Số bài đăng", "Board - Tổng likes",
        "Tổng hoạt động đã tham gia"
      ];

      const rows = students.map((student: any) => {
        const activityValues = activities.map((act: any) => {
          const res = student.responses[act._id];
          if (!res || res.status === "no_response") return "Không trả lời";

          const val = res.value;

          // Xử lý theo loại hoạt động để xuất đẹp
          if (act.type === "poll") {
            if (val?.choiceIds) return "Đã chọn";
            return String(val ?? "");
          }
          if (act.type === "wordcloud" || act.type === "rating") {
            return String(val ?? "");
          }
          if (act.type === "qa") {
            return val?.text ? "Đã hỏi" : "Không hỏi";
          }
          if (act.type === "board") {
            return val ? "Đã đăng" : "Không đăng";
          }
          return String(val ?? "");
        });

        const totalAnswered = activities.filter((act: any) => {
          const res = student.responses[act._id];
          return res && res.status === "answered";
        }).length;

        return [
          student.studentCode,
          student.fullName,
          student.className,
          new Date(student.joinedAt).toLocaleString("vi-VN"),
          ...activityValues,
          student.boardStats.postCount,
          student.boardStats.totalLikes,
          totalAnswered,
        ];
      });

      // Tạo nội dung CSV
      const csvContent = [
        headers.join(","),
        ...rows.map((row: any[]) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      // Tải file
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `PresenterTLU_${upperCode}_${new Date().toISOString().slice(0,10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Đã xuất file CSV thành công!");
    } catch (err) {
      console.error(err);
      toast.error("Xuất file thất bại. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  };

  // Xuất Excel chuẩn (.xlsx) — nhiều sheet, dễ đẩy lên LMS chấm điểm
  // Build sheets cho 1 phiên (tái sử dụng cho both single + multi-run export)
  const buildSheetsForRun = (runData: {
    activities: Array<{ _id: string; title: string; type: string; order?: number; requiresStudentCode?: boolean }>;
    students: Array<{
      studentCode: string;
      fullName: string;
      className: string;
      joinedAt: number;
      responses: Record<string, { status: string; value: unknown; submittedAt?: number | null }>;
      boardStats: { postCount: number; totalLikes: number };
    }>;
  }, runLabel: string) => {
    const { activities, students } = runData;

    const overviewRows = students.map((s) => {
      const row: Record<string, unknown> = {
        "Mã SV": s.studentCode,
        "Họ và tên": s.fullName,
        "Lớp": s.className,
        "Tham gia lúc": new Date(s.joinedAt).toLocaleString("vi-VN"),
      };
      activities.forEach((act) => {
        const res = s.responses[act._id];
        let cell = "Không trả lời";
        if (res && res.status === "answered") {
          const v = res.value as Record<string, unknown> | string | undefined;
          if (act.type === "poll") {
            cell = v && typeof v === "object" && (v as { choiceIds?: string[] }).choiceIds
              ? `Chọn: ${(v as { choiceIds: string[] }).choiceIds.join(", ")}`
              : "Đã chọn";
          } else if (act.type === "wordcloud" || act.type === "opentext") {
            cell = typeof v === "string" ? v : String((v as { text?: string } | undefined)?.text ?? "");
          } else if (act.type === "rating") {
            cell = String((v as { rating?: number } | undefined)?.rating ?? v ?? "");
          } else if (act.type === "qa") {
            cell = (v as { text?: string } | undefined)?.text ? `Hỏi: ${(v as { text: string }).text}` : "Đã hỏi";
          } else if (act.type === "board") {
            cell = "Đã đăng";
          } else {
            cell = String(v ?? "");
          }
        }
        row[act.title] = cell;
      });

      const answeredCount = activities.filter((a) => s.responses[a._id]?.status === "answered").length;
      row["Board - Số bài"] = s.boardStats.postCount;
      row["Board - Tổng likes"] = s.boardStats.totalLikes;
      row["Tổng HĐ tham gia"] = answeredCount;
      row["Tỉ lệ (%)"] = activities.length > 0 ? Math.round((answeredCount / activities.length) * 100) : 0;
      return row;
    });

    const gradingRows = students.map((s) => {
      const answeredCount = activities.filter((a) => s.responses[a._id]?.status === "answered").length;
      const rate = activities.length > 0 ? Math.round((answeredCount / activities.length) * 100) : 0;
      return {
        "Mã SV": s.studentCode,
        "Họ và tên": s.fullName,
        "Lớp": s.className,
        "Số HĐ tham gia": answeredCount,
        "Tổng HĐ": activities.length,
        "Tỉ lệ (%)": rate,
        "Bài Board": s.boardStats.postCount,
        "Điểm gợi ý (thang 10)": Math.min(10, Math.round((rate / 10) + (s.boardStats.postCount * 0.5))),
      };
    });

    return { overviewRows, gradingRows, runLabel };
  };

  // Export Excel cho phiên hiện tại (giữ tương thích với nút cũ)
  const handleExportExcel = async () => {
    if (!exportData || !session) return;

    setIsExporting(true);

    try {
      const { activities, students } = exportData;

      // Sheet 1: Tổng quan sinh viên (mỗi activity = 1 cột)
      const overviewRows = students.map((s: any) => {
        const row: Record<string, any> = {
          "Mã SV": s.studentCode,
          "Họ và tên": s.fullName,
          "Lớp": s.className,
          "Tham gia lúc": new Date(s.joinedAt).toLocaleString("vi-VN"),
        };

        activities.forEach((act: any) => {
          const res = s.responses[act._id];
          let cell = "Không trả lời";
          if (res && res.status === "answered") {
            const v = res.value;
            if (act.type === "poll") {
              cell = v?.choiceIds ? `Chọn: ${v.choiceIds.join(", ")}` : "Đã chọn";
            } else if (act.type === "wordcloud") {
              cell = typeof v === "string" ? v : (v?.text ?? "");
            } else if (act.type === "rating") {
              cell = String(v?.rating ?? v ?? "");
            } else if (act.type === "qa") {
              cell = v?.text ? `Hỏi: ${v.text}` : "Đã hỏi";
            } else if (act.type === "board") {
              cell = "Đã đăng";
            } else {
              cell = String(v ?? "");
            }
          }
          row[act.title] = cell;
        });

        const answeredCount = activities.filter((a: any) => s.responses[a._id]?.status === "answered").length;
        row["Board - Số bài"] = s.boardStats.postCount;
        row["Board - Tổng likes"] = s.boardStats.totalLikes;
        row["Tổng hoạt động đã tham gia"] = answeredCount;
        row["Tỉ lệ tham gia (%)"] = activities.length > 0 ? Math.round((answeredCount / activities.length) * 100) : 0;
        return row;
      });

      // Sheet 2: Chấm điểm gợi ý (dễ copy-paste vào LMS)
      const gradingRows = students.map((s: any) => {
        const answeredCount = activities.filter((a: any) => s.responses[a._id]?.status === "answered").length;
        const rate = activities.length > 0 ? Math.round((answeredCount / activities.length) * 100) : 0;
        return {
          "Mã SV": s.studentCode,
          "Họ và tên": s.fullName,
          "Lớp": s.className,
          "Số HĐ tham gia": answeredCount,
          "Tổng HĐ": activities.length,
          "Tỉ lệ (%)": rate,
          "Bài Board": s.boardStats.postCount,
          "Điểm gợi ý (thang 10)": Math.min(10, Math.round((rate / 10) + (s.boardStats.postCount * 0.5))),
        };
      });

      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.json_to_sheet(overviewRows);
      XLSX.utils.book_append_sheet(wb, ws1, "Chi tiết");

      const ws2 = XLSX.utils.json_to_sheet(gradingRows);
      XLSX.utils.book_append_sheet(wb, ws2, "Chấm điểm");

      // Sheet 3: Metadata buổi giảng
      const metaRows = [
        { "Trường": "Mã phòng", "Giá trị": upperCode },
        { "Trường": "Tên buổi giảng", "Giá trị": session.title },
        { "Trường": "Giảng viên", "Giá trị": session.hostName || "" },
        { "Trường": "Ngày xuất", "Giá trị": new Date().toLocaleString("vi-VN") },
        { "Trường": "Số sinh viên", "Giá trị": students.length },
        { "Trường": "Số hoạt động", "Giá trị": activities.length },
      ];
      const ws3 = XLSX.utils.json_to_sheet(metaRows);
      XLSX.utils.book_append_sheet(wb, ws3, "Thông tin");

      const filename = `PresenterTLU_${upperCode}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);

      toast.success("Đã xuất file Excel thành công!");
    } catch (err) {
      console.error(err);
      toast.error("Xuất Excel thất bại. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  };

  // Export Excel cho TẤT CẢ các phiên đã có (1 file, nhiều sheet)
  const handleExportAllRuns = async () => {
    if (!session) return;
    const totalRuns = session.currentRun ?? 1;

    setIsExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Tổng quan các phiên
      const summaryRows: Array<Record<string, unknown>> = [];

      // Fetch data từng phiên
      for (let r = 1; r <= totalRuns; r++) {
        const data = await convex.query(api.responses.getSessionFullExport, {
          sessionId: session._id,
          run: r,
        });
        const { activities, students } = data;

        summaryRows.push({
          "Phiên": `#${r}`,
          "Số SV tham gia": students.length,
          "Số hoạt động": activities.length,
          "Tổng câu trả lời": students.reduce((sum: number, s) =>
            sum + activities.filter((a) => s.responses[a._id]?.status === "answered").length, 0),
        });

        const sheets = buildSheetsForRun(data, `Phiên ${r}`);

        if (students.length > 0) {
          const ws1 = XLSX.utils.json_to_sheet(sheets.overviewRows);
          XLSX.utils.book_append_sheet(wb, ws1, `P${r} - Chi tiết`);

          const ws2 = XLSX.utils.json_to_sheet(sheets.gradingRows);
          XLSX.utils.book_append_sheet(wb, ws2, `P${r} - Chấm điểm`);
        }
      }

      // Sheet "Tổng quan" - đầu file
      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      // Insert at position 0
      XLSX.utils.book_append_sheet(wb, wsSummary, "Tổng quan");

      // Sheet metadata
      const metaRows = [
        { "Trường": "Mã phòng", "Giá trị": upperCode },
        { "Trường": "Tên buổi giảng", "Giá trị": session.title },
        { "Trường": "Giảng viên", "Giá trị": session.hostName || "" },
        { "Trường": "Ngày xuất", "Giá trị": new Date().toLocaleString("vi-VN") },
        { "Trường": "Tổng số phiên", "Giá trị": totalRuns },
      ];
      const wsMeta = XLSX.utils.json_to_sheet(metaRows);
      XLSX.utils.book_append_sheet(wb, wsMeta, "Thông tin buổi");

      // Reorder: Thông tin → Tổng quan → P1 - Chi tiết → P1 - Chấm điểm → P2 → ...
      // (XLSX append theo thứ tự, nên file đúng thứ tự logic)

      const filename = `PresenterTLU_${upperCode}_AllRuns_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Đã xuất file Excel với ${totalRuns} phiên!`);
    } catch (err) {
      console.error(err);
      toast.error("Xuất Excel thất bại. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  };


  // Xuất báo cáo PDF đẹp
  const handleExportPDF = async () => {
    if (!exportData || !session) return;

    setIsExporting(true);

    try {
      const { activities, students } = exportData;
      const doc = new jsPDF();

      // Header
      doc.setFontSize(18);
      doc.text("BÁO CÁO BUỔI GIẢNG", 14, 20);

      doc.setFontSize(12);
      doc.text(`Tên buổi: ${session.title}`, 14, 28);
      doc.text(`Mã phòng: ${upperCode}`, 14, 34);
      doc.text(`Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}`, 14, 40);
      doc.text(`Số sinh viên tham gia: ${students.length}`, 14, 46);

      // Summary
      const totalAnswered = students.reduce((sum: number, s: any) => {
        return sum + activities.filter((a: any) => s.responses[a._id]?.status === "answered").length;
      }, 0);
      const avgParticipation = students.length > 0 
        ? Math.round((totalAnswered / (students.length * activities.length)) * 100) 
        : 0;

      doc.text(`Tỷ lệ tham gia trung bình: ${avgParticipation}%`, 14, 52);

      // Table of students
      const tableData = students.map((s: any) => {
        const answeredCount = activities.filter((a: any) => s.responses[a._id]?.status === "answered").length;
        return [
          s.studentCode,
          s.fullName,
          s.className,
          answeredCount,
          s.boardStats.postCount,
          s.boardStats.totalLikes,
        ];
      });

      // Improved grading table
      autoTable(doc, {
        startY: 60,
        head: [["Mã SV", "Họ tên", "Lớp", "Tham gia", "Board", "Điểm gợi ý"]],
        body: students.map((s: any) => {
          const totalAct = exportData.activities.length;
          const done = exportData.activities.filter((a: any) => s.responses[a._id]?.status === "answered").length;
          const rate = totalAct > 0 ? Math.round((done / totalAct) * 100) : 0;
          const score = done + Math.floor((s.boardStats?.postCount || 0) * 0.5);

          return [
            s.studentCode,
            s.fullName,
            s.className,
            `${rate}% (${done}/${totalAct})`,
            `${s.boardStats?.postCount || 0} bài`,
            score
          ];
        }),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [16, 185, 129] },
        columnStyles: {
          3: { cellWidth: 38 },
          5: { halign: 'center' }
        }
      });

      doc.save(`Bao_cao_PresenterTLU_${upperCode}.pdf`);
      toast.success("Đã xuất báo cáo PDF thành công!");
    } catch (err) {
      console.error(err);
      toast.error("Xuất PDF thất bại.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleMoveDown = useCallback((activityId: string) => {
    moveActivityDown({ activityId: activityId as any });
  }, [moveActivityDown]);

  // Drag & Drop sensors - MUST be called unconditionally before any early returns
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Helper functions for Poll form
  const addOption = () => {
    if (options.length < 12) {
      const newIndex = options.length;
      setOptions([...options, ""]);

      // Auto focus the new input after render
      setTimeout(() => {
        optionInputRefs.current[newIndex]?.focus();
      }, 0);

      if (createError && createError.includes("lựa chọn")) {
        setCreateError("");
      }
    }
  };

  const removeOption = (index: number) => {
    if (options.length > 2) {
      const newOptions = options.filter((_, i) => i !== index);
      setOptions(newOptions);

      // Clean up refs
      optionInputRefs.current = optionInputRefs.current.filter((_, i) => i !== index);
    }
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);

    if (createError && createError.includes("lựa chọn")) {
      const currentValid = newOptions.filter(o => o.trim() !== "").length;
      if (currentValid >= 2) {
        setCreateError("");
      }
    }
  };

  const handleCreatePoll = async () => {
    setCreateError("");

    if (!session?._id) return;

    // SAFETY: Khi đang edit, type CỐ ĐỊNH theo editingActivity.type (không cho phép đổi type qua state).
    // Khi tạo mới, dùng createType bình thường.
    const effectiveType = editingActivity ? editingActivity.type : createType;

    // Field-level validation
    if (!isTitleValid) {
      setCreateError("Vui lòng nhập tiêu đề hoạt động.");
      return;
    }

    // Poll-specific validation
    if (effectiveType === "poll" && !isOptionsValid) {
      setCreateError("Vui lòng nhập ít nhất 2 lựa chọn hợp lệ.");
      return;
    }

    setIsCreating(true);

    try {
      let config: any = {
        description: pollDescription.trim() || undefined,
      };

      if (effectiveType === "poll") {
        config.pollType = pollType;
        config.options = validOptions.map((text, i) => ({
          id: `opt_${i}`,
          text: text.trim(),
        }));

        config.shuffleOptions = shuffleOptions;
        if (pollType === "multiple_choice") {
          config.minSelections = minSelections;
        }

        // Quiz mode: lưu danh sách id đáp án đúng (theo index → id từ validOptions)
        if (isQuizMode && correctOptionIndexes.length > 0) {
          config.isQuiz = true;
          config.correctOptionIds = correctOptionIndexes
            .filter((i) => i < validOptions.length)
            .map((i) => `opt_${i}`);
        }
      } else if (effectiveType === "opentext") {
        config.maxLength = 500;
        if (referenceAnswer.trim()) {
          config.referenceAnswer = referenceAnswer.trim();
        }
      } else if (effectiveType === "wordcloud") {
        config.maxLength = 30;
      } else if (effectiveType === "rating") {
        config.min = ratingMin;
        config.max = ratingMax;
        config.minLabel = ratingMinLabel.trim();
        config.maxLabel = ratingMaxLabel.trim();
        // Lưu nhãn cho từng điểm (filter ra các nhãn có nhập)
        const pointLabels: Record<number, string> = {};
        for (let i = ratingMin; i <= ratingMax; i++) {
          const lbl = (ratingPointLabels[i] || "").trim();
          if (lbl) pointLabels[i] = lbl;
        }
        if (Object.keys(pointLabels).length > 0) {
          config.pointLabels = pointLabels;
        }
      } else if (effectiveType === "qa") {
        config.allowAnonymous = qaAllowAnonymous;
        config.maxQuestionsPerStudent = qaMaxQuestionsPerStudent;
      } else if (effectiveType === "board") {
        // Lưu cấu hình cột đẹp (id + title)
        config.columns = boardColumns.filter(c => c.title.trim());
      }

      let timeLimit: number | undefined = undefined;
      if (timeLimitMode === "preset" || timeLimitMode === "custom") {
        timeLimit = timeLimitValue;
      }

      if (editingActivity) {
        // Chế độ chỉnh sửa
        await updateActivity({
          activityId: editingActivity._id,
          title: pollTitle.trim(),
          config,
          requiresStudentCode,
          timeLimit,
          slideCue: slideCue.trim() || undefined,
        });
        toast.success("Đã cập nhật hoạt động thành công");
      } else {
        // Chế độ tạo mới
        await createActivity({
          sessionId: session._id,
          type: effectiveType,
          title: pollTitle.trim(),
          config,
          requiresStudentCode,
          timeLimit,
          order: (activities?.length || 0) + 1,
          slideCue: slideCue.trim() || undefined,
        });
        toast.success("Đã tạo hoạt động mới");
      }

      // Reset toàn bộ form
      setPollTitle("");
      setPollDescription("");
      setReferenceAnswer("");
      setOptions(["", ""]);
      setRequiresStudentCode(false);
      setTimeLimitMode("unlimited");
      setTimeLimitValue(1.5);
      setShowAdvanced(false);
      setShuffleOptions(false);
      setMinSelections(1);
      setSlideCue("");
      setCreateError("");
      setTitleError("");
      setEditingActivity(null);

      // Reset Q&A config
      setQaAllowAnonymous(true);
      setQaMaxQuestionsPerStudent(null);

      // Reset Board config
      setBoardColumns([
        { id: "understood", title: "Tôi đã hiểu" },
        { id: "not-clear", title: "Chưa hiểu rõ" },
        { id: "question", title: "Câu hỏi thêm" },
      ]);

      setShowCreateModal(false);
    } catch (error: any) {
      console.error(error);
      setCreateError(error?.message || "Thao tác thất bại. Vui lòng thử lại.");
    } finally {
      setIsCreating(false);
    }
  };

  const totalParticipants = participants?.length || 0;

  // Danh sách sinh viên đã lọc + sắp xếp theo mức độ tham gia (tối ưu cho giảng viên)
  const filteredAndSortedStudents = useMemo(() => {
    if (!participants) return [];

    let list = [...participants];

    // Lọc theo tìm kiếm
    if (studentSearch.trim()) {
      const q = studentSearch.toLowerCase().trim();
      list = list.filter((p: any) =>
        p.studentCode.toLowerCase().includes(q) ||
        p.fullName.toLowerCase().includes(q)
      );
    }

    // Sắp xếp theo mức độ tham gia (nếu có exportData)
    if (exportData) {
      list.sort((a: any, b: any) => {
        const aData = exportData.students.find((s: any) => s.studentCode === a.studentCode);
        const bData = exportData.students.find((s: any) => s.studentCode === b.studentCode);

        const aScore = (aData ? exportData.activities.filter((act: any) => aData.responses[act._id]?.status === "answered").length : 0) + (aData?.boardStats?.postCount || 0);
        const bScore = (bData ? exportData.activities.filter((act: any) => bData.responses[act._id]?.status === "answered").length : 0) + (bData?.boardStats?.postCount || 0);

        if (bScore !== aScore) return bScore - aScore;
        return a.joinedAt - b.joinedAt; // cũ hơn lên trước nếu bằng điểm
      });
    } else {
      // Fallback: sắp xếp theo thời gian tham gia
      list.sort((a: any, b: any) => a.joinedAt - b.joinedAt);
    }

    return list;
  }, [participants, studentSearch, exportData]);

  // === Kịch bản helpers (B: server-backed, dùng cho cả main presenter + companion) ===
  const scriptLength = scriptTotal || sortedActivities.length; // Ưu tiên từ server state
  const currentScriptActivity = isScriptMode && scriptLength > 0 ? sortedActivities[currentScriptIndex] : null;

  // Bấm "TIẾP THEO" hoặc Space → gọi server advance (tự sync sang companion)
  const goToNextInScript = async () => {
    if (!session?._id) return;
    try {
      await advanceInScript({ sessionId: session._id });
    } catch (e: any) {
      toast.error(e.message || "Không thể chuyển hoạt động tiếp theo");
    }
  };

  // Quay lại hoạt động trước (dùng cho nút ← và companion)
  const goToPrevInScript = async () => {
    if (!session?._id) return;
    const prevPos = Math.max(0, currentScriptIndex - 1);
    try {
      await jumpToScriptPosition({ sessionId: session._id, position: prevPos });
    } catch (e: any) {
      toast.error(e.message || "Không thể quay lại");
    }
  };

  const startScriptMode = async () => {
    if (!session?._id || scriptLength === 0) return;
    try {
      await startScriptRunner({ sessionId: session._id });
      toast.success("Đã vào chế độ Kịch bản. Mọi cửa sổ companion đều cập nhật realtime.");
    } catch (e: any) {
      toast.error(e.message || "Không thể bắt đầu kịch bản");
    }
  };

  const stopScriptMode = async () => {
    if (!session?._id) return;
    try {
      await stopScriptRunner({ sessionId: session._id });
    } catch (e) {}
  };

  // Click vào filmstrip / timeline → nhảy ngay đến vị trí đó (realtime sync sang companion)
  const handleJumpToPosition = async (pos: number) => {
    if (!session?._id) return;
    try {
      await jumpToScriptPosition({ sessionId: session._id, position: pos });
    } catch (e: any) {
      toast.error(e.message || "Không thể nhảy đến vị trí này");
    }
  };

  // Mở cửa sổ Companion siêu nhỏ (giải pháp sâu cho B: liền mạch PPT)
  // Giảng viên để cửa sổ này trên màn hình laptop (built-in), trong khi PowerPoint fullscreen trên máy chiếu
  const openCompanionWindow = () => {
    if (!code) return;

    const url = `/presenter/${code}/companion`;
    const features = "width=460,height=380,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no";

    const win = window.open(url, `tk-companion-${code}`, features);

    if (win) {
      toast.success("Đã mở Trợ lý Kịch bản. Kéo cửa sổ này sang góc màn hình laptop của bạn.");
      // Optional: focus main window back so lecturer can continue working on big presenter if needed
      setTimeout(() => window.focus(), 120);
    } else {
      toast.error("Trình duyệt chặn popup. Vui lòng cho phép popup cho trang này.");
    }
  };

  // Hỗ trợ phím tắt khi đang chạy kịch bản (giống PowerPoint)
  useEffect(() => {
    if (!isScriptMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        goToNextInScript();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrevInScript();
      }
      if (e.key.toLowerCase() === "s" && e.metaKey) {
        e.preventDefault();
        stopScriptMode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isScriptMode, currentScriptIndex]);

  // Mở modal ở chế độ tạo mới, pre-config theo loại được chọn
  const openCreateModal = (type: "poll" | "wordcloud" | "rating" | "qa" | "board" | "opentext") => {
    // Reset form về trạng thái mặc định cho loại này
    setEditingActivity(null);
    setCreateType(type);
    setPollTitle("");
    setPollDescription("");
    setReferenceAnswer("");
    setSlideCue("");
    setTitleError("");
    setCreateError("");
    setRequiresStudentCode(false);
    setTimeLimitMode("unlimited");
    setTimeLimitValue(1.5);

    // Type-specific defaults
    if (type === "poll") {
      setPollType("single_choice");
      setOptions(["", ""]);
      setShuffleOptions(false);
      setMinSelections(1);
      setShowAdvanced(false);
      setIsQuizMode(false);
      setCorrectOptionIndexes([]);
    } else if (type === "rating") {
      setRatingMin(1);
      setRatingMax(5);
      setRatingMinLabel("Rất không hiểu");
      setRatingMaxLabel("Rất hiểu rõ");
      setRatingPointLabels({});
    } else if (type === "qa") {
      setQaAllowAnonymous(true);
      setQaMaxQuestionsPerStudent(null);
    } else if (type === "board") {
      setBoardColumns([
        { id: "understood", title: "Đã hiểu" },
        { id: "not-clear", title: "Chưa hiểu rõ" },
        { id: "question", title: "Câu hỏi thêm" },
      ]);
    }

    setShowCreateModal(true);
  };

  // Mở modal ở chế độ chỉnh sửa
  const openEditModal = (activity: any) => {
    setEditingActivity(activity);

    // ===== Bước 1: Set createType theo activity (LUÔN LUÔN — quan trọng để không nhầm loại) =====
    setCreateType(activity.type);

    // ===== Bước 2: Reset toàn bộ state về default (tránh stale state từ edit/create trước) =====
    setPollTitle(activity.title || "");
    setPollDescription(activity.config?.description || "");
    setReferenceAnswer(activity.config?.referenceAnswer || "");
    setSlideCue(activity.slideCue || "");
    setRequiresStudentCode(activity.requiresStudentCode || false);
    setCreateError("");
    setTitleError("");

    const timeLimit = activity.timeLimit;
    if (timeLimit) {
      setTimeLimitMode("custom");
      setTimeLimitValue(timeLimit);
    } else {
      setTimeLimitMode("unlimited");
      setTimeLimitValue(1.5);
    }

    // Defaults (cho các loại không match — đảm bảo không leak state cũ)
    setPollType("single_choice");
    setOptions(["", ""]);
    setShuffleOptions(false);
    setMinSelections(1);
    setShowAdvanced(false);
    setIsQuizMode(false);
    setCorrectOptionIndexes([]);
    setRatingMin(1);
    setRatingMax(5);
    setRatingMinLabel("Rất không hiểu");
    setRatingMaxLabel("Rất hiểu rõ");
    setRatingPointLabels({});
    setQaAllowAnonymous(true);
    setQaMaxQuestionsPerStudent(null);
    setBoardColumns([
      { id: "understood", title: "Đã hiểu" },
      { id: "not-clear", title: "Chưa hiểu rõ" },
      { id: "question", title: "Câu hỏi thêm" },
    ]);

    // ===== Bước 3: Load state đặc thù cho loại của activity =====
    if (activity.type === "poll") {
      setPollType(activity.config?.pollType || "single_choice");
      const opts = activity.config?.options || [];
      setOptions(opts.length > 0 ? opts.map((o: any) => o.text) : ["", ""]);
      setShuffleOptions(activity.config?.shuffleOptions || false);
      setMinSelections(activity.config?.minSelections || 1);
      setShowAdvanced(!!(activity.config?.shuffleOptions || activity.config?.minSelections));

      // Load Quiz mode state
      const correctIds: string[] = activity.config?.correctOptionIds || [];
      setIsQuizMode(!!activity.config?.isQuiz && correctIds.length > 0);
      setCorrectOptionIndexes(
        correctIds
          .map((id) => opts.findIndex((o: any) => o.id === id))
          .filter((i) => i >= 0)
      );
    }
    else if (activity.type === "rating") {
      setRatingMin(activity.config?.min ?? 1);
      setRatingMax(activity.config?.max ?? 5);
      setRatingMinLabel(activity.config?.minLabel || "Rất không hiểu");
      setRatingMaxLabel(activity.config?.maxLabel || "Rất hiểu rõ");
      setRatingPointLabels((activity.config?.pointLabels as Record<number, string>) || {});
    }
    else if (activity.type === "qa") {
      setQaAllowAnonymous(activity.config?.allowAnonymous ?? true);
      setQaMaxQuestionsPerStudent(activity.config?.maxQuestionsPerStudent ?? null);
    }
    else if (activity.type === "board") {
      const savedCols = activity.config?.columns;
      if (Array.isArray(savedCols) && savedCols.length > 0) {
        setBoardColumns(savedCols);
      }
    }
    // wordcloud + opentext: không có state đặc thù

    setShowCreateModal(true);
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over || active.id === over.id) return;

    const oldIndex = sortedActivities.findIndex((a) => a._id === active.id);
    const newIndex = sortedActivities.findIndex((a) => a._id === over.id);

    const newOrder = arrayMove(sortedActivities, oldIndex, newIndex);

    await reorderActivities({
      sessionId: session!._id,
      orderedActivityIds: newOrder.map((a) => a._id),
    });
  };

  // Derived cho DragOverlay (tránh IIFE phức tạp trong JSX)
  const draggingActivity = activeDragId
    ? sortedActivities.find((a) => a._id === activeDragId)
    : null;

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-900">
        <div>Đang tải thông tin buổi giảng...</div>
      </div>
    );
  }

  // Sortable item component for drag and drop
  function SortableActivityItem({ activity, index, onEdit, onDuplicate, onRestart, onDelete }: any) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: activity._id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      // Khi đang kéo: chỉ để transform (để list không bị nhảy), opacity thấp để tạo "ghost/placeholder"
      opacity: isDragging ? 0.25 : 1,
    };

    const isStartingThis = isStarting === activity._id;

    const typeIcon: Record<string, string> = {
      poll: "📊", wordcloud: "☁️", rating: "⭐", qa: "❓", board: "📌", opentext: "✏️",
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`px-6 py-3 flex items-center gap-4 group border-b border-zinc-200 last:border-b-0 transition-all ${
          isDragging
            ? 'opacity-30 border-dashed border-emerald-600/50 bg-transparent'
            : activity.status === "active"
            ? 'bg-emerald-50/60 hover:bg-emerald-50'
            : 'hover:bg-zinc-100/60'
        }`}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className={`w-8 text-zinc-600 hover:text-emerald-600 cursor-grab active:cursor-grabbing select-none flex items-center justify-center rounded transition-colors text-lg leading-none ${
            isDragging ? 'text-emerald-500/40' : 'hover:bg-zinc-100'
          }`}
          title="Kéo để sắp xếp thứ tự kịch bản"
        >
          ⋮⋮
        </div>

        <div className="w-6 text-xs text-zinc-500 font-mono select-none">{index + 1}</div>

        <div className="text-xl select-none">{typeIcon[activity.type] || "•"}</div>

        <div className="flex-1 min-w-0">
          <div className="font-medium truncate flex items-center gap-2">
            {activity.title}
            {activity.status === "draft" && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-200 text-zinc-700 font-medium">NHÁP</span>
            )}
            {activity.status === "active" && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold animate-pulse">● ĐANG CHẠY · SV THẤY</span>
            )}
            {activity.status === "closed" && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-300 text-zinc-700 font-medium">ĐÃ ĐÓNG</span>
            )}
            {activity.status === "expired" && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-200 text-amber-800 font-medium">HẾT GIỜ</span>
            )}
          </div>
          <div className="text-xs text-zinc-500 flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="capitalize">{activity.type}</span>
            {activity.timeLimit && <span className="text-blue-600">⏱ {activity.timeLimit}p</span>}
            {activity.requiresStudentCode && <span className="text-emerald-700" title="Ghi nhận điểm tham gia">📋 Tính điểm</span>}
            {activity.slideCue && (
              <span className="text-amber-600 flex items-center gap-1">📍 {fmtSlide(activity.slideCue)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 opacity-80 group-hover:opacity-100">
          {/* Nút Bắt đầu / Đóng — quan trọng nhất, đặt to + nổi bật */}
          {activity.status === "draft" && (
            <button
              onClick={() => handleStart(activity._id)}
              disabled={isStartingThis}
              className="px-4 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors disabled:opacity-60 shadow-sm"
              title="Bắt đầu hoạt động — SV sẽ thấy ngay"
            >
              {isStartingThis ? "Đang bắt đầu..." : "▶ Bắt đầu"}
            </button>
          )}
          {activity.status === "active" && (
            <button
              onClick={() => handleClose(activity._id)}
              className="px-4 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors shadow-sm"
              title="Đóng hoạt động — SV không gửi thêm được"
            >
              ⏹ Đóng
            </button>
          )}
          {(activity.status === "closed" || activity.status === "expired") && (
            <button
              onClick={onRestart}
              className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
              title="Mở lại hoạt động này — xóa câu trả lời cũ, SV trả lời lại từ đầu"
            >
              🔄 Chạy lại
            </button>
          )}

          {/* AI chấm opentext — chỉ hiện khi opentext có đáp án mẫu + đã đóng */}
          {activity.type === "opentext" &&
            activity.config?.referenceAnswer &&
            (activity.status === "closed" || activity.status === "expired") && (
              <button
                onClick={() => setGradingActivityId(activity._id)}
                className="px-3 py-1.5 text-xs rounded-lg bg-violet-100 border border-violet-300 text-violet-800 hover:bg-violet-200 font-medium transition-colors"
                title="Mở modal chấm AI tự động + review từng câu"
              >
                🤖 Chấm AI
              </button>
            )}

          <button
            onClick={onEdit}
            disabled={activity.status === "active"}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={activity.status === "active" ? "Không thể sửa khi đang chạy" : "Sửa hoạt động"}
          >
            Sửa
          </button>
          <button
            onClick={onDelete}
            disabled={activity.status === "active"}
            className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={activity.status === "active" ? "Không thể xóa khi đang chạy" : "Xóa hoạt động"}
          >
            Xóa
          </button>
        </div>
      </div>
    );
  }

  // === Topbar handlers — gom logic ra ngoài JSX ===
  const handleNewRun = async () => {
    if (!session?._id) return;
    const currentRunNum = session.currentRun ?? 1;
    const nextRun = currentRunNum + 1;
    const wantExport = confirm(
      `Xuất Excel phiên #${currentRunNum} trước khi sang phiên mới?\n\n` +
        "OK = Có, xuất rồi tiếp tục\nCancel = Bỏ qua, chuyển luôn"
    );
    if (wantExport) await handleExportExcel();
    if (
      !confirm(
        `BẮT ĐẦU PHIÊN #${nextRun}?\n\n` +
          `• Lịch sử phiên #${currentRunNum} đã ${wantExport ? "xuất Excel + " : ""}lưu trong DB\n` +
          "• Hoạt động reset về NHÁP\n" +
          "• SV cũ tự đăng ký lại khi reload\n" +
          "• Giữ nguyên: tiêu đề activity, đáp án, Mốc slide, PDF, cấu hình điểm"
      )
    )
      return;
    try {
      const result = await resetSessionForNewRun({ sessionId: session._id });
      toast.success(`Đã bắt đầu Phiên #${result.newRun}. Reset ${result.activitiesReset} hoạt động.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Không thể reset phiên");
    }
  };

  const handleEndSession = async () => {
    if (!session?._id) return;
    const totalRuns = session.currentRun ?? 1;
    const wantExport = confirm(
      `Xuất Excel TOÀN BỘ ${totalRuns} phiên trước khi kết thúc?\n\nOK = Có, Cancel = Bỏ qua`
    );
    if (wantExport) {
      if (totalRuns > 1) await handleExportAllRuns();
      else await handleExportExcel();
    }
    if (!confirm("Kết thúc buổi giảng? SV sẽ không gửi thêm được. Kết quả vẫn lưu.")) return;
    try {
      await endSession({ sessionId: session._id });
      toast.success("Đã kết thúc buổi giảng.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Không thể kết thúc buổi");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Hidden file input cho upload PDF — luôn render */}
      <input
        ref={pdfFileInputRef}
        type="file"
        accept="application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUploadPdf(f);
        }}
        className="hidden"
      />

      {/* Top Bar — 1 dòng, dropdown groups */}
      <div className="border-b border-zinc-200 bg-zinc-50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2 flex items-center justify-between gap-2 sm:gap-3">
          {/* LEFT: Logo + LMS + Mã phòng + Title */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <Logo size="sm" showText={false} href="/" />
            <a
              href="https://lephuong-tlu.lovable.app/dashboard/courses"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-zinc-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40 text-zinc-700 hover:text-emerald-700 transition-colors shrink-0"
              title="Mở LMS quản lý môn học (tab mới)"
            >
              <span>📚</span>
              <span className="font-medium">LMS</span>
              <span className="text-zinc-400">↗</span>
            </a>
            <button
              onClick={() => setFullscreenOverlay("qr")}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-100 group shrink-0"
              title="Chiếu QR + mã phòng (phím Q)"
            >
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="QR"
                  className="w-9 h-9 rounded bg-white p-0.5 ring-1 ring-zinc-300 group-hover:ring-emerald-500 transition-all"
                />
              )}
              <div className="text-left">
                <div className="text-[9px] text-zinc-400 tracking-wider leading-none">MÃ PHÒNG</div>
                <div className="text-lg font-mono tracking-[3px] font-semibold text-zinc-900 group-hover:text-emerald-600 leading-tight">
                  {session.code}
                </div>
              </div>
            </button>
            <div className="h-8 w-px bg-zinc-200 hidden sm:block" />
            <div className="min-w-0 hidden md:block">
              <div className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                <span>BUỔI GIẢNG</span>
                <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold tracking-wider">
                  PHIÊN #{session.currentRun ?? 1}
                </span>
              </div>
              <div className="text-sm font-medium truncate max-w-[260px] lg:max-w-md" title={session.title}>
                {session.title}
              </div>
            </div>
            <button
              onClick={handleNewRun}
              className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium shrink-0 transition-colors"
              title="Đóng phiên hiện tại + bắt đầu phiên mới cho lớp khác (giữ activities)"
            >
              <span>🔄</span>
              <span>Phiên mới</span>
            </button>
          </div>

          {/* RIGHT: SV count + Dropdowns */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowParticipantsModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-lg border border-zinc-200 hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors"
              title="Xem danh sách sinh viên đã tham gia"
            >
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium tabular-nums">{totalParticipants}</span>
              <span className="text-xs text-zinc-500 hidden sm:inline">SV</span>
            </button>

            {/* 🎬 Chiếu */}
            <Dropdown
              align="right"
              width="w-72"
              trigger={
                <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors cursor-pointer">
                  🎬 <span className="hidden sm:inline">Chiếu</span> <span className="text-[10px] opacity-60">▾</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <DropdownLabel>Lên màn chiếu</DropdownLabel>
                  {hasPdf ? (
                    <DropdownItem
                      icon="📑"
                      label="Slide PDF"
                      hint={`${session.pdfFileName ?? "?"} · ${pdfTotalPages} trang`}
                      shortcut="S"
                      onClick={() => {
                        switchOverlay("slides");
                        close();
                      }}
                    />
                  ) : (
                    <DropdownItem
                      icon="📑"
                      label={isUploadingPdf ? "Đang upload..." : "Upload PDF slide"}
                      hint="Chọn file PDF (≤ 20MB) để chiếu thay PowerPoint"
                      disabled={isUploadingPdf}
                      onClick={() => {
                        pdfFileInputRef.current?.click();
                        close();
                      }}
                    />
                  )}
                  <DropdownItem
                    icon="🏆"
                    label="Bảng thành tích"
                    hint="Cửa sổ riêng — Top 10 realtime, dán lên slide PPT"
                    onClick={() => {
                      window.open(
                        `/presenter/${upperCode}/leaderboard`,
                        "leaderboard",
                        "width=900,height=600,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
                      );
                      close();
                    }}
                  />
                  <DropdownItem
                    icon="🔳"
                    label="QR + mã phòng"
                    hint="Cho SV scan / nhập mã"
                    shortcut="Q"
                    onClick={() => {
                      setFullscreenOverlay("qr");
                      close();
                    }}
                  />
                </>
              )}
            </Dropdown>

            {/* 🤖 AI */}
            <Dropdown
              align="right"
              width="w-72"
              trigger={
                <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors cursor-pointer">
                  🤖 <span className="hidden sm:inline">AI</span> <span className="text-[10px] opacity-60">▾</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <DropdownLabel>Sinh hoạt động</DropdownLabel>
                  <DropdownItem
                    icon="📄"
                    label="Từ slide PDF"
                    hint={hasPdf ? "Extract text PDF → gen 5-10 hoạt động" : "Cần upload PDF trước"}
                    disabled={!hasPdf}
                    onClick={() => {
                      setShowAiGenModal(true);
                      close();
                    }}
                  />
                  <DropdownItem
                    icon="🗳"
                    label="Khảo sát từ chủ đề"
                    hint="Nhập topic (vd phương pháp giảng dạy) → gen survey questions"
                    onClick={() => {
                      setShowSurveyModal(true);
                      close();
                    }}
                  />
                  <DropdownDivider />
                  <DropdownLabel>Phân tích cuối buổi</DropdownLabel>
                  <DropdownItem
                    icon="🧠"
                    label="Smart insights"
                    hint="Top mistakes, themes, summary cho GV và SV"
                    onClick={() => {
                      setShowInsightsModal(true);
                      close();
                    }}
                  />
                </>
              )}
            </Dropdown>

            {/* 💾 Xuất + Phiên */}
            <Dropdown
              align="right"
              width="w-72"
              trigger={
                <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold transition-colors cursor-pointer">
                  💾 <span className="hidden sm:inline">Xuất</span> <span className="text-[10px] opacity-60">▾</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <DropdownLabel>Excel</DropdownLabel>
                  <DropdownItem
                    icon="📊"
                    label={`Excel phiên #${session.currentRun ?? 1}`}
                    hint="Điểm danh + câu trả lời + chấm điểm phiên hiện tại"
                    disabled={!exportData || isExporting}
                    onClick={() => {
                      handleExportExcel();
                      close();
                    }}
                  />
                  {(session.currentRun ?? 1) > 1 && (
                    <DropdownItem
                      icon="📚"
                      label={`Tất cả ${session.currentRun} phiên`}
                      hint="Multi-sheet: tổng quan + chi tiết từng phiên"
                      disabled={isExporting}
                      onClick={() => {
                        handleExportAllRuns();
                        close();
                      }}
                    />
                  )}
                </>
              )}
            </Dropdown>

            {/* ⚙️ Cài đặt */}
            <Dropdown
              align="right"
              width="w-64"
              trigger={
                <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg bg-white hover:bg-zinc-100 border border-zinc-300 text-zinc-700 transition-colors cursor-pointer">
                  ⚙️ <span className="text-[10px] opacity-60">▾</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <DropdownLabel>Hiển thị</DropdownLabel>
                  <DropdownItem
                    icon={bigTextMode ? "🔍" : "🔎"}
                    label={bigTextMode ? "Tắt text lớn" : "Bật text lớn"}
                    hint="Cho SV ngồi cuối lớp đọc rõ — phóng tiêu đề + countdown trên màn chiếu"
                    highlight={bigTextMode}
                    onClick={() => {
                      toggleBigTextMode();
                      close();
                    }}
                  />
                  {session.status !== "ended" && (
                    <>
                      <DropdownDivider />
                      <DropdownItem
                        icon="⏹"
                        label="Kết thúc buổi giảng"
                        hint="SV không gửi thêm được. Kết quả vẫn lưu."
                        danger
                        onClick={() => {
                          handleEndSession();
                          close();
                        }}
                      />
                    </>
                  )}
                  {session.status === "ended" && (
                    <div className="px-3 py-2 text-xs text-zinc-500 italic">Buổi đã kết thúc</div>
                  )}
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </div>

      {/* ==================== PANEL HƯỚNG DẪN (toggle) ==================== */}
      <div className="max-w-7xl mx-auto px-6 pt-4">
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 font-medium transition-colors"
        >
          {showHelp ? "▼" : "▶"} 📖 Hướng dẫn sử dụng nhanh
        </button>

        {showHelp && (
          <div className="mt-3 bg-white border border-blue-200 rounded-2xl p-6 shadow-sm space-y-5">
            {/* Hàng 1: 2 workflow chọn cách dùng phù hợp */}
            <div>
              <div className="text-sm font-semibold text-zinc-900 mb-2.5">Chọn workflow phù hợp:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Workflow 1: PDF */}
                <div className="border-2 border-indigo-200 rounded-xl p-4 bg-indigo-50/40">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">📑</span>
                    <div className="font-semibold text-indigo-900">Workflow A — PDF, 1 cửa sổ</div>
                  </div>
                  <div className="text-xs text-zinc-700 leading-relaxed mb-2">
                    Xuất PPT → PDF rồi upload. Toàn bộ buổi giảng trong 1 tab browser, <strong>không Alt+Tab</strong>.
                  </div>
                  <ol className="text-xs text-zinc-700 space-y-1 list-decimal pl-4">
                    <li>Upload PDF qua nút <strong>📑 Upload PDF</strong></li>
                    <li>Bấm <kbd className="px-1 py-0.5 text-[10px] font-mono bg-white border border-indigo-300 rounded">S</kbd> chiếu slide fullscreen, <kbd className="px-1 py-0.5 text-[10px] font-mono bg-white border border-indigo-300 rounded">← →</kbd> chuyển trang</li>
                    <li>Bấm <kbd className="px-1 py-0.5 text-[10px] font-mono bg-white border border-indigo-300 rounded">F</kbd> chiếu kết quả khi cần</li>
                    <li><kbd className="px-1 py-0.5 text-[10px] font-mono bg-white border border-indigo-300 rounded">Esc</kbd> tự về slide</li>
                  </ol>
                  <div className="text-[11px] text-indigo-700 mt-2">⚠ Mất animation PPT, chỉ có ảnh tĩnh slide.</div>
                </div>

                {/* Workflow 2: PPT */}
                <div className="border-2 border-amber-200 rounded-xl p-4 bg-amber-50/40">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">🎯</span>
                    <div className="font-semibold text-amber-900">Workflow B — Giữ PPT, dùng cửa sổ nổi</div>
                  </div>
                  <div className="text-xs text-zinc-700 leading-relaxed mb-2">
                    PPT giữ nguyên cho animation đẹp. Web app mở <strong>cửa sổ nổi nhỏ trên PPT</strong> để điều khiển không Alt+Tab.
                  </div>
                  <ol className="text-xs text-zinc-700 space-y-1 list-decimal pl-4">
                    <li><strong>Trước buổi:</strong> Bấm Q → 💾 <strong>Tải QR</strong> → dán vào slide đầu PPT</li>
                    <li>Vào menu <kbd className="px-1 py-0.5 text-[10px] font-mono bg-white border border-amber-300 rounded">⋯</kbd> → <strong>Bảng điều khiển nổi</strong> (Chrome 116+)</li>
                    <li>PPT chạy fullscreen, cửa sổ nổi hiện ở góc → thấy response count, bấm Bắt đầu/Đóng từ đó</li>
                    <li>Khi cần chiếu kết quả to: Alt+Tab → <kbd className="px-1 py-0.5 text-[10px] font-mono bg-white border border-amber-300 rounded">F</kbd> → Alt+Tab về PPT</li>
                  </ol>
                  <div className="text-[11px] text-amber-700 mt-2">💡 Cửa sổ nổi này nổi trên MỌI ứng dụng (kể cả PPT fullscreen)</div>
                </div>
              </div>
            </div>

            {/* Hàng 2: 3 cột chi tiết */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-zinc-200">
              {/* Cột 1: Flow tạo */}
              <div>
                <div className="text-sm font-semibold text-zinc-900 mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs flex items-center justify-center font-bold">1</span>
                  Tạo & chạy hoạt động
                </div>
                <ol className="text-xs text-zinc-700 space-y-1.5 list-decimal pl-4 leading-relaxed">
                  <li>Bấm <strong className="text-emerald-700">+ Tạo hoạt động</strong> → chọn loại (6 loại)</li>
                  <li>Điền cấu hình → bấm <strong className="text-emerald-700">Tạo</strong></li>
                  <li>Hoạt động ở trạng thái <span className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-200 text-zinc-700">NHÁP</span></li>
                  <li>Bấm <strong className="text-emerald-700">▶ Bắt đầu</strong> → SV thấy & trả lời</li>
                  <li>Bấm <strong className="text-red-700">⏹ Đóng</strong> khi xong</li>
                  <li>Bấm <strong className="text-blue-700">🔄 Chạy lại</strong> nếu muốn mở lại với câu trả lời mới</li>
                </ol>
              </div>

              {/* Cột 2: Phím tắt */}
              <div>
                <div className="text-sm font-semibold text-zinc-900 mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs flex items-center justify-center font-bold">⌨</span>
                  Phím tắt
                </div>
                <div className="text-xs text-zinc-700 space-y-1.5 leading-relaxed">
                  <div className="text-[10px] tracking-wider font-semibold text-zinc-500 mb-1">CHIẾU OVERLAY</div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">Q</kbd><span>QR + mã phòng to</span></div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">F</kbd><span>Kết quả + Bảng thành tích (2 tab)</span></div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">S</kbd><span>Chiếu slide PDF</span></div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">T</kbd><span>Toggle tab trong overlay F</span></div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">Esc</kbd><span>Thoát overlay</span></div>

                  <div className="text-[10px] tracking-wider font-semibold text-zinc-500 mb-1 pt-2 mt-1 border-t border-zinc-200">ĐIỀU KHIỂN HOẠT ĐỘNG</div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-emerald-100 border border-emerald-300 text-emerald-800 rounded shadow-sm">A</kbd><span>▶ Kích hoạt + mở overlay (kết quả ẩn)</span></div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-amber-100 border border-amber-300 text-amber-800 rounded shadow-sm">R</kbd><span>👁 Công bố kết quả lên màn hình</span></div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-red-100 border border-red-300 text-red-800 rounded shadow-sm">X</kbd><span>⏹ Đóng activity (bấm X 2 lần = đóng overlay về slide)</span></div>

                  <div className="text-[10px] tracking-wider font-semibold text-zinc-500 mb-1 pt-2 mt-1 border-t border-zinc-200">DI CHUYỂN</div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">Space</kbd><span>Bước kế / next slide</span></div>
                  <div className="flex items-center gap-2"><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">←</kbd><kbd className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm">→</kbd><span>Chuyển slide</span></div>
                </div>
              </div>

              {/* Cột 3: Trạng thái */}
              <div>
                <div className="text-sm font-semibold text-zinc-900 mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs flex items-center justify-center font-bold">●</span>
                  Trạng thái hoạt động
                </div>
                <div className="text-xs text-zinc-700 space-y-2 leading-relaxed">
                  <div><span className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-200 text-zinc-700 font-medium">NHÁP</span> Đã tạo nhưng SV chưa thấy</div>
                  <div><span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-600 text-white font-semibold">● ĐANG CHẠY</span> SV đang trả lời được</div>
                  <div><span className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-300 text-zinc-700 font-medium">ĐÃ ĐÓNG</span> Không nhận thêm trả lời</div>
                  <div><span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-200 text-amber-800 font-medium">HẾT GIỜ</span> Tự đóng do hết timeLimit</div>
                  <div className="pt-2 mt-2 border-t border-zinc-200">
                    <strong>📋 Tính điểm:</strong> Bật toggle <em>Ghi nhận điểm tham gia</em> → câu trả lời tính vào Bảng thành tích.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* === TỔNG QUAN BUỔI GIẢNG (tạm ẩn để ổn định syntax — sẽ khôi phục + cải thiện ở Results) === */}
        {/* {exportData && ( ... dashboard stats ... )} */}

        {/* ==================== KỊCH BẢN (gọn — chỉ 3 nút chính + menu ⋯) ==================== */}
        {sortedActivities.length > 0 && (
          <div className="mb-6 bg-white border border-zinc-200 rounded-2xl px-5 py-3 flex items-center gap-4">
            {/* Trạng thái + progress (chỉ hiện khi đang chạy) */}
            <div className="flex-1 min-w-0">
              {!isScriptMode ? (
                <div className="text-sm text-zinc-600">
                  <strong className="text-zinc-900">Kịch bản:</strong> {scriptLength} hoạt động
                  <span className="ml-2 text-xs text-zinc-500">— bấm Chạy để bắt đầu theo thứ tự, dùng <kbd className="px-1 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-[10px]">Space</kbd> chuyển bước</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium text-xs">● ĐANG CHẠY</span>
                  <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className="h-1.5 bg-emerald-500 transition-all" style={{ width: scriptLength > 0 ? `${((currentScriptIndex + 1) / scriptLength) * 100}%` : "0%" }} />
                  </div>
                  <span className="font-mono text-emerald-600 text-xs whitespace-nowrap">{currentScriptIndex + 1}/{scriptLength}</span>
                  {currentScriptActivity?.slideCue && (
                    <span className="text-amber-600 text-xs font-medium whitespace-nowrap">📍 {fmtSlide(currentScriptActivity.slideCue)}</span>
                  )}
                </div>
              )}
            </div>

            {/* Nút chính + menu ⋯ */}
            <div className="flex items-center gap-1.5 shrink-0">
              {!isScriptMode ? (
                <button onClick={startScriptMode} className="px-4 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">
                  ▶ Chạy kịch bản
                </button>
              ) : (
                <>
                  <button onClick={goToPrevInScript} disabled={currentScriptIndex === 0} className="px-3 py-1.5 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40" title="Bước trước">←</button>
                  <button onClick={goToNextInScript} disabled={currentScriptIndex >= scriptLength - 1} className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40" title="Bước tiếp">Tiếp →</button>
                  <button onClick={stopScriptMode} className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Dừng kịch bản">Dừng</button>
                </>
              )}

              {/* Menu ⋯ — các action ít dùng */}
              <div className="relative">
                <button
                  onClick={() => setShowScriptMenu(!showScriptMenu)}
                  className="px-2.5 py-1.5 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700"
                  title="Thêm tùy chọn"
                >
                  ⋯
                </button>
                {showScriptMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowScriptMenu(false)} />
                    <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-zinc-200 rounded-xl shadow-lg z-40 py-1">
                      <button
                        onClick={() => { openFloatingPanel(); setShowScriptMenu(false); }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-zinc-100 flex items-start gap-2"
                        title="Cửa sổ nhỏ nổi trên PPT (Chrome 116+) — không cần Alt+Tab"
                      >
                        <span className="text-xl shrink-0">🪟</span>
                        <div>
                          <div className="font-semibold">Bảng điều khiển nổi</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">Nổi trên PPT, không cần Alt+Tab (Chrome 116+)</div>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === Hàng tiện ích: Lưu mẫu / Mẫu đã lưu / Cấu hình điểm === */}
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          <button
            onClick={async () => {
              const name = prompt("Tên kịch bản mẫu (vd: Đập và Hồ chứa - Buổi 1):");
              if (!name || !session?._id) return;
              try {
                await saveScriptAsTemplate({ sessionId: session._id, name: name.trim() });
                toast.success("Đã lưu kịch bản mẫu");
              } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : "Lỗi");
              }
            }}
            disabled={sortedActivities.length === 0}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700 disabled:opacity-50"
            title="Lưu danh sách hoạt động hiện tại thành mẫu để dùng lại buổi sau"
          >
            💾 Lưu mẫu kịch bản
          </button>
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700"
            title="Mở danh sách mẫu đã lưu để áp dụng vào buổi này"
          >
            📚 Mẫu đã lưu
          </button>
          <button
            onClick={() => setShowScoringConfig(true)}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700"
            title="Tùy chỉnh điểm cho từng loại hoạt động trong Bảng thành tích"
          >
            ⚙️ Cấu hình điểm thành tích
          </button>
        </div>

        {/* === Slide PDF status (nếu đã upload) === */}
        {hasPdf && (
          <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-2xl">📑</div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-indigo-800 truncate">{session.pdfFileName}</div>
                <div className="text-xs text-indigo-600/80">{pdfTotalPages} trang • Đang ở trang {pdfCurrentPage}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setFullscreenOverlay("slides")}
                className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
              >
                Chiếu slide (S)
              </button>
              <button
                onClick={() => pdfFileInputRef.current?.click()}
                disabled={isUploadingPdf}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700 disabled:opacity-60"
                title="Thay file PDF khác"
              >
                Đổi PDF
              </button>
              <button
                onClick={async () => {
                  if (!session?._id) return;
                  if (!confirm("Xóa slide PDF khỏi buổi này?")) return;
                  await clearSessionPdf({ sessionId: session._id });
                  toast.success("Đã xóa slide PDF");
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-200 hover:bg-red-50 text-red-600"
              >
                Xóa
              </button>
            </div>
          </div>
        )}

        {/* === Tạo hoạt động — dropdown gọn === */}
        <div className="mb-6 relative">
          <button
            onClick={() => setShowCreatePicker(!showCreatePicker)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm transition-colors"
          >
            <span className="text-lg">+</span> Tạo hoạt động
            <span className="text-xs opacity-70">{showCreatePicker ? "▲" : "▼"}</span>
          </button>

          {showCreatePicker && (
            <>
              {/* Click-away */}
              <div className="fixed inset-0 z-30" onClick={() => setShowCreatePicker(false)} />

              <div className="absolute top-full left-0 mt-2 w-[640px] max-w-[calc(100vw-2rem)] bg-white border border-zinc-200 rounded-2xl shadow-xl p-3 z-40">
                <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Chọn loại hoạt động</div>

                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { type: "poll", icon: "📊", name: "Trắc nghiệm", desc: "SV chọn 1 hoặc nhiều đáp án có sẵn (hỗ trợ chế độ Quiz)", color: "blue" },
                    { type: "wordcloud", icon: "☁️", name: "Đám mây từ", desc: "Từ khóa ngắn, từ trùng → cụm to (brainstorm)", color: "sky" },
                    { type: "rating", icon: "⭐", name: "Thang điểm", desc: "Chấm 1–N với nhãn thấp/cao tùy chỉnh", color: "amber" },
                    { type: "qa", icon: "❓", name: "Hỏi đáp", desc: "SV đặt câu hỏi tự do, có upvote", color: "emerald" },
                    { type: "opentext", icon: "✏️", name: "Trả lời ngắn", desc: "Câu trả lời 1–2 câu, không gom tần suất", color: "teal" },
                    { type: "board", icon: "📌", name: "Bảng cộng tác", desc: "Padlet — đăng text + ảnh theo cột", color: "purple" },
                  ].map((item) => (
                    <button
                      key={item.type}
                      onClick={() => {
                        openCreateModal(item.type as "poll" | "wordcloud" | "rating" | "qa" | "board" | "opentext");
                        setShowCreatePicker(false);
                      }}
                      className="text-left p-3 rounded-xl hover:bg-zinc-50 active:bg-zinc-100 transition-colors flex items-start gap-3 group"
                    >
                      <span className="text-2xl shrink-0 mt-0.5">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-zinc-900 group-hover:text-emerald-700 text-sm">
                          {item.name}
                        </div>
                        <div className="text-xs text-zinc-600 mt-0.5 leading-snug">
                          {item.desc}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ==================== DANH SÁCH HOẠT ĐỘNG (Kéo thả + Chỉnh sửa) ==================== */}
        {sortedActivities.length > 0 && (
          <div className="mb-6 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-3 border-b border-zinc-200 bg-zinc-100/60 flex items-center justify-between">
              <div>
                <span className="font-medium">Danh sách hoạt động</span>
                <span className="ml-2 text-xs text-zinc-500">({sortedActivities.length} hoạt động • Kéo thả để sắp xếp thứ tự kịch bản)</span>
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(event) => setActiveDragId(event.active.id as string)}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveDragId(null)}
            >
              <SortableContext
                items={sortedActivities.map((a) => a._id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-zinc-800">
                  {sortedActivities.map((activity, index) => (
                    <SortableActivityItem
                      key={activity._id}
                      activity={activity}
                      index={index}
                      onEdit={() => openEditModal(activity)}
                      onDuplicate={() => handleDuplicate(activity._id)}
                      onRestart={() => handleRestart(activity._id, activity.title)}
                      onDelete={() => handleDelete(activity._id, activity.title)}
                    />
                  ))}
                </div>
              </SortableContext>

              {/* DragOverlay: Hiển thị bản preview nổi đẹp khi đang kéo (chất lượng cao cho Dnd list) */}
              <DragOverlay>
                {draggingActivity ? (
                  <div className="px-6 py-3 flex items-center gap-4 bg-zinc-100 border border-emerald-500 rounded-xl shadow-2xl opacity-95">
                    <div className="w-8 text-emerald-600 flex items-center justify-center text-lg">⋮⋮</div>
                    <div className="w-6 text-xs text-zinc-500 font-mono">
                      {sortedActivities.findIndex((a) => a._id === draggingActivity._id) + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{draggingActivity.title}</div>
                      <div className="text-xs text-zinc-600 flex items-center gap-2 mt-0.5">
                        <span className="capitalize">{draggingActivity.type}</span>
                        {draggingActivity.slideCue && <span className="text-amber-600">📍 {fmtSlide(draggingActivity.slideCue)}</span>}
                        {draggingActivity.timeLimit && <span>⏱ {draggingActivity.timeLimit}p</span>}
                      </div>
                    </div>
                    <div className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-600">ĐANG KÉO</div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        )}

        {/* ==================== CREATE / EDIT ACTIVITY MODAL (UNIFIED, FULL CONFIG) ==================== */}
        {(showCreateModal || editingActivity) && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowCreateModal(false);
                setEditingActivity(null);
              }
            }}
          >
            <div className="bg-white border border-zinc-300 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
              {/* Header sticky */}
              <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-start justify-between z-10">
                <div>
                  <div className="text-xl font-semibold">
                    {editingActivity ? "Chỉnh sửa hoạt động" : "Tạo hoạt động mới"}
                  </div>
                  <div className="text-sm text-zinc-600 mt-0.5">
                    {editingActivity
                      ? `Đang sửa: ${editingActivity.title}`
                      : "Cấu hình đầy đủ cho từng loại hoạt động"}
                  </div>
                </div>
                <button
                  onClick={() => { setShowCreateModal(false); setEditingActivity(null); }}
                  className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="px-6 py-5 space-y-5">
                {/* ===== Loại hoạt động (chỉ hiển thị badge, không cho đổi) ===== */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                  <div className="text-2xl">
                    {createType === "poll" && "📊"}
                    {createType === "wordcloud" && "☁️"}
                    {createType === "rating" && "⭐"}
                    {createType === "qa" && "❓"}
                    {createType === "opentext" && "✏️"}
                    {createType === "board" && "📌"}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-zinc-900">
                      {createType === "poll" && "Trắc nghiệm (Poll)"}
                      {createType === "wordcloud" && "Đám mây từ (Word Cloud)"}
                      {createType === "rating" && "Thang điểm (Rating)"}
                      {createType === "qa" && "Hỏi đáp (Q&A)"}
                      {createType === "opentext" && "Trả lời ngắn (Open Text)"}
                      {createType === "board" && "Bảng cộng tác (Board)"}
                    </div>
                    <div className="text-xs text-zinc-600 mt-0.5">
                      {createType === "poll" && "SV chọn 1 hoặc nhiều đáp án từ danh sách có sẵn"}
                      {createType === "wordcloud" && "SV nhập từ khóa ngắn, các từ trùng gom thành cụm to"}
                      {createType === "rating" && "SV chấm điểm theo thang số bạn đặt"}
                      {createType === "qa" && "SV đặt câu hỏi tự do, có thể upvote câu hay"}
                      {createType === "opentext" && "SV nhập câu trả lời ngắn 1-2 câu, hiển thị danh sách đầy đủ"}
                      {createType === "board" && "SV đăng text + ảnh theo cột phân loại"}
                    </div>
                  </div>
                </div>

                {/* ===== Tiêu đề + mô tả ===== */}
                <div>
                  <label className="text-sm font-semibold text-zinc-700 block mb-1.5">
                    Tiêu đề <span className="text-red-500">*</span>
                  </label>
                  <VnInput
                    type="text"
                    value={pollTitle}
                    onValueChange={(v) => { setPollTitle(v); setTitleError(""); }}
                    placeholder="VD: Phân loại đập theo vật liệu"
                    className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500"
                  />
                  {titleError && <div className="text-xs text-red-600 mt-1">{titleError}</div>}
                </div>

                <div>
                  <label className="text-sm font-semibold text-zinc-700 block mb-1.5">Mô tả (tùy chọn)</label>
                  <VnTextarea
                    value={pollDescription}
                    onValueChange={setPollDescription}
                    placeholder="Giải thích/gợi ý hiển thị dưới tiêu đề khi SV trả lời"
                    rows={2}
                    className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-2 text-sm resize-y focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-zinc-700 block mb-1.5">
                    Mốc slide (tùy chọn)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-500 shrink-0">Slide số</span>
                    <input
                      type="number"
                      min={1}
                      value={slideCue}
                      onChange={(e) => setSlideCue(e.target.value.replace(/\D/g, ""))}
                      placeholder="VD: 7"
                      className="w-24 bg-white border border-zinc-300 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 text-center font-mono"
                    />
                    {slideCue && (
                      <span className="text-sm text-amber-600 font-medium">
                        → 📍 Slide {slideCue}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Đánh dấu hoạt động này gắn với slide nào trong bài giảng PowerPoint
                  </div>
                </div>

                {/* ===== POLL-specific ===== */}
                {createType === "poll" && (
                  <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <div className="text-sm font-semibold text-blue-900">⚙️ Cấu hình Poll</div>

                    <div>
                      <label className="text-sm text-zinc-700 block mb-1.5">Kiểu chọn đáp án</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPollType("single_choice")}
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border ${pollType === "single_choice" ? "bg-blue-600 border-blue-600 text-white font-medium" : "bg-white border-zinc-300 text-zinc-700"}`}
                        >
                          ◉ Chọn 1 đáp án
                        </button>
                        <button
                          onClick={() => setPollType("multiple_choice")}
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border ${pollType === "multiple_choice" ? "bg-blue-600 border-blue-600 text-white font-medium" : "bg-white border-zinc-300 text-zinc-700"}`}
                        >
                          ☑ Chọn nhiều đáp án
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm text-zinc-700">Các lựa chọn <span className="text-red-500">*</span></label>
                        <span className="text-xs text-zinc-500">{options.filter(o => o.trim()).length} / {options.length} đã nhập</span>
                      </div>
                      <div className="space-y-2">
                        {options.map((opt, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <span className="w-6 text-center text-xs text-zinc-500 font-mono">{idx + 1}.</span>
                            <TextInputRow
                              initialValue={opt}
                              placeholder={`Lựa chọn ${idx + 1}${idx === 0 ? " (VD: Đập bê tông trọng lực)" : ""}`}
                              showRemove={options.length > 2}
                              onUpdate={(val) => {
                                setOptions((prev) => {
                                  const next = [...prev];
                                  next[idx] = val;
                                  return next;
                                });
                              }}
                              onRemove={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => setOptions([...options, ""])}
                          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                        >
                          + Thêm lựa chọn
                        </button>
                      </div>
                    </div>

                    {/* Multi-choice: số lựa chọn tối thiểu */}
                    {pollType === "multiple_choice" && (
                      <div>
                        <label className="text-sm text-zinc-700 block mb-1.5">
                          Số lựa chọn tối thiểu SV phải chọn
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={options.length}
                            value={minSelections}
                            onChange={(e) => setMinSelections(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-20 bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                          />
                          <span className="text-xs text-zinc-500">/ {options.filter(o => o.trim()).length} đáp án</span>
                        </div>
                      </div>
                    )}

                    {/* Toggle nâng cao */}
                    <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer pt-2 border-t border-blue-200">
                      <input
                        type="checkbox"
                        checked={shuffleOptions}
                        onChange={(e) => setShuffleOptions(e.target.checked)}
                        className="w-4 h-4 accent-blue-600"
                      />
                      Xáo trộn thứ tự đáp án cho từng SV
                    </label>

                    {/* Quiz mode: đánh dấu đáp án đúng */}
                    <div className="pt-2 border-t border-blue-200">
                      <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isQuizMode}
                          onChange={(e) => {
                            setIsQuizMode(e.target.checked);
                            if (!e.target.checked) setCorrectOptionIndexes([]);
                          }}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <span className="font-medium">🎯 Chế độ Quiz</span>
                        <span className="text-xs text-zinc-500">— có đáp án đúng, SV được báo đúng/sai sau khi gửi</span>
                      </label>

                      {isQuizMode && (
                        <div className="mt-2 ml-6 p-3 bg-white rounded-lg border border-blue-300">
                          <div className="text-xs text-zinc-700 mb-2">Đánh dấu đáp án đúng (có thể chọn nhiều):</div>
                          <div className="space-y-1.5">
                            {options.map((opt, idx) => {
                              if (!opt.trim()) return null;
                              const isCorrect = correctOptionIndexes.includes(idx);
                              return (
                                <label key={idx} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-blue-50 px-2 py-1 rounded">
                                  <input
                                    type="checkbox"
                                    checked={isCorrect}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setCorrectOptionIndexes([...correctOptionIndexes, idx]);
                                      } else {
                                        setCorrectOptionIndexes(correctOptionIndexes.filter((i) => i !== idx));
                                      }
                                    }}
                                    className="w-4 h-4 accent-emerald-600"
                                  />
                                  <span className={isCorrect ? "text-emerald-700 font-medium" : "text-zinc-700"}>
                                    {isCorrect && "✓ "}{opt}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          {correctOptionIndexes.length === 0 && (
                            <div className="text-xs text-amber-600 mt-2">⚠ Chưa đánh dấu đáp án đúng nào</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ===== OPEN TEXT-specific ===== */}
                {createType === "opentext" && (
                  <div className="space-y-3">
                    <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl text-sm text-zinc-700">
                      <div className="text-sm font-semibold text-teal-900 mb-2">⚙️ Cấu hình Trả lời ngắn</div>
                      SV nhập câu trả lời ngắn (tối đa 500 ký tự). Khác Word Cloud: <strong>không gom tần suất</strong>, hiển thị danh sách tất cả câu trả lời.
                    </div>

                    <div className="p-4 bg-violet-50 border border-violet-200 rounded-xl">
                      <label className="text-sm font-semibold text-violet-900 block mb-1.5">
                        🤖 Đáp án mẫu (để AI tự chấm)
                      </label>
                      <VnTextarea
                        value={referenceAnswer}
                        onValueChange={setReferenceAnswer}
                        placeholder="VD: Đập đất an toàn khi đáp ứng 3 điều kiện: ổn định mái dốc, không thấm nước quá mức, chịu được động đất."
                        rows={3}
                        className="w-full bg-white border border-violet-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-violet-500"
                      />
                      <div className="text-xs text-violet-700 mt-1.5">
                        Để trống nếu không cần chấm tự động. Khi có đáp án mẫu, sau khi đóng hoạt động, bạn có thể bấm <strong>&ldquo;🤖 Chấm AI&rdquo;</strong> — AI so sánh từng câu trả lời với đáp án này → correct / partial / wrong. Bạn có thể override.
                      </div>
                    </div>
                  </div>
                )}

                {/* ===== WORD CLOUD-specific ===== */}
                {createType === "wordcloud" && (
                  <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl text-sm text-zinc-700">
                    <div className="text-sm font-semibold text-sky-900 mb-2">⚙️ Cấu hình Word Cloud</div>
                    Sinh viên nhập từ khóa ngắn (tối đa 30 ký tự). Các từ trùng nhau sẽ được gom lại — từ có tần suất cao nhất hiển thị to nhất.
                  </div>
                )}

                {/* ===== RATING-specific ===== */}
                {createType === "rating" && (
                  <div className="space-y-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="text-sm font-semibold text-amber-900">⚙️ Cấu hình thang điểm</div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm text-zinc-700 block mb-1.5">Điểm thấp nhất</label>
                        <input
                          type="number"
                          min={0}
                          value={ratingMin}
                          onChange={(e) => setRatingMin(parseInt(e.target.value) || 1)}
                          className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-zinc-700 block mb-1.5">Điểm cao nhất</label>
                        <input
                          type="number"
                          min={ratingMin + 1}
                          value={ratingMax}
                          onChange={(e) => setRatingMax(parseInt(e.target.value) || 5)}
                          className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm text-zinc-700 block mb-1.5">Nhãn điểm thấp</label>
                        <VnInput
                          type="text"
                          value={ratingMinLabel}
                          onValueChange={setRatingMinLabel}
                          placeholder="Rất không hiểu"
                          className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-zinc-700 block mb-1.5">Nhãn điểm cao</label>
                        <VnInput
                          type="text"
                          value={ratingMaxLabel}
                          onValueChange={setRatingMaxLabel}
                          placeholder="Rất hiểu rõ"
                          className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    {/* Nhãn cho từng điểm (tùy chọn) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-zinc-700">Ý nghĩa từng điểm (tùy chọn, SV thấy rõ hơn)</label>
                      </div>
                      <div className="space-y-1.5">
                        {Array.from({ length: ratingMax - ratingMin + 1 }, (_, i) => {
                          const point = ratingMin + i;
                          // Auto-fill min/max label nếu point trùng min/max và chưa có pointLabel riêng
                          const defaultText = point === ratingMin ? ratingMinLabel
                            : point === ratingMax ? ratingMaxLabel
                            : "";
                          return (
                            <div key={point} className="flex items-center gap-2">
                              <span className="w-8 text-center font-mono font-semibold text-amber-700 bg-amber-100 rounded">
                                {point}
                              </span>
                              <VnInput
                                type="text"
                                value={ratingPointLabels[point] || ""}
                                onValueChange={(v) => setRatingPointLabels({ ...ratingPointLabels, [point]: v })}
                                placeholder={defaultText || `Ý nghĩa điểm ${point}`}
                                className="flex-1 bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-sm"
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-2">
                        Để trống nếu chỉ cần dùng nhãn min/max ở trên. Khi có nhãn từng điểm, SV thấy đầy đủ ý nghĩa lúc chọn.
                      </div>
                    </div>

                    <div className="text-xs text-amber-800 bg-amber-100/60 px-3 py-2 rounded-lg">
                      Thang điểm sẽ hiển thị từ <strong>{ratingMin}</strong> đến <strong>{ratingMax}</strong> ({ratingMax - ratingMin + 1} mức)
                    </div>
                  </div>
                )}

                {/* ===== Q&A-specific ===== */}
                {createType === "qa" && (
                  <div className="space-y-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="text-sm font-semibold text-emerald-900">⚙️ Cấu hình Q&A</div>

                    <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qaAllowAnonymous}
                        onChange={(e) => setQaAllowAnonymous(e.target.checked)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      Cho phép SV đặt câu hỏi ẩn danh (không kèm tên)
                    </label>

                    <div>
                      <label className="text-sm text-zinc-700 block mb-1.5">
                        Số câu hỏi tối đa mỗi SV được đặt (để trống = không giới hạn)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={qaMaxQuestionsPerStudent ?? ""}
                        onChange={(e) => setQaMaxQuestionsPerStudent(e.target.value === "" ? null : parseInt(e.target.value))}
                        placeholder="Không giới hạn"
                        className="w-40 bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* ===== BOARD-specific ===== */}
                {createType === "board" && (
                  <div className="space-y-3 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                    <div className="text-sm font-semibold text-purple-900">⚙️ Cấu hình Board</div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm text-zinc-700">Các cột trên bảng</label>
                        <span className="text-xs text-zinc-500">{boardColumns.length} cột</span>
                      </div>
                      <div className="space-y-2">
                        {boardColumns.map((col, idx) => (
                          <div key={col.id} className="flex gap-2 items-center">
                            <span className="w-6 text-center text-xs text-zinc-500 font-mono">{idx + 1}.</span>
                            <TextInputRow
                              initialValue={col.title}
                              placeholder={`Tên cột ${idx + 1}`}
                              showRemove={boardColumns.length > 1}
                              onUpdate={(val) => {
                                setBoardColumns((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...prev[idx], title: val };
                                  return next;
                                });
                              }}
                              onRemove={() => setBoardColumns((prev) => prev.filter((_, i) => i !== idx))}
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => setBoardColumns([...boardColumns, { id: `col_${Date.now()}`, title: "" }])}
                          className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                        >
                          + Thêm cột
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ===== Thời gian giới hạn (cho tất cả loại) ===== */}
                <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                    ⏱️ Thời gian trả lời
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {[
                      { mode: "unlimited" as const, value: 0, label: "∞ Không giới hạn" },
                      { mode: "preset" as const, value: 0.5, label: "30 giây" },
                      { mode: "preset" as const, value: 1, label: "1 phút" },
                      { mode: "preset" as const, value: 2, label: "2 phút" },
                      { mode: "preset" as const, value: 5, label: "5 phút" },
                      { mode: "custom" as const, value: timeLimitValue, label: "Tùy chỉnh" },
                    ].map((opt) => {
                      const isActive = opt.mode === "unlimited"
                        ? timeLimitMode === "unlimited"
                        : opt.mode === "custom"
                          ? timeLimitMode === "custom"
                          : timeLimitMode === "preset" && timeLimitValue === opt.value;
                      return (
                        <button
                          key={opt.label}
                          onClick={() => {
                            setTimeLimitMode(opt.mode);
                            if (opt.mode === "preset") setTimeLimitValue(opt.value);
                          }}
                          className={`px-2 py-2 text-xs rounded-lg border transition-colors ${
                            isActive
                              ? "bg-emerald-600 border-emerald-500 text-white font-medium"
                              : "bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                          } ${opt.label === "∞ Không giới hạn" ? "col-span-3 sm:col-span-1" : ""}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {timeLimitMode === "custom" && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-sm text-zinc-700">Nhập số phút:</span>
                      <input
                        type="number"
                        step="0.5"
                        min={0.1}
                        value={timeLimitValue}
                        onChange={(e) => setTimeLimitValue(parseFloat(e.target.value) || 1.5)}
                        className="w-24 bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-sm"
                      />
                      <span className="text-xs text-zinc-500">phút (chấp nhận thập phân, VD: 1.5)</span>
                    </div>
                  )}
                  <div className="text-xs text-zinc-500 pt-1">
                    Khi hết giờ: hoạt động tự đóng, các SV chưa trả lời được ghi nhận &quot;Không trả lời&quot;.
                  </div>
                </div>

                {/* ===== Ghi nhận điểm tham gia ===== */}
                <label className="flex items-start gap-3 p-4 bg-emerald-50/50 border-2 border-emerald-200 rounded-xl cursor-pointer hover:bg-emerald-50">
                  <input
                    type="checkbox"
                    checked={requiresStudentCode}
                    onChange={(e) => setRequiresStudentCode(e.target.checked)}
                    className="w-5 h-5 accent-emerald-600 mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-emerald-900">📋 Ghi nhận điểm tham gia</div>
                    <div className="text-xs text-zinc-700 mt-1 space-y-1">
                      <div><strong className="text-emerald-700">✓ Bật:</strong> Câu trả lời được ghi cho từng SV cụ thể. Tính vào Bảng thành tích. SV không trả lời sẽ bị đánh dấu &quot;Không trả lời&quot;.</div>
                      <div><strong className="text-zinc-600">✗ Tắt:</strong> Khảo sát / câu hỏi mở ẩn danh. Chỉ xem kết quả tổng quan, không chấm điểm.</div>
                    </div>
                  </div>
                </label>

                {createError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg">
                    {createError}
                  </div>
                )}
              </div>

              {/* Footer sticky */}
              <div className="sticky bottom-0 bg-white border-t border-zinc-200 px-6 py-4 flex gap-3">
                <button
                  onClick={() => { setShowCreateModal(false); setEditingActivity(null); }}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-300 hover:bg-zinc-100"
                >
                  Hủy
                </button>
                <button
                  onClick={handleCreatePoll}
                  disabled={isCreating}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-60 shadow-sm"
                >
                  {isCreating
                    ? (editingActivity ? "Đang lưu..." : "Đang tạo...")
                    : (editingActivity ? "Lưu thay đổi" : "Tạo hoạt động")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== MODAL DANH SÁCH SINH VIÊN ==================== */}
        {showParticipantsModal && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[120] p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowParticipantsModal(false); }}
          >
            <div className="bg-white border border-zinc-300 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">Danh sách sinh viên tham gia</div>
                  <div className="text-xs text-zinc-600 mt-0.5">{totalParticipants} người · cập nhật realtime</div>
                </div>
                <button onClick={() => setShowParticipantsModal(false)} className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none">×</button>
              </div>

              <div className="p-4">
                {totalParticipants === 0 ? (
                  <div className="text-center py-12 text-zinc-500">
                    <div className="text-4xl mb-2">👥</div>
                    Chưa có sinh viên nào tham gia. Bấm <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-xs">Q</kbd> để chiếu QR cho SV quét.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-zinc-500 border-b border-zinc-200">
                      <tr>
                        <th className="text-left px-2 py-2 font-medium">#</th>
                        <th className="text-left px-2 py-2 font-medium">Mã SV</th>
                        <th className="text-left px-2 py-2 font-medium">Họ tên</th>
                        <th className="text-left px-2 py-2 font-medium">Lớp</th>
                        <th className="text-left px-2 py-2 font-medium">Vào lúc</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedStudents.map((p: { _id: string; studentCode: string; fullName: string; className: string; joinedAt: number; flagged?: boolean; flagReason?: string }, idx) => (
                        <tr key={p._id} className={`border-b border-zinc-100 ${p.flagged ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-zinc-50"}`}>
                          <td className="px-2 py-2 text-zinc-500">{idx + 1}</td>
                          <td className="px-2 py-2 font-mono flex items-center gap-1.5">
                            {p.studentCode}
                            {p.flagged && (
                              <span title={p.flagReason || "Có dấu hiệu gian lận"} className="text-red-600 text-xs cursor-help">🚩</span>
                            )}
                          </td>
                          <td className="px-2 py-2 font-medium">{p.fullName}</td>
                          <td className="px-2 py-2 text-zinc-600">{p.className}</td>
                          <td className="px-2 py-2 text-xs text-zinc-500">
                            {new Date(p.joinedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== MODAL CẤU HÌNH ĐIỂM BẢNG THÀNH TÍCH ==================== */}
        {showScoringConfig && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[120]">
            <div className="bg-white border border-zinc-300 rounded-2xl w-full max-w-md p-6">
              <div className="text-xl font-semibold mb-1">Cấu hình điểm thành tích</div>
              <div className="text-sm text-zinc-600 mb-6">Điều chỉnh điểm cho từng loại hoạt động (phù hợp sinh viên đại học)</div>

              <div className="space-y-4">
                {[
                  { key: "poll", label: "Trả lời Poll / Word Cloud / Rating" },
                  { key: "board", label: "Đăng bài Board" },
                  { key: "qa", label: "Đặt câu hỏi Q&A" },
                  { key: "qaUpvote", label: "Nhận được upvote Q&A" },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between">
                    <div className="text-sm">{item.label}</div>
                    <input
                      type="number"
                      value={scoringConfig[item.key as keyof typeof scoringConfig]}
                      onChange={(e) => setScoringConfig({
                        ...scoringConfig,
                        [item.key]: parseInt(e.target.value) || 0,
                      })}
                      className="w-20 bg-zinc-100 border border-zinc-300 rounded-lg px-3 py-1.5 text-right font-mono"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setShowScoringConfig(false)}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-300 hover:bg-zinc-100"
                >
                  Hủy
                </button>
                <button
                  onClick={async () => {
                    if (!session?._id) return;
                    try {
                      await updateScoringConfig({
                        sessionId: session._id,
                        config: scoringConfig,
                      });
                      toast.success("Đã lưu cấu hình điểm");
                      setShowScoringConfig(false);
                    } catch (e) {
                      toast.error("Không thể lưu");
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-medium"
                >
                  Lưu cấu hình
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== MODAL DANH SÁCH KỊCH BẢN MẪU ==================== */}
        {showTemplatesModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[120]">
            <div className="bg-white border border-zinc-300 rounded-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xl font-semibold">Kịch bản đã lưu</div>
                <button onClick={() => setShowTemplatesModal(false)} className="text-zinc-600 hover:text-zinc-900">✕</button>
              </div>

              {!templatesList || templatesList.length === 0 ? (
                <div className="text-center py-8 text-zinc-600">
                  Chưa có kịch bản nào được lưu.<br />
                  Sau khi soạn kịch bản, bấm “Lưu kịch bản” để tạo mẫu.
                </div>
              ) : (
                <div className="space-y-3">
                  {templatesList.map((tpl: any) => (
                    <div key={tpl._id} className="bg-zinc-100 border border-zinc-300 rounded-xl p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{tpl.name}</div>
                        <div className="text-xs text-zinc-500">
                          {tpl.activitiesSnapshot?.length || 0} hoạt động • {new Date(tpl.createdAt).toLocaleDateString('vi-VN')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={async () => {
                            if (!session?._id) return;
                            if (!confirm(`Áp dụng kịch bản "${tpl.name}" vào buổi này? Toàn bộ hoạt động hiện tại sẽ bị thay thế.`)) return;

                            try {
                              await applyTemplate({
                                sessionId: session._id,
                                templateId: tpl._id,
                              });
                              toast.success("Đã áp dụng kịch bản mẫu!");
                              setShowTemplatesModal(false);
                            } catch (e: any) {
                              toast.error(e.message || "Không thể áp dụng");
                            }
                          }}
                          className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-white"
                        >
                          Áp dụng
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Xóa mẫu "${tpl.name}"? Hành động không hồi phục.`)) return;
                            try {
                              await deleteTemplate({ templateId: tpl._id });
                              toast.success(`Đã xóa "${tpl.name}"`);
                            } catch (e: any) {
                              toast.error(e.message || "Không thể xóa");
                            }
                          }}
                          className="p-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          title={`Xóa mẫu "${tpl.name}"`}
                          aria-label="Xóa mẫu"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ==================== FULLSCREEN OVERLAYS (QR + Kết quả - dùng khi chiếu) ==================== */}
      {fullscreenOverlay === "qr" && (
        <div
          onClick={closeOverlay}
          className="fixed inset-0 z-[100] bg-zinc-950 flex items-center justify-center cursor-pointer"
        >
          <div className="text-center">
            <div className="text-zinc-400 text-2xl tracking-[6px] mb-4">QUÉT QR ĐỂ THAM GIA</div>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR mã phòng" className="w-[420px] h-[420px] mx-auto rounded-2xl bg-white p-3" />
            ) : (
              <div className="w-[420px] h-[420px] bg-zinc-900 rounded-2xl flex items-center justify-center text-zinc-500">Đang tạo QR...</div>
            )}
            <div className="mt-8 text-zinc-300 text-lg">Hoặc nhập mã phòng:</div>
            <div className="text-white text-[160px] leading-none font-mono font-bold tracking-[12px] mt-2">
              {upperCode}
            </div>
            <div className="mt-6">
              <button
                onClick={(e) => { e.stopPropagation(); handleDownloadQr(); }}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white"
              >
                💾 Tải QR thành ảnh (dán vào PPT)
              </button>
            </div>
            <div className="mt-8 text-zinc-500 text-sm">Bấm <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Esc</kbd> hoặc click để đóng • Bấm <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Q</kbd> để mở lại</div>
          </div>
        </div>
      )}

      {fullscreenOverlay === "result" && (
        <div className="fixed inset-0 z-[100] bg-zinc-950 text-white overflow-auto">
          {/* Countdown lớn — chiếu cho SV thấy thời gian còn lại */}
          {activeActivity?.timeLimit && activeActivity?.startedAt && (
            <CountdownOverlay
              startedAt={activeActivity.startedAt}
              timeLimitMinutes={activeActivity.timeLimit}
              position="center-top"
              big={bigTextMode}
            />
          )}
          {/* Tab switcher ở trên cùng */}
          <div className="sticky top-0 z-20 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setResultTab("result")}
                className={`px-5 py-2 text-sm rounded-lg font-semibold transition-colors ${
                  resultTab === "result"
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
                }`}
              >
                📊 Kết quả hoạt động
              </button>
              <button
                onClick={() => setResultTab("leaderboard")}
                className={`px-5 py-2 text-sm rounded-lg font-semibold transition-colors ${
                  resultTab === "leaderboard"
                    ? "bg-amber-500 text-black"
                    : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
                }`}
              >
                🏆 Bảng thành tích
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* Nút Reveal — chỉ hiện khi đang active + chưa reveal */}
              {activeActivity && !resultsRevealed && (
                <button
                  onClick={() => {
                    setResultsRevealed(true);
                    toast.success("Đã công bố kết quả");
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold"
                  title="Công bố kết quả lên màn hình (phím R)"
                >
                  👁 Công bố kết quả (R)
                </button>
              )}
              {/* Nút Đóng activity — chỉ hiện khi đang có active */}
              {activeActivity && (
                <button
                  onClick={() => handleCloseAndReveal(activeActivity._id)}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold"
                  title="Đóng hoạt động đang chạy (phím X) — SV không gửi thêm được"
                >
                  ⏹ Đóng (X)
                </button>
              )}
              <button
                onClick={closeOverlay}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
              >
                Đóng (Esc)
              </button>
            </div>
          </div>

          {/* TAB LEADERBOARD */}
          {resultTab === "leaderboard" && (
            <div className="min-h-[calc(100vh-60px)] p-12">
              <div className="mb-8 text-center">
                <div className="text-7xl mb-3">🏆</div>
                <div className="text-5xl md:text-6xl font-bold tracking-tight">Bảng thành tích</div>
                <div className="text-zinc-400 text-xl mt-2">{session.title}</div>
              </div>

              {leaderboardData && !Array.isArray(leaderboardData) && leaderboardData.leaderboard.length > 0 ? (
                <div className="max-w-4xl mx-auto space-y-3">
                  {leaderboardData.leaderboard.map((entry, idx) => {
                    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
                    const speedTxt = entry.avgResponseMs !== null && entry.avgResponseMs !== undefined
                      ? entry.avgResponseMs < 1000
                        ? `${entry.avgResponseMs}ms`
                        : entry.avgResponseMs < 60000
                          ? `${(entry.avgResponseMs / 1000).toFixed(1)}s`
                          : `${Math.floor(entry.avgResponseMs / 60000)}p${Math.round((entry.avgResponseMs % 60000) / 1000).toString().padStart(2, "0")}`
                      : null;
                    return (
                      <div
                        key={entry.studentCode}
                        className={`flex items-center gap-4 px-6 py-4 rounded-2xl ${
                          idx === 0 ? "bg-gradient-to-r from-amber-900/40 to-amber-800/30 border-2 border-amber-500"
                          : idx === 1 ? "bg-gradient-to-r from-zinc-700/40 to-zinc-600/30 border-2 border-zinc-400"
                          : idx === 2 ? "bg-gradient-to-r from-orange-900/40 to-orange-800/30 border-2 border-orange-700"
                          : "bg-zinc-900 border border-zinc-800"
                        }`}
                      >
                        <div className="text-4xl w-12 text-center">{medal || <span className="text-2xl font-mono text-zinc-400">{idx + 1}</span>}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-2xl font-semibold truncate">{entry.fullName}</div>
                          <div className="text-sm text-zinc-400 truncate">{entry.studentCode} · {entry.className}</div>
                        </div>
                        {speedTxt && (
                          <div className="text-right">
                            <div className="text-xs text-zinc-500">TỐC ĐỘ TB</div>
                            <div className="text-lg font-mono text-zinc-300">⚡ {speedTxt}</div>
                          </div>
                        )}
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">ĐIỂM</div>
                          <div className="text-3xl font-bold text-emerald-400">{entry.score}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-center text-zinc-500 text-sm mt-6">
                    {(leaderboardData as { participantsWithScore: number }).participantsWithScore} / {(leaderboardData as { totalParticipants: number }).totalParticipants} sinh viên có điểm
                  </div>
                </div>
              ) : (
                <div className="text-center text-zinc-400 text-xl py-16">
                  Chưa có SV nào có điểm. Mở 1 hoạt động có bật &quot;Ghi nhận điểm tham gia&quot; để bắt đầu.
                </div>
              )}
            </div>
          )}

          {/* TAB RESULT - Activity result */}
          {resultTab === "result" && (!displayActivity ? (
            <div className="min-h-[calc(100vh-60px)] flex items-center justify-center text-center">
              <div>
                <div className="text-6xl mb-4">📊</div>
                <div className="text-3xl font-semibold mb-2">Chưa có hoạt động đang diễn ra</div>
                <div className="text-zinc-400 text-lg mb-4">Chuyển sang tab 🏆 <strong>Bảng thành tích</strong> để chiếu xếp hạng.</div>
                <button
                  onClick={() => setResultTab("leaderboard")}
                  className="px-5 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold"
                >
                  🏆 Xem bảng thành tích
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-screen px-8 py-10 flex flex-col items-center">
              {/* ===== HEADER CENTERED — đề bài + cách trả lời, font lớn cho projector ===== */}
              <div className="w-full max-w-6xl text-center mb-8">
                <div className="text-emerald-400 text-base md:text-lg tracking-[6px] mb-3">
                  {displayActivity.type === "poll" ? "TRẮC NGHIỆM"
                    : displayActivity.type === "wordcloud" ? "ĐÁM MÂY TỪ"
                    : displayActivity.type === "rating" ? "THANG ĐIỂM"
                    : displayActivity.type === "qa" ? "HỎI ĐÁP"
                    : displayActivity.type === "opentext" ? "TRẢ LỜI NGẮN"
                    : "BẢNG CỘNG TÁC"}
                  {" • "}
                  {displayActivity.status === "active" ? "ĐANG DIỄN RA"
                    : displayActivity.status === "closed" ? "ĐÃ ĐÓNG"
                    : displayActivity.status === "expired" ? "HẾT GIỜ"
                    : "NHÁP"}
                </div>

                {/* Tiêu đề activity (đề câu hỏi chính) — to nhất */}
                <div
                  className={`font-bold tracking-tight leading-tight ${
                    bigTextMode
                      ? "text-6xl md:text-7xl lg:text-8xl"
                      : "text-5xl md:text-6xl lg:text-7xl"
                  }`}
                >
                  {displayActivity.title}
                </div>

                {/* Mô tả thêm */}
                {(() => {
                  const desc = (displayActivity.config as { description?: string } | undefined)?.description;
                  return desc ? (
                    <div className="mt-5 text-2xl md:text-3xl text-zinc-300 leading-snug whitespace-pre-wrap max-w-5xl mx-auto">
                      {desc}
                    </div>
                  ) : null;
                })()}

                {displayActivity.slideCue && (
                  <div className="mt-4 text-amber-400 text-xl">📍 {fmtSlide(displayActivity.slideCue)}</div>
                )}

                {/* ===== Block hướng dẫn + đáp án (CENTER, font to) ===== */}
                {(() => {
                  const t = displayActivity.type;
                  const cfg = (displayActivity.config || {}) as {
                    pollType?: string;
                    options?: Array<{ id: string; text: string }>;
                    correctOptionIds?: string[];
                    isQuiz?: boolean;
                    min?: number;
                    max?: number;
                    minLabel?: string;
                    maxLabel?: string;
                    pointLabels?: Record<string, string>;
                    columns?: Array<{ id: string; title: string }>;
                    minSelections?: number;
                  };
                  return (
                    <div className="mt-8 mx-auto max-w-5xl bg-zinc-900/80 border border-zinc-700 rounded-2xl px-8 py-6">
                      {t === "poll" && (
                        <>
                          <div className="text-xl md:text-2xl text-zinc-200 mb-5 flex items-center justify-center gap-3">
                            <span>📋</span>
                            <span>
                              {cfg.pollType === "multiple_choice"
                                ? `Chọn nhiều đáp án${cfg.minSelections && cfg.minSelections > 1 ? ` (ít nhất ${cfg.minSelections})` : ""}`
                                : "Chọn 1 đáp án"}
                              {cfg.isQuiz && (
                                <span className="ml-3 text-amber-300">· 🎯 Có đáp án đúng</span>
                              )}
                            </span>
                          </div>
                          {(cfg.options || []).length > 0 && (
                            <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 text-left ${bigTextMode ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl"}`}>
                              {cfg.options!.map((o, i) => {
                                // Chỉ hiển thị ✓ đáp án đúng KHI đã reveal (shouldShowResults).
                                const isCorrect = cfg.isQuiz && (cfg.correctOptionIds || []).includes(o.id);
                                const revealCorrect = isCorrect && shouldShowResults;
                                return (
                                  <div
                                    key={o.id}
                                    className={`flex items-baseline gap-3 px-4 py-2 rounded-lg ${
                                      revealCorrect
                                        ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold"
                                        : "text-zinc-200"
                                    }`}
                                  >
                                    <span className="text-zinc-500 font-mono shrink-0">{String.fromCharCode(65 + i)}.</span>
                                    <span className="flex-1">{o.text}</span>
                                    {revealCorrect && <span className="text-emerald-400 text-2xl shrink-0">✓</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                      {t === "wordcloud" && (
                        <div className="text-2xl md:text-3xl text-zinc-200 flex items-center justify-center gap-3 leading-snug">
                          <span>☁️</span>
                          <span>Nhập từ khóa ngắn (tối đa 30 ký tự)</span>
                        </div>
                      )}
                      {t === "opentext" && (
                        <div className="text-2xl md:text-3xl text-zinc-200 flex items-center justify-center gap-3 leading-snug">
                          <span>✏️</span>
                          <span>Nhập câu trả lời ngắn 1–2 câu</span>
                        </div>
                      )}
                      {t === "rating" && (() => {
                        const min = cfg.min ?? 1;
                        const max = cfg.max ?? 5;
                        const labelOf = (point: number) => {
                          if (cfg.pointLabels?.[String(point)]) return cfg.pointLabels[String(point)];
                          if (point === min && cfg.minLabel) return cfg.minLabel;
                          if (point === max && cfg.maxLabel) return cfg.maxLabel;
                          return "";
                        };
                        const hasDetailed =
                          (cfg.pointLabels && Object.keys(cfg.pointLabels).length > 0) ||
                          (cfg.minLabel || cfg.maxLabel);

                        return (
                          <div className="text-zinc-200">
                            <div className="text-2xl md:text-3xl flex items-center justify-center gap-3 mb-4">
                              <span>⭐</span>
                              <span>Chấm điểm <strong className="text-amber-300">{min}–{max}</strong></span>
                            </div>
                            {hasDetailed && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xl md:text-2xl text-left max-w-3xl mx-auto">
                                {Array.from({ length: max - min + 1 }, (_, i) => {
                                  const point = min + i;
                                  const label = labelOf(point);
                                  return (
                                    <div key={point} className="flex items-center gap-3 px-3 py-1">
                                      <span className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center shrink-0">
                                        {point}
                                      </span>
                                      <span className="text-zinc-200">{label || `Mức ${point}`}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {t === "qa" && (
                        <div className="text-2xl md:text-3xl text-zinc-200 flex items-center justify-center gap-3 leading-snug">
                          <span>❓</span>
                          <span>Đặt câu hỏi tự do — có thể upvote câu hay</span>
                        </div>
                      )}
                      {t === "board" && (
                        <div className="text-zinc-200">
                          <div className="text-2xl md:text-3xl flex items-center justify-center gap-3">
                            <span>📌</span>
                            <span>Đăng text + ảnh vào các cột</span>
                          </div>
                          {(cfg.columns || []).length > 0 && (
                            <div className="text-xl md:text-2xl mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
                              {cfg.columns!.map((c) => (
                                <span key={c.id} className="inline-flex items-center gap-2">
                                  <span className="w-3 h-3 rounded-full bg-purple-400" />{c.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="flex-1 flex items-center justify-center">
                {/* ===== Khi đang ACTIVE và chưa REVEAL → chỉ hiện đếm + đề + hint ===== */}
                {!shouldShowResults && (
                  <div className="text-center w-full max-w-3xl">
                    <div className="text-7xl mb-6">⏳</div>
                    <div className="text-4xl md:text-5xl font-bold mb-8">Đang chờ sinh viên trả lời</div>

                    {/* Count realtime */}
                    {(() => {
                      const count =
                        displayActivity.type === "poll" ? pollResults?.totalAnswered ?? 0 :
                        displayActivity.type === "wordcloud" ? wordCloudResults?.totalResponses ?? 0 :
                        displayActivity.type === "opentext" ? (opentextResponses?.filter((r) => r.status === "answered").length ?? 0) :
                        displayActivity.type === "rating" ? ratingResults?.total ?? 0 :
                        displayActivity.type === "qa" ? qaResponses?.length ?? 0 :
                        displayActivity.type === "board" ? boardPosts?.length ?? 0 :
                        0;
                      return (
                        <div className="inline-block bg-zinc-900 border border-zinc-700 rounded-3xl px-12 py-8">
                          <div className="text-7xl md:text-8xl font-bold text-emerald-400 tabular-nums">
                            {count}
                          </div>
                          <div className="text-xl text-zinc-400 mt-2">SV đã trả lời</div>
                        </div>
                      );
                    })()}

                    <div className="mt-10 inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                      <kbd className="px-3 py-1 text-base font-mono bg-amber-500 text-black rounded font-bold shadow">R</kbd>
                      <span className="text-amber-300 text-lg">Bấm để công bố kết quả</span>
                    </div>
                  </div>
                )}

                {/* POLL fullscreen */}
                {shouldShowResults && displayActivity.type === "poll" && pollResults && pollResults.options?.length > 0 && (
                  <div className="w-full max-w-5xl space-y-5">
                    {[...pollResults.options].sort((a, b) => b.count - a.count).map((opt: any) => {
                      const percentage = pollResults.totalAnswered > 0 ? Math.round((opt.count / pollResults.totalAnswered) * 100) : 0;
                      return (
                        <div key={opt.id} className="flex items-center gap-6">
                          <div className="w-1/3 text-3xl truncate" title={opt.text}>{opt.text}</div>
                          <div className="flex-1 bg-zinc-800 rounded-full h-12 overflow-hidden">
                            <div className="bg-emerald-500 h-12 transition-all rounded-full" style={{ width: `${percentage}%` }} />
                          </div>
                          <div className="w-40 text-right text-3xl font-mono text-emerald-400">
                            {opt.count} <span className="text-emerald-500/70 text-xl">({percentage}%)</span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="text-center text-zinc-400 text-xl mt-6">{pollResults.totalAnswered} sinh viên đã trả lời</div>
                  </div>
                )}

                {/* WORD CLOUD fullscreen */}
                {shouldShowResults && displayActivity.type === "wordcloud" && wordCloudResults && wordCloudResults.words.length > 0 && (
                  <div className="w-full max-w-6xl text-center">
                    <div className="flex flex-wrap gap-x-8 gap-y-4 items-center justify-center py-10">
                      {wordCloudResults.words.slice(0, 60).map((item: any, idx: number) => {
                        const max = wordCloudResults.words[0]?.count || 1;
                        const size = Math.max(28, Math.min(120, Math.round(28 + (item.count / max) * 92)));
                        const opacity = Math.max(0.55, Math.min(1, 0.6 + (item.count / max) * 0.4));
                        return (
                          <span key={idx} className="font-semibold" style={{ fontSize: `${size}px`, color: `rgba(52, 211, 153, ${opacity})` }} title={`${item.word} — ${item.count} lần`}>
                            {item.word}
                          </span>
                        );
                      })}
                    </div>
                    <div className="text-zinc-400 text-xl mt-4">{wordCloudResults.totalResponses} phản hồi • {wordCloudResults.words.length} từ khác nhau</div>
                  </div>
                )}

                {/* OPEN TEXT fullscreen — list câu trả lời, không gom */}
                {shouldShowResults && displayActivity.type === "opentext" && opentextResponses && opentextResponses.length > 0 && (
                  <div className="w-full max-w-4xl space-y-3 max-h-[75vh] overflow-auto pr-2">
                    {opentextResponses
                      .filter((r) => r.status === "answered")
                      .sort((a, b) => b.submittedAt - a.submittedAt)
                      .map((r) => (
                        <div key={r._id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                          <div className="text-xl leading-snug whitespace-pre-wrap">{String(r.value || "")}</div>
                          {r.studentCode && (
                            <div className="text-xs text-zinc-500 font-mono mt-2">{r.studentCode}</div>
                          )}
                        </div>
                      ))}
                    <div className="text-center text-zinc-400 text-lg pt-3">
                      {opentextResponses.filter((r) => r.status === "answered").length} câu trả lời
                    </div>
                  </div>
                )}

                {/* RATING fullscreen */}
                {shouldShowResults && displayActivity.type === "rating" && ratingResults && (
                  <div className="w-full max-w-4xl">
                    <div className="text-center mb-10">
                      <div className="text-[200px] leading-none font-bold tabular-nums text-emerald-400">
                        {ratingResults.average || "—"}
                      </div>
                      <div className="text-2xl text-zinc-400 mt-2">
                        Điểm trung bình • {ratingResults.total} lượt đánh giá
                      </div>
                    </div>
                    <div className="space-y-4">
                      {Array.from({ length: (displayActivity.config?.max || 5) - (displayActivity.config?.min || 1) + 1 }, (_, i) => {
                        const score = (displayActivity.config?.min || 1) + i;
                        const count = ratingResults.distribution?.[score] || 0;
                        const total = ratingResults.total || 1;
                        const pct = Math.round((count / total) * 100);
                        return (
                          <div key={score} className="flex items-center gap-6">
                            <div className="w-16 text-right font-bold text-3xl tabular-nums">{score}</div>
                            <div className="flex-1 bg-zinc-800 rounded-full h-10 overflow-hidden">
                              <div className="h-10 bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="w-32 text-right text-2xl font-mono text-emerald-400 tabular-nums">
                              {count} <span className="text-emerald-500/70 text-lg">({pct}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Q&A fullscreen — chỉ hiện top câu hỏi */}
                {shouldShowResults && displayActivity.type === "qa" && qaResponses && qaResponses.length > 0 && (
                  <div className="w-full max-w-5xl space-y-4 max-h-[70vh] overflow-auto">
                    {qaResponses
                      .filter((q: any) => q.status !== "hidden")
                      .sort((a: any, b: any) => {
                        const ua = (typeof a.value === "object" ? a.value?.upvotes : 0) || 0;
                        const ub = (typeof b.value === "object" ? b.value?.upvotes : 0) || 0;
                        return ub - ua;
                      })
                      .slice(0, 8)
                      .map((q: any) => {
                        const v = typeof q.value === "object" && q.value ? q.value : {};
                        return (
                          <div key={q._id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                            <div className="text-2xl leading-snug">{v.text || q.value}</div>
                            <div className="text-emerald-400 text-lg mt-3 flex items-center gap-4">
                              <span>👍 {v.upvotes || 0} upvotes</span>
                              {v.answer && <span className="text-blue-400">✓ Đã trả lời</span>}
                            </div>
                          </div>
                        );
                      })}
                    <div className="text-center text-zinc-400 text-lg">{qaResponses.length} câu hỏi</div>
                  </div>
                )}

                {/* BOARD fullscreen — hiện top bài đăng theo cột */}
                {shouldShowResults && displayActivity.type === "board" && boardPosts && boardPosts.length > 0 && (
                  <div className="w-full max-w-6xl">
                    <div className="grid grid-cols-3 gap-6">
                      {(displayActivity.config?.columns || []).map((col: any) => {
                        const postsInCol = boardPosts.filter((p: any) => p.columnId === col.id).slice(0, 5);
                        return (
                          <div key={col.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                            <div className="text-emerald-400 text-lg font-medium mb-3 truncate">{col.title}</div>
                            <div className="space-y-2 max-h-[60vh] overflow-auto">
                              {postsInCol.length === 0 && <div className="text-zinc-500 text-sm">Chưa có bài</div>}
                              {postsInCol.map((p: any) => (
                                <div key={p._id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-lg">
                                  {p.content}
                                  {p.likes > 0 && <div className="text-emerald-400 text-sm mt-1">♥ {p.likes}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-center text-zinc-400 text-lg mt-6">{boardPosts.length} bài đăng</div>
                  </div>
                )}

                {/* Empty state cho fullscreen (chỉ hiện khi shouldShowResults) */}
                {shouldShowResults && ((displayActivity.type === "poll" && (!pollResults || pollResults.totalAnswered === 0)) ||
                  (displayActivity.type === "wordcloud" && (!wordCloudResults || wordCloudResults.totalResponses === 0)) ||
                  (displayActivity.type === "opentext" && (!opentextResponses || opentextResponses.filter((r) => r.status === "answered").length === 0)) ||
                  (displayActivity.type === "rating" && (!ratingResults || ratingResults.total === 0)) ||
                  (displayActivity.type === "qa" && (!qaResponses || qaResponses.length === 0)) ||
                  (displayActivity.type === "board" && (!boardPosts || boardPosts.length === 0))) && (
                  <div className="text-center text-zinc-400">
                    <div className="text-6xl mb-4">⏳</div>
                    <div className="text-3xl">Đang chờ sinh viên trả lời...</div>
                    {displayActivity.config?.description && (
                      <div className="mt-4 text-xl text-zinc-300 max-w-3xl mx-auto whitespace-pre-wrap">
                        {String(displayActivity.config.description)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="text-center text-zinc-600 text-sm mt-6">
                Bấm <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">F</kbd> hoặc <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Esc</kbd> để thoát chế độ chiếu
              </div>
            </div>
          ))}
        </div>
      )}

      {fullscreenOverlay === "slides" && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          {/* Countdown lớn — top-left để tránh đè QR card top-right */}
          {activeActivity?.timeLimit && activeActivity?.startedAt && (
            <CountdownOverlay
              startedAt={activeActivity.startedAt}
              timeLimitMinutes={activeActivity.timeLimit}
              position="top-left"
              big={bigTextMode}
            />
          )}

          {/* Slide jump buffer indicator — chỉ hiện khi đang gõ số */}
          {slideJumpBuffer.length > 0 && (
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[115] bg-amber-500/95 text-black px-5 py-2 rounded-xl shadow-2xl flex items-center gap-3 font-mono font-bold animate-pulse">
              <span className="text-sm tracking-widest opacity-80">SLIDE</span>
              <span className="text-3xl tabular-nums">{slideJumpBuffer}</span>
              <span className="text-xs text-zinc-700 ml-1">↵ để nhảy</span>
            </div>
          )}
          {/* Slide viewer chiếm phần lớn không gian */}
          <div className="flex-1 relative">
            {hasPdf && pdfUrl ? (
              <PdfSlideViewer
                fileUrl={pdfUrl}
                currentPage={pdfCurrentPage}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-400">
                <div className="text-center">
                  <div className="text-6xl mb-4">📑</div>
                  <div className="text-2xl mb-2">Chưa upload slide PDF</div>
                  <div className="text-sm text-zinc-500 mb-6">Đóng overlay, upload PDF từ nút "Upload PDF" trên top bar</div>
                  <button
                    onClick={() => setFullscreenOverlay(null)}
                    className="px-5 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                  >
                    Đóng (Esc)
                  </button>
                </div>
              </div>
            )}

            {/* Card mã phòng + QR ở góc trên phải — SV vẫn join được khi đang chiếu slide */}
            {hasPdf && (
              <div className="absolute top-4 right-4 bg-black/75 backdrop-blur-md rounded-2xl p-3 text-white shadow-2xl text-center">
                {/* Hàng 1: Mã phòng */}
                <div className="text-[10px] text-zinc-400 tracking-[4px] font-semibold">MÃ PHÒNG</div>
                <div className="font-mono font-bold tracking-[6px] text-3xl my-1 leading-none">{upperCode}</div>

                {/* Hàng 2: QR code to */}
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR mã phòng"
                    className="w-44 h-44 rounded-lg bg-white p-1.5 mt-2 mx-auto"
                  />
                )}

                <div className="text-[10px] text-zinc-400 mt-1.5">Quét QR để tham gia</div>
              </div>
            )}

            {/* Bảng điều khiển hoạt động nổi trên slide — CHỈ HIỆN KHI:
                 - Có activity đang active (giảng viên đang điều khiển), HOẶC
                 - Có activity nháp/đã đóng có Mốc slide khớp đúng trang PDF hiện tại,
                   HOẶC khớp revealActivityId (vừa đóng) */}
            {(() => {
              // 1. Active activity luôn hiển thị (đang giảng dở)
              if (activeActivity) {
                // (sử dụng activeActivity làm focus)
              }

              // 2. Activity vừa đóng vẫn còn revealActivityId — vẫn hiện để xem kết quả
              const revealed = revealActivityId
                ? sortedActivities.find((a) => a._id === revealActivityId)
                : null;

              // 3. Match theo slide cue — chỉ hiện khi đúng trang PDF
              const slideMatch = !activeActivity && hasPdf
                ? sortedActivities.find((a) =>
                    a.slideCue &&
                    /^\d+$/.test(a.slideCue.trim()) &&
                    parseInt(a.slideCue.trim()) === pdfCurrentPage &&
                    a.status !== "closed" &&
                    a.status !== "expired"
                  )
                : null;

              const focusActivity = activeActivity || revealed || slideMatch;

              if (!focusActivity) return null;

              const isDraft = focusActivity.status === "draft";
              const isActive = focusActivity.status === "active";
              const isClosed = focusActivity.status === "closed" || focusActivity.status === "expired";
              const responseCount =
                focusActivity.type === "poll" ? pollResults?.totalAnswered ?? 0 :
                focusActivity.type === "wordcloud" ? wordCloudResults?.totalResponses ?? 0 :
                focusActivity.type === "opentext" ? (opentextResponses?.filter((r) => r.status === "answered").length ?? 0) :
                focusActivity.type === "rating" ? ratingResults?.total ?? 0 :
                focusActivity.type === "qa" ? qaResponses?.length ?? 0 :
                focusActivity.type === "board" ? boardPosts?.length ?? 0 :
                0;

              return (
                <div className="absolute bottom-6 right-6 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700 rounded-2xl p-4 w-[340px] text-white shadow-2xl">
                  <div className="flex items-center justify-between mb-1">
                    {isActive && <div className="text-[10px] tracking-[3px] text-emerald-400 font-semibold">● ĐANG CHẠY</div>}
                    {isDraft && <div className="text-[10px] tracking-[3px] text-zinc-400 font-semibold">NHÁP — CHƯA KÍCH HOẠT</div>}
                    {isClosed && <div className="text-[10px] tracking-[3px] text-zinc-500 font-semibold">ĐÃ ĐÓNG</div>}
                    <div className="text-[10px] text-zinc-500 uppercase">{focusActivity.type}</div>
                  </div>
                  <div className="font-semibold text-base mb-1 leading-snug">{focusActivity.title}</div>
                  {focusActivity.slideCue && (
                    <div className="text-[11px] text-amber-400 mb-2">📍 {fmtSlide(focusActivity.slideCue)}</div>
                  )}

                  {isActive && (
                    <div className="text-xl font-bold text-emerald-300 mb-2">
                      {responseCount} <span className="text-xs font-normal text-zinc-400">phản hồi</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="space-y-1.5">
                    {isDraft && (
                      <button
                        onClick={() => handleStart(focusActivity._id)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                      >
                        ▶ Kích hoạt hoạt động
                      </button>
                    )}
                    {isActive && (
                      <button
                        onClick={() => handleCloseAndReveal(focusActivity._id)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold"
                      >
                        ⏹ Đóng hoạt động
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Thanh điều khiển slide */}
          <div className="h-14 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between px-6 text-white shrink-0">
            <button
              onClick={() => setFullscreenOverlay(null)}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
            >
              Đóng (Esc)
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={goPdfFirst}
                disabled={!hasPdf || pdfCurrentPage <= 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-800 disabled:opacity-30"
                title="Về slide đầu (trang 1)"
              >
                ⏮ Đầu
              </button>
              <button
                onClick={goPdfPrev}
                disabled={!hasPdf || pdfCurrentPage <= 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-800 disabled:opacity-30"
              >
                ← Trước
              </button>

              <div className="text-sm font-mono text-zinc-300 w-24 text-center">
                {hasPdf ? `${pdfCurrentPage} / ${pdfTotalPages}` : "—"}
              </div>

              <button
                onClick={goPdfNext}
                disabled={!hasPdf || pdfCurrentPage >= pdfTotalPages}
                className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30"
              >
                Sau → <span className="text-[10px] opacity-70">(Space)</span>
              </button>
            </div>

            <div className="text-[11px] text-zinc-500">
              <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700">F</kbd> kết quả ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700">Q</kbd> QR
            </div>
          </div>
        </div>
      )}

      {/* ==================== DOCUMENT PIP (cửa sổ nổi trên PPT) ==================== */}
      {pipContainer && createPortal(
        <PipControlPanel
          upperCode={upperCode}
          sessionTitle={session.title}
          totalParticipants={totalParticipants}
          activeActivity={activeActivity}
          sortedActivities={sortedActivities}
          pollResults={pollResults}
          wordCloudResults={wordCloudResults}
          ratingResults={ratingResults}
          qaResponses={qaResponses}
          boardPosts={boardPosts}
          onStart={handleStart}
          onClose={handleCloseAndReveal}
          onPrev={goToPrevInScript}
          onNext={goToNextInScript}
          isScriptMode={isScriptMode}
          currentScriptIndex={currentScriptIndex}
          scriptLength={scriptLength}
          currentScriptActivity={currentScriptActivity}
        />,
        pipContainer
      )}

      {/* AI gen từ PDF modal */}
      {showAiGenModal && hasPdf && pdfUrl && session._id && (
        <AiGenFromPdfModal
          sessionId={session._id}
          sessionTitle={session.title}
          pdfUrl={pdfUrl}
          numPages={pdfTotalPages}
          existingActivityCount={activities?.length ?? 0}
          collectStudentCode={session.collectStudentCode ?? false}
          onClose={() => setShowAiGenModal(false)}
        />
      )}

      {/* Smart insights AI modal */}
      {showInsightsModal && session._id && (
        <SmartInsightsModal
          sessionId={session._id}
          run={session.currentRun ?? 1}
          sessionTitle={session.title}
          onClose={() => setShowInsightsModal(false)}
        />
      )}

      {/* AI grading opentext modal */}
      {gradingActivityId && (
        <OpentextGradingModal
          activityId={gradingActivityId}
          onClose={() => setGradingActivityId(null)}
        />
      )}

      {/* Survey AI gen modal */}
      {showSurveyModal && session._id && (
        <SurveyAiGenModal
          sessionId={session._id}
          sessionTitle={session.title}
          existingActivityCount={activities?.length ?? 0}
          collectStudentCode={session.collectStudentCode ?? false}
          onClose={() => setShowSurveyModal(false)}
        />
      )}
    </div>
  );
}

// Bảng điều khiển nổi (Document PiP) — render qua portal vào cửa sổ riêng
function PipControlPanel({
  upperCode,
  sessionTitle,
  totalParticipants,
  activeActivity,
  sortedActivities,
  pollResults,
  wordCloudResults,
  ratingResults,
  qaResponses,
  boardPosts,
  onStart,
  onClose,
  onPrev,
  onNext,
  isScriptMode,
  currentScriptIndex,
  scriptLength,
  currentScriptActivity,
}: {
  upperCode?: string;
  sessionTitle: string;
  totalParticipants: number;
  activeActivity: { _id: string; type: string; title: string; status: string; slideCue?: string; requiresStudentCode?: boolean } | undefined;
  sortedActivities: Array<{ _id: string; status: string; title: string; type: string; slideCue?: string }>;
  pollResults?: { totalAnswered?: number } | null;
  wordCloudResults?: { totalResponses?: number } | null;
  ratingResults?: { total?: number } | null;
  qaResponses?: Array<unknown>;
  boardPosts?: Array<unknown>;
  onStart: (id: string) => void;
  onClose: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  isScriptMode: boolean;
  currentScriptIndex: number;
  scriptLength: number;
  currentScriptActivity?: { _id: string; title: string; slideCue?: string; status?: string } | null;
}) {
  // Tìm activity tiếp theo (nháp gần nhất) để nút "Bắt đầu" hoạt động cả khi chưa Script mode
  const nextDraft = sortedActivities.find((a) => a.status === "draft");

  const responseCount =
    activeActivity?.type === "poll" ? pollResults?.totalAnswered ?? 0 :
    activeActivity?.type === "wordcloud" ? wordCloudResults?.totalResponses ?? 0 :
    activeActivity?.type === "rating" ? ratingResults?.total ?? 0 :
    activeActivity?.type === "qa" ? qaResponses?.length ?? 0 :
    activeActivity?.type === "board" ? boardPosts?.length ?? 0 :
    activeActivity?.type === "opentext" ? wordCloudResults?.totalResponses ?? 0 :
    0;

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white flex flex-col p-3 gap-3">
      {/* Header: mã phòng + số SV */}
      <div className="flex items-center justify-between text-[10px] font-mono tracking-widest border-b border-zinc-800 pb-2">
        <div className="text-emerald-400">📌 {upperCode}</div>
        <div className="text-zinc-400">👥 {totalParticipants} SV</div>
      </div>

      {/* Buổi giảng */}
      <div className="text-[11px] text-zinc-500 -mt-1 truncate" title={sessionTitle}>{sessionTitle}</div>

      {/* Activity đang chạy */}
      {activeActivity ? (
        <div className="bg-emerald-950/40 border border-emerald-700/40 rounded-xl p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-[10px] text-emerald-400 font-medium">● ĐANG CHẠY</span>
            <span className="text-[10px] text-zinc-500 uppercase">{activeActivity.type}</span>
          </div>
          <div className="font-semibold text-sm leading-snug mb-1.5 line-clamp-2">{activeActivity.title}</div>
          {activeActivity.slideCue && (
            <div className="text-[11px] text-amber-400 mb-1">📍 {fmtSlide(activeActivity.slideCue)}</div>
          )}
          <div className="text-2xl font-bold text-emerald-300 mb-2">
            {responseCount} <span className="text-xs font-normal text-zinc-400">phản hồi</span>
          </div>
          <button
            onClick={() => onClose(activeActivity._id)}
            className="w-full py-2 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold"
          >
            ⏹ Đóng hoạt động
          </button>
        </div>
      ) : nextDraft ? (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3">
          <div className="text-[10px] text-zinc-400 mb-1">HOẠT ĐỘNG KẾ TIẾP</div>
          <div className="font-semibold text-sm leading-snug mb-1.5 line-clamp-2">{nextDraft.title}</div>
          {nextDraft.slideCue && (
            <div className="text-[11px] text-amber-400 mb-2">📍 {fmtSlide(nextDraft.slideCue)}</div>
          )}
          <button
            onClick={() => onStart(nextDraft._id)}
            className="w-full py-2 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          >
            ▶ Bắt đầu
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-center text-xs text-zinc-500">
          Hết hoạt động trong danh sách
        </div>
      )}

      {/* Script controls (nếu đang chạy kịch bản) */}
      {isScriptMode && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-2.5">
          <div className="flex items-center gap-2 text-[10px] text-zinc-400 mb-1.5">
            <span>KỊCH BẢN</span>
            <span className="font-mono text-emerald-400">{currentScriptIndex + 1}/{scriptLength}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={onPrev}
              disabled={currentScriptIndex === 0}
              className="flex-1 py-1.5 text-xs rounded-lg border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
            >
              ← Trước
            </button>
            <button
              onClick={onNext}
              disabled={currentScriptIndex >= scriptLength - 1}
              className="flex-[2] py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40"
            >
              Tiếp →
            </button>
          </div>
          {currentScriptActivity?.slideCue && (
            <div className="text-[10px] text-amber-400 mt-1.5 text-center">📍 {fmtSlide(currentScriptActivity.slideCue)}</div>
          )}
        </div>
      )}

      <div className="mt-auto text-[10px] text-zinc-600 text-center">
        Cửa sổ này nổi trên PPT • Đóng cửa sổ để thoát
      </div>
    </div>
  );
}

export default PresenterPage;
