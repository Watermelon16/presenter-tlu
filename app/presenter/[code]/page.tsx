"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import * as XLSX from "xlsx";
import { PdfSlideViewer } from "@/components/PdfSlideViewer";

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

  // Lấy số lượng sinh viên
  const participants = useQuery(
    api.responses.listSessionParticipants,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // Lấy kết quả vote realtime nếu có hoạt động Poll đang diễn ra
  const pollResults = useQuery(
    api.responses.getPollVoteCounts,
    activeActivity && activeActivity.type === "poll" 
      ? { activityId: activeActivity._id } 
      : "skip"
  );

  // Lấy kết quả Word Cloud realtime
  const wordCloudResults = useQuery(
    api.responses.getWordCloudResults,
    activeActivity && activeActivity.type === "wordcloud"
      ? { activityId: activeActivity._id }
      : "skip"
  );

  // Lấy kết quả Rating realtime
  const ratingResults = useQuery(
    api.responses.getRatingResults,
    activeActivity && activeActivity.type === "rating"
      ? { activityId: activeActivity._id }
      : "skip"
  );

  // Lấy danh sách câu hỏi cho Q&A
  const qaResponses = useQuery(
    api.responses.getActivityResponses,
    activeActivity && activeActivity.type === "qa"
      ? { activityId: activeActivity._id }
      : "skip"
  );

  // Lấy bài đăng Board realtime
  const boardPosts = useQuery(
    api.board.listBoardPosts,
    activeActivity && activeActivity.type === "board"
      ? { activityId: activeActivity._id }
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
  const quickCreateActivity = async (type: "poll" | "wordcloud" | "rating" | "qa" | "board", title: string, slideCue: string) => {
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
  const resultsRef = useRef<HTMLDivElement>(null);
  const [highlightResults, setHighlightResults] = useState(false);
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
  const updateActivity = useMutation(api.activities.updateActivity);
  const deleteActivity = useMutation(api.activities.deleteActivity);
  const updateCollectStudentCode = useMutation(api.sessions.updateCollectStudentCode);
  const endSession = useMutation(api.sessions.endSession);

  // Script Runner mutations (B: server-backed kịch bản)
  const startScriptRunner = useMutation(api.activities.startScriptRunner);
  const stopScriptRunner = useMutation(api.activities.stopScriptRunner);
  const advanceInScript = useMutation(api.activities.advanceInScript);
  const jumpToScriptPosition = useMutation(api.activities.jumpToScriptPosition);
  const exportData = useQuery(
    api.responses.getSessionFullExport,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // === Kịch bản (Script) state - BÂY GIỜ DÙNG SERVER (realtime) ===
  // isScriptMode + currentScriptIndex được lấy từ Convex để companion window hoạt động mượt
  const isScriptMode = scriptState?.isRunning ?? false;
  const currentScriptIndex = scriptState?.position ?? 0;
  const scriptTotal = scriptState?.total ?? 0;

  const [isPresentationMode, setIsPresentationMode] = useState(false); // Chế độ Trình diễn cực mạnh (Focus Mode)
  const [isAdvancing, setIsAdvancing] = useState(false); // Transition state in Presentation Mode

  // === Overlay toàn màn hình: QR mã phòng / kết quả activity / slide PDF ===
  // null = ẩn, "qr" = QR + mã phòng (Q), "result" = kết quả activity (F), "slides" = slide PDF (S)
  const [fullscreenOverlay, setFullscreenOverlay] = useState<null | "qr" | "result" | "slides">(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

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
        setFullscreenOverlay(null);
        return;
      }

      // Phím chuyển slide (khi đang ở slide mode)
      if (fullscreenOverlay === "slides") {
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
      }

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFullscreenOverlay((prev) => (prev === "result" ? null : "result"));
      }
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        setFullscreenOverlay((prev) => (prev === "qr" ? null : "qr"));
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setFullscreenOverlay((prev) => (prev === "slides" ? null : "slides"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenOverlay, hasPdf, pdfCurrentPage, pdfTotalPages]);

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
  const [pollType, setPollType] = useState<"single_choice" | "multiple_choice">("single_choice");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [requiresStudentCode, setRequiresStudentCode] = useState(false);
  const [timeLimitMode, setTimeLimitMode] = useState<"unlimited" | "preset" | "custom">("unlimited");
  const [timeLimitValue, setTimeLimitValue] = useState(1.5); // in minutes
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [minSelections, setMinSelections] = useState(1);

  // Mốc slide PowerPoint (tùy chọn)
  const [slideCue, setSlideCue] = useState("");

  // Cấu hình Rating / Thang điểm
  const [ratingMin, setRatingMin] = useState(1);
  const [ratingMax, setRatingMax] = useState(5);
  const [ratingMinLabel, setRatingMinLabel] = useState("Rất không hiểu");
  const [ratingMaxLabel, setRatingMaxLabel] = useState("Rất hiểu rõ");

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
  const [createType, setCreateType] = useState<"poll" | "wordcloud" | "rating" | "qa" | "board">("poll");

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

  // Auto scroll + highlight khi có hoạt động mới bắt đầu
  useEffect(() => {
    if (activeActivity && resultsRef.current) {
      // Scroll mượt đến vùng kết quả
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });

      // Highlight nhẹ trong 1.8s
      setHighlightResults(true);
      const timer = setTimeout(() => setHighlightResults(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [activeActivity?._id]);

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

  const handleMoveUp = useCallback((activityId: string) => {
    moveActivityUp({ activityId: activityId as any });
  }, [moveActivityUp]);

  // Duplicate (Làm lại) - tạo bản nháp mới từ hoạt động cũ
  const handleDuplicate = useCallback(async (activityId: string) => {
    setIsDuplicating(activityId);
    try {
      await duplicateActivity({ activityId: activityId as any });
      toast.success("Đã tạo bản nháp mới. Bạn có thể chỉnh sửa và chạy lại.");

      // Cuộn xuống cuối danh sách
      setTimeout(() => {
        activitiesListRef.current?.scrollTo({
          top: activitiesListRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 120);
    } catch (err) {
      toast.error("Không thể sao chép hoạt động. Vui lòng thử lại.");
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

    // Field-level validation
    if (!isTitleValid) {
      setCreateError("Vui lòng nhập tiêu đề hoạt động.");
      return;
    }

    // Poll-specific validation
    if (createType === "poll" && !isOptionsValid) {
      setCreateError("Vui lòng nhập ít nhất 2 lựa chọn hợp lệ.");
      return;
    }

    setIsCreating(true);

    try {
      let config: any = {
        description: pollDescription.trim() || undefined,
      };

      if (createType === "poll") {
        config.pollType = pollType;
        config.options = validOptions.map((text, i) => ({
          id: `opt_${i}`,
          text: text.trim(),
        }));

        if (showAdvanced) {
          config.shuffleOptions = shuffleOptions;
          if (pollType === "multiple_choice") {
            config.minSelections = minSelections;
          }
        }
      } else if (createType === "wordcloud") {
        config.maxLength = 30;
      } else if (createType === "rating") {
        config.min = ratingMin;
        config.max = ratingMax;
        config.minLabel = ratingMinLabel.trim();
        config.maxLabel = ratingMaxLabel.trim();
      } else if (createType === "qa") {
        config.allowAnonymous = qaAllowAnonymous;
        config.maxQuestionsPerStudent = qaMaxQuestionsPerStudent;
      } else if (createType === "board") {
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
          type: createType,
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

  // Mở modal ở chế độ chỉnh sửa
  const openEditModal = (activity: any) => {
    setEditingActivity(activity);

    // Reset một số state chung
    setPollTitle(activity.title || "");
    setPollDescription(activity.config?.description || "");
    setSlideCue(activity.slideCue || "");
    setRequiresStudentCode(activity.requiresStudentCode || false);

    const timeLimit = activity.timeLimit;
    if (timeLimit) {
      setTimeLimitMode("custom");
      setTimeLimitValue(timeLimit);
    } else {
      setTimeLimitMode("unlimited");
      setTimeLimitValue(1.5);
    }

    // Reset các state theo loại hoạt động
    if (activity.type === "poll") {
      setCreateType("poll");
      setPollType(activity.config?.pollType || "single_choice");
      setOptions(activity.config?.options?.map((o: any) => o.text) || ["", ""]);
      setShuffleOptions(activity.config?.shuffleOptions || false);
      setMinSelections(activity.config?.minSelections || 1);
      setShowAdvanced(!!(activity.config?.shuffleOptions || activity.config?.minSelections));
    } 
    else if (activity.type === "wordcloud") {
      setCreateType("wordcloud");
    } 
    else if (activity.type === "rating") {
      setCreateType("rating");
      setRatingMin(activity.config?.min || 1);
      setRatingMax(activity.config?.max || 5);
      setRatingMinLabel(activity.config?.minLabel || "Rất không hiểu");
      setRatingMaxLabel(activity.config?.maxLabel || "Rất hiểu rõ");
    }
    else if (activity.type === "board") {
      setCreateType("board");
      const savedCols = activity.config?.columns;
      if (Array.isArray(savedCols) && savedCols.length > 0) {
        setBoardColumns(savedCols);
      }
    }

    setShowCreateModal(true);
    setCreateError("");
    setTitleError("");
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
  function SortableActivityItem({ activity, index, onEdit, onDuplicate, onDelete }: any) {
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

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`px-6 py-3 flex items-center gap-4 group border-b border-zinc-200 last:border-b-0 transition-all ${
          isDragging 
            ? 'opacity-30 border-dashed border-emerald-600/50 bg-transparent' 
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

        <div className="flex-1 min-w-0">
          <div className="font-medium truncate flex items-center gap-2">
            {activity.title}
            {activity.status === "active" && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-600">ĐANG CHẠY</span>
            )}
          </div>
          <div className="text-xs text-zinc-500 flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="capitalize">{activity.type}</span>
            {activity.timeLimit && <span className="text-blue-600">⏱ {activity.timeLimit}p</span>}
            {activity.requiresStudentCode && <span className="text-purple-400">👤 Mã SV</span>}
            {activity.slideCue && (
              <span className="text-amber-600 flex items-center gap-1">📍 {activity.slideCue}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 opacity-80 group-hover:opacity-100">
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 transition-colors"
          >
            Sửa
          </button>
          <button
            onClick={onDuplicate}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100 transition-colors"
          >
            Làm lại
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
          >
            Xóa
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Top Bar */}
      <div className="border-b border-zinc-200 bg-zinc-50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setFullscreenOverlay("qr")}
              className="text-left group"
              title="Chiếu QR + mã phòng (phím Q)"
            >
              <div className="text-xs text-zinc-500 group-hover:text-zinc-600">MÃ PHÒNG · Chiếu (Q)</div>
              <div className="flex items-center gap-3">
                <div className="text-3xl font-mono tracking-[4px] font-semibold text-zinc-900 group-hover:text-emerald-600 transition-colors">
                  {session.code}
                </div>
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR mã phòng"
                    className="w-12 h-12 rounded-md bg-white p-0.5 ring-1 ring-zinc-700 group-hover:ring-emerald-500 transition-all"
                  />
                )}
              </div>
            </button>

            <div className="h-8 w-px bg-zinc-100" />

            <div>
              <div className="text-sm text-zinc-600">Buổi giảng</div>
              <div className="text-lg font-medium">{session.title}</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-zinc-200">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-sm">
                {totalParticipants} sinh viên tham gia
              </span>
            </div>

            <div className="flex items-center gap-2">
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
              {hasPdf ? (
                <button
                  onClick={() => setFullscreenOverlay("slides")}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
                  title={`Chiếu slide PDF (${session.pdfFileName}, ${pdfTotalPages} trang) — phím S`}
                >
                  📑 Chiếu slide <span className="text-[10px] opacity-70">(S)</span>
                </button>
              ) : (
                <button
                  onClick={() => pdfFileInputRef.current?.click()}
                  disabled={isUploadingPdf}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 disabled:opacity-60 transition-colors"
                  title="Upload PDF slide (thay PowerPoint, chiếu trong cùng tab)"
                >
                  {isUploadingPdf ? "Đang tải..." : "📑 Upload PDF"}
                </button>
              )}

              <button
                onClick={() => setFullscreenOverlay("result")}
                disabled={!activeActivity}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-amber-500 text-black font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Chiếu kết quả hoạt động đang diễn ra lên màn hình (phím F)"
              >
                📺 Chiếu kết quả <span className="text-[10px] opacity-70">(F)</span>
              </button>

              <button
                onClick={handleExportResults}
                disabled={!exportData || isExporting}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 disabled:opacity-60 transition-colors"
              >
                {isExporting ? "Đang xuất..." : "Xuất CSV"}
              </button>

              <button
                onClick={handleExportExcel}
                disabled={!exportData || isExporting}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 disabled:opacity-60 transition-colors text-white font-medium"
                title="Xuất file .xlsx (Excel) để chấm điểm và đẩy lên LMS"
              >
                {isExporting ? "Đang xuất..." : "Xuất Excel"}
              </button>

              <button
                onClick={handleExportPDF}
                disabled={!exportData || isExporting}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 transition-colors text-white font-medium"
              >
                {isExporting ? "Đang xuất..." : "Xuất PDF báo cáo"}
              </button>
            </div>

            {session.status === "ended" ? (
              <div className="px-4 py-2 text-sm rounded-lg bg-zinc-100 border border-zinc-300 text-zinc-600">
                Đã kết thúc
              </div>
            ) : (
              <button
                className="px-4 py-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                onClick={async () => {
                  if (!session?._id) return;
                  if (!confirm("Kết thúc buổi giảng? Sinh viên sẽ không thể gửi câu trả lời mới (kết quả đã có vẫn được giữ).")) return;
                  try {
                    await endSession({ sessionId: session._id });
                    toast.success("Đã kết thúc buổi giảng. Bạn vẫn có thể xuất kết quả.");
                  } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : "Không thể kết thúc buổi");
                  }
                }}
              >
                Kết thúc buổi
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* === TỔNG QUAN BUỔI GIẢNG (tạm ẩn để ổn định syntax — sẽ khôi phục + cải thiện ở Results) === */}
        {/* {exportData && ( ... dashboard stats ... )} */}

        {/* ==================== KỊCH BẢN + TRỢ LÝ LIỀN MẠCH PPT (B - Ưu tiên) ==================== */}
        {sortedActivities.length > 0 && (
          <div className="mb-8 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50">
              <div className="flex items-center gap-3">
                <div className="font-semibold text-lg flex items-center gap-2">
                  Kịch bản hoạt động
                  {isScriptMode && <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium">ĐANG TRÌNH DIỄN</span>}
                </div>
                <div className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{scriptLength} hoạt động</div>
              </div>

              {!isScriptMode ? (
                <div className="flex items-center gap-2">
                  <button onClick={startScriptMode} className="px-5 py-2 text-sm rounded-xl bg-emerald-600 hover:bg-emerald-500 font-medium flex items-center gap-2">▶ Chạy theo kịch bản</button>
                  <button 
                    onClick={async () => {
                      const name = prompt("Tên kịch bản mẫu (ví dụ: Tuần 5 - Kỹ thuật phần mềm):");
                      if (!name || !session?._id) return;
                      try {
                        await saveScriptAsTemplate({ sessionId: session._id, name: name.trim() });
                        toast.success("Đã lưu kịch bản thành mẫu!");
                      } catch (e: any) {
                        toast.error(e.message || "Không thể lưu kịch bản");
                      }
                    }}
                    className="px-4 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700"
                  >
                    💾 Lưu kịch bản
                  </button>

                  <button
                    onClick={() => setShowTemplatesModal(true)}
                    className="px-4 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700"
                  >
                    📚 Kịch bản đã lưu
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {!isPresentationMode && <button onClick={() => setIsPresentationMode(true)} className="px-4 py-2 text-sm rounded-lg bg-white text-black font-medium">Vào chế độ Trình diễn</button>}
                  <button 
                    onClick={openCompanionWindow} 
                    className="px-5 py-2 text-sm rounded-lg bg-amber-500 text-black font-bold hover:bg-amber-400 shadow flex items-center gap-2 ring-1 ring-amber-300/50"
                    title="Mở cửa sổ Companion (đặt trên màn hình laptop khi chiếu PowerPoint)"
                  >
                    📍 Mở Trợ lý Kịch bản (nhỏ)
                  </button>

                  {/* Picture-in-Picture mode - siêu nhỏ, kéo vào góc màn hình */}
                  <button 
                    onClick={() => {
                      const url = `/presenter/${upperCode}/companion?pip=true`;
                      window.open(url, 'pip-companion', 'width=380,height=240,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
                    }} 
                    className="px-3 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700 flex items-center gap-1.5"
                    title="Mở Picture-in-Picture siêu nhỏ (kéo thả vào góc màn hình laptop khi chiếu PowerPoint fullscreen)"
                  >
                    🖼️ PiP
                  </button>

                  {/* Bảng thành tích - Top người tham gia */}
                  <button
                    onClick={() => {
                      // Mở cửa sổ chiếu Bảng thành tích riêng (để chiếu màn hình lớn)
                      const url = `/presenter/${upperCode}/leaderboard`;
                      window.open(url, 'leaderboard', 'width=900,height=600,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
                    }}
                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-2"
                    title="Mở Bảng thành tích (Top 10) để chiếu lên màn hình"
                  >
                    🏆 Bảng thành tích
                  </button>

                  <button
                    onClick={() => setShowScoringConfig(true)}
                    className="px-3 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700"
                    title="Cấu hình điểm cho Bảng thành tích"
                  >
                    ⚙️
                  </button>
                  <button onClick={goToPrevInScript} disabled={currentScriptIndex === 0} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40">← Trước</button>
                  <button onClick={goToNextInScript} disabled={currentScriptIndex >= scriptLength - 1} className="px-6 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium">Tiếp theo → <span className="text-[10px] opacity-75">(Space)</span></button>
                  <button onClick={stopScriptMode} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-red-100/30 text-red-600">Dừng</button>
                </div>
              )}
            </div>

            {isScriptMode && currentScriptActivity && (
              <div className="px-6 py-4 bg-zinc-50/70 border-b border-zinc-200 text-sm">
                <div className="flex items-center gap-4">
                  <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden"><div className="h-1.5 bg-emerald-500 transition-all" style={{width: scriptLength > 0 ? ((currentScriptIndex + 1) / scriptLength) * 100 : 0 + "%"}} /></div>
                  <div className="font-mono text-emerald-600 w-16 text-right">{currentScriptIndex + 1}/{scriptLength}</div>
                </div>
                {currentScriptActivity.slideCue && <div className="mt-3 text-amber-600 font-bold text-lg">📍 {currentScriptActivity.slideCue}</div>}
              </div>
            )}
            <div className="px-6 py-3 text-xs text-zinc-500">Mở "Trợ lý Kịch bản (nhỏ)" để có cửa sổ chuyên biệt trên laptop khi PowerPoint fullscreen.</div>
          </div>
        )}

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

        {/* === Tạo nhanh (mẫu Đập và Hồ chứa) */}
        <div className="mb-4">
          <div className="text-xs text-blue-600 font-medium mb-1.5 px-1">Tạo nhanh — Mẫu hoạt động (gắn mốc slide)</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => quickCreateActivity("wordcloud", "Liên tưởng về Đập và Hồ chứa", "Slide 3")} className="px-3 py-1 text-xs rounded-lg bg-blue-600/90 hover:bg-blue-600 text-white">Word Cloud</button>
            <button onClick={() => quickCreateActivity("poll", "Mức độ hiểu phân loại đập", "Slide 10")} className="px-3 py-1 text-xs rounded-lg bg-blue-600/90 hover:bg-blue-600 text-white">Poll</button>
            <button onClick={() => quickCreateActivity("qa", "Câu hỏi về cấu tạo đập đất", "Slide 18")} className="px-3 py-1 text-xs rounded-lg bg-blue-600/90 hover:bg-blue-600 text-white">Q&A</button>
            <button onClick={() => quickCreateActivity("rating", "Đánh giá mức nắm vững công thức tính lưu lượng tràn", "Slide 24")} className="px-3 py-1 text-xs rounded-lg bg-blue-600/90 hover:bg-blue-600 text-white">Rating</button>
          </div>
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
                        {draggingActivity.slideCue && <span className="text-amber-600">📍 {draggingActivity.slideCue}</span>}
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

        {/* ==================== DỮ LIỆU TRỰC TIẾP (Results section - sạch, sẵn sàng cải thiện sâu theo B) ==================== */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Dữ liệu trực tiếp</h2>

          {activeActivity ? (
            <div 
              ref={resultsRef}
              className={`bg-white border rounded-2xl p-6 transition-all duration-300 ${
                highlightResults ? "border-emerald-500 ring-1 ring-emerald-500/30" : "border-zinc-200"
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">Kết quả đang diễn ra</h3>
                  <button
                    onClick={() => {
                      setHighlightResults(true);
                      setTimeout(() => setHighlightResults(false), 800);
                    }}
                    className="text-xs px-3 py-1 rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900 transition-colors"
                  >
                    Làm mới
                  </button>
                </div>
                <div className="text-sm text-emerald-600 font-medium">
                  {activeActivity.type === "poll" && pollResults && `${pollResults.totalAnswered} đã trả lời`}
                  {activeActivity.type === "wordcloud" && wordCloudResults && `${wordCloudResults.totalResponses} phản hồi`}
                  {activeActivity.type === "rating" && ratingResults && `${ratingResults.total} lượt`}
                  {activeActivity.type === "qa" && qaResponses && `${qaResponses.length} câu hỏi`}
                  {activeActivity.type === "board" && boardPosts && `${boardPosts.length} bài đăng`}
                </div>
              </div>

              {/* Empty states nhất quán */}
              {activeActivity.type === "poll" && (!pollResults || pollResults.totalAnswered === 0) && (
                <div className="text-center py-10 text-zinc-600 text-sm">Chưa có sinh viên nào trả lời</div>
              )}
              {activeActivity.type === "wordcloud" && (!wordCloudResults || wordCloudResults.totalResponses === 0) && (
                <div className="text-center py-10 text-zinc-600 text-sm">Chưa có từ khóa nào</div>
              )}
              {activeActivity.type === "rating" && (!ratingResults || ratingResults.total === 0) && (
                <div className="text-center py-10 text-zinc-600 text-sm">Chưa có đánh giá nào</div>
              )}
              {activeActivity.type === "qa" && (!qaResponses || qaResponses.length === 0) && (
                <div className="text-center py-10 text-zinc-600 text-sm">Chưa có câu hỏi nào</div>
              )}
              {activeActivity.type === "board" && (!boardPosts || boardPosts.length === 0) && (
                <div className="text-center py-10 text-zinc-600 text-sm">Chưa có bài đăng nào</div>
              )}

              {/* === POLL === */}
              {activeActivity.type === "poll" && pollResults && pollResults.options?.length > 0 && (
                <div className="space-y-3">
                  {[...pollResults.options].sort((a, b) => b.count - a.count).map((opt: any) => {
                    const percentage = pollResults.totalAnswered > 0 ? Math.round((opt.count / pollResults.totalAnswered) * 100) : 0;
                    return (
                      <div key={opt.id} className="flex items-center gap-4">
                        <div className="w-48 text-sm truncate" title={opt.text}>{opt.text}</div>
                        <div className="flex-1 bg-zinc-100 rounded-full h-3 overflow-hidden">
                          <div className="bg-emerald-500 h-3 transition-all rounded-full" style={{ width: `${percentage}%` }} />
                        </div>
                        <div className="w-24 text-right text-sm font-mono text-emerald-600">
                          {opt.count} <span className="text-emerald-500">({percentage}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* === WORD CLOUD === */}
              {activeActivity.type === "wordcloud" && wordCloudResults && wordCloudResults.words.length > 0 && (
                <div>
                  <div className="flex justify-between text-sm text-zinc-600 mb-2">
                    <span>Đám mây từ (top 50)</span>
                    <span>{wordCloudResults.words.length} từ khác nhau</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 items-center justify-center py-6 min-h-[160px] bg-zinc-50 rounded-2xl border border-zinc-200">
                    {wordCloudResults.words.slice(0, 50).map((item: any, idx: number) => {
                      const max = wordCloudResults.words[0]?.count || 1;
                      const size = Math.max(14, Math.min(44, Math.round(14 + (item.count / max) * 30)));
                      const opacity = Math.max(0.5, Math.min(1, 0.55 + (item.count / max) * 0.45));
                      return (
                        <span key={idx} className="font-medium px-1.5" style={{ fontSize: `${size}px`, color: `rgba(52, 211, 153, ${opacity})` }} title={`${item.word} — ${item.count} lần`}>
                          {item.word}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* === RATING (đã cải thiện - Phân bố rõ ràng + nhãn tùy chỉnh) === */}
              {activeActivity.type === "rating" && ratingResults && (
                <div>
                  {/* Header */}
                  <div className="flex items-end justify-between mb-5">
                    <div>
                      <div className="text-5xl font-semibold tabular-nums text-emerald-600">
                        {ratingResults.average || "—"}
                      </div>
                      <div className="text-sm text-zinc-600 mt-0.5">
                        Điểm trung bình • {ratingResults.total} lượt đánh giá
                      </div>
                    </div>

                    <div className="text-right text-xs text-zinc-500">
                      Thang {activeActivity.config?.min || 1}–{activeActivity.config?.max || 5}
                    </div>
                  </div>

                  {/* Custom labels */}
                  {(activeActivity.config?.minLabel || activeActivity.config?.maxLabel) && (
                    <div className="flex justify-between text-[11px] text-zinc-500 mb-3 px-1">
                      <span>{activeActivity.config?.minLabel || "Thấp nhất"}</span>
                      <span>{activeActivity.config?.maxLabel || "Cao nhất"}</span>
                    </div>
                  )}

                  {/* Distribution */}
                  <div className="space-y-2.5">
                    {Array.from({ length: (activeActivity.config?.max || 5) - (activeActivity.config?.min || 1) + 1 }, (_, i) => {
                      const score = (activeActivity.config?.min || 1) + i;
                      const count = ratingResults.distribution?.[score] || 0;
                      const total = ratingResults.total || 1;
                      const pct = Math.round((count / total) * 100);
                      const isHigh = score >= ((activeActivity.config?.min || 1) + (activeActivity.config?.max || 5)) / 2;

                      return (
                        <div key={score} className="flex items-center gap-3 group">
                          <div className="w-8 text-right font-semibold text-sm tabular-nums text-zinc-700">
                            {score}
                          </div>

                          <div className="flex-1 bg-zinc-100 rounded-full h-3.5 overflow-hidden border border-zinc-300">
                            <div 
                              className={`h-3.5 transition-all duration-300 rounded-full ${isHigh ? "bg-emerald-500" : "bg-emerald-600/80"}`}
                              style={{ width: `${pct}%` }} 
                            />
                          </div>

                          <div className="w-24 text-right text-sm font-mono text-emerald-600 tabular-nums flex items-baseline justify-end gap-1.5">
                            <span className="font-medium">{count}</span>
                            <span className="text-[10px] text-emerald-500">({pct}%)</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 text-[11px] text-zinc-500 text-center">
                    Phân bố điểm đánh giá (càng cao càng tích cực)
                  </div>
                </div>
              )}

              {/* === Q&A (đã cải thiện sâu - Moderation cho presenter) === */}
              {activeActivity.type === "qa" && qaResponses && qaResponses.length > 0 && (
                <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                  {qaResponses.map((q: any) => {
                    const v = typeof q.value === "object" && q.value ? q.value : {};
                    const isHidden = q.status === "hidden";
                    const isAnswering = answeringId === q._id;

                    return (
                      <div 
                        key={q._id} 
                        className={`bg-zinc-50 border rounded-xl p-4 transition-all ${isHidden ? "border-zinc-300 opacity-60" : "border-zinc-200"}`}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[15px] leading-snug">{v.text || q.value}</div>
                            
                            {/* Student info if available */}
                            {(q.studentCode || q.fullName) && (
                              <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                                <span className="font-mono">{q.studentCode}</span>
                                {q.fullName && <span>· {q.fullName}</span>}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Status */}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium tracking-wide ${isHidden ? "bg-zinc-200 text-zinc-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                              {isHidden ? "ĐÃ ẨN" : "HIỂN THỊ"}
                            </span>

                            {/* Upvotes */}
                            <div className="text-xs text-zinc-600 flex items-center gap-1 bg-white px-2 py-0.5 rounded">
                              ↑ {v.upvotes || 0}
                            </div>
                          </div>
                        </div>

                        {/* Answer (if exists) */}
                        {v.answer && (
                          <div className="mt-3 ml-1 pl-3 border-l-2 border-emerald-600 text-sm text-emerald-700 bg-emerald-50/30 py-2 px-3 rounded-r">
                            {v.answer}
                          </div>
                        )}

                        {/* Inline Answer Form */}
                        {isAnswering && (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={answerText}
                              onChange={(e) => setAnswerText(e.target.value)}
                              placeholder="Nhập câu trả lời của bạn..."
                              className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm resize-y min-h-[70px]"
                              rows={3}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setAnsweringId(null);
                                  setAnswerText("");
                                }}
                                className="px-4 py-1.5 text-xs rounded-lg border border-zinc-300 hover:bg-zinc-100"
                              >
                                Hủy
                              </button>
                              <button
                                onClick={async () => {
                                  if (!answerText.trim()) return;
                                  try {
                                    await answerQaQuestion({ responseId: q._id, answer: answerText.trim() });
                                    toast.success("Đã trả lời câu hỏi");
                                    setAnsweringId(null);
                                    setAnswerText("");
                                  } catch (e) {
                                    toast.error("Không thể trả lời");
                                  }
                                }}
                                disabled={!answerText.trim()}
                                className="px-4 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium"
                              >
                                Gửi trả lời
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Presenter Actions */}
                        {!isAnswering && (
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-200">
                            <button
                              onClick={() => {
                                setAnsweringId(q._id);
                                setAnswerText(v.answer || "");
                              }}
                              className="text-xs px-3 py-1 rounded-lg border border-zinc-300 hover:bg-zinc-100 text-emerald-600"
                            >
                              {v.answer ? "Sửa trả lời" : "Trả lời"}
                            </button>

                            <button
                              onClick={async () => {
                                try {
                                  const newStatus = isHidden ? "visible" : "hidden";
                                  await setQaQuestionStatus({ responseId: q._id, status: newStatus });
                                  toast.success(isHidden ? "Đã hiện câu hỏi" : "Đã ẩn câu hỏi");
                                } catch (e) {
                                  toast.error("Thao tác thất bại");
                                }
                              }}
                              className="text-xs px-3 py-1 rounded-lg border border-zinc-300 hover:bg-zinc-100"
                            >
                              {isHidden ? "Hiện lại" : "Ẩn"}
                            </button>

                            <button
                              onClick={async () => {
                                if (!confirm("Bạn có chắc muốn xóa câu hỏi này?")) return;
                                try {
                                  await deleteQaQuestion({ responseId: q._id });
                                  toast.success("Đã xóa câu hỏi");
                                } catch (e) {
                                  toast.error("Không thể xóa");
                                }
                              }}
                              className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 ml-auto"
                            >
                              Xóa
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* === BOARD (cơ bản) === */}
              {activeActivity.type === "board" && boardPosts && boardPosts.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(activeActivity.config?.columns || []).map((col: any) => {
                    const posts = boardPosts.filter((p: any) => p.columnId === col.id);
                    return (
                      <div key={col.id} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                        <div className="font-medium mb-2 text-sm">{col.title}</div>
                        <div className="space-y-2">
                          {posts.length > 0 ? posts.map((post: any) => (
                            <div key={post._id} className="bg-white p-2.5 rounded-lg text-sm">
                              {post.content}
                              {post.imageUrl && <img src={post.imageUrl} className="mt-2 rounded max-h-28" alt="" />}
                              <div className="text-xs text-emerald-600 mt-1">❤️ {post.likes}</div>
                            </div>
                          )) : <div className="text-xs text-zinc-500 py-2">Chưa có bài đăng</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 text-sm text-zinc-500">
              Chưa có hoạt động nào đang chạy. Kết quả sẽ hiển thị realtime khi bạn kích hoạt hoạt động.
            </div>
          )}
        </div>

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
                {/* ===== Loại hoạt động ===== */}
                <div>
                  <label className="text-sm font-semibold text-zinc-700 block mb-2">
                    Loại hoạt động {editingActivity && <span className="text-xs text-zinc-500 font-normal">(không thể đổi khi chỉnh sửa)</span>}
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {(["poll", "wordcloud", "rating", "qa", "board"] as const).map((t) => {
                      const labels: Record<string, { icon: string; name: string }> = {
                        poll: { icon: "📊", name: "Poll" },
                        wordcloud: { icon: "☁️", name: "Word Cloud" },
                        rating: { icon: "⭐", name: "Rating" },
                        qa: { icon: "❓", name: "Q&A" },
                        board: { icon: "📌", name: "Board" },
                      };
                      return (
                        <button
                          key={t}
                          onClick={() => !editingActivity && setCreateType(t)}
                          disabled={!!editingActivity}
                          className={`px-2 py-3 text-xs rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                            createType === t
                              ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-semibold"
                              : "border-zinc-200 hover:border-zinc-400 text-zinc-700"
                          } ${editingActivity ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                          <span className="text-2xl">{labels[t].icon}</span>
                          <span>{labels[t].name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ===== Tiêu đề + mô tả ===== */}
                <div>
                  <label className="text-sm font-semibold text-zinc-700 block mb-1.5">
                    Tiêu đề <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={pollTitle}
                    onChange={(e) => { setPollTitle(e.target.value); setTitleError(""); }}
                    placeholder="VD: Phân loại đập theo vật liệu"
                    className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500"
                  />
                  {titleError && <div className="text-xs text-red-600 mt-1">{titleError}</div>}
                </div>

                <div>
                  <label className="text-sm font-semibold text-zinc-700 block mb-1.5">Mô tả (tùy chọn)</label>
                  <textarea
                    value={pollDescription}
                    onChange={(e) => setPollDescription(e.target.value)}
                    placeholder="Giải thích/gợi ý hiển thị dưới tiêu đề khi SV trả lời"
                    rows={2}
                    className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-2 text-sm resize-y focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-zinc-700 block mb-1.5">Mốc slide PowerPoint (tùy chọn)</label>
                  <input
                    type="text"
                    value={slideCue}
                    onChange={(e) => setSlideCue(e.target.value)}
                    placeholder="VD: Slide 7, Sau slide 12"
                    className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500"
                  />
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
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => {
                                const next = [...options];
                                next[idx] = e.target.value;
                                setOptions(next);
                              }}
                              placeholder={`Lựa chọn ${idx + 1}${idx === 0 ? " (VD: Đập bê tông trọng lực)" : ""}`}
                              className="flex-1 bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                            />
                            {options.length > 2 && (
                              <button
                                onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                                className="px-2 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg"
                                title="Xóa lựa chọn này"
                              >
                                ✕
                              </button>
                            )}
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
                        <input
                          type="text"
                          value={ratingMinLabel}
                          onChange={(e) => setRatingMinLabel(e.target.value)}
                          placeholder="Rất không hiểu"
                          className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-zinc-700 block mb-1.5">Nhãn điểm cao</label>
                        <input
                          type="text"
                          value={ratingMaxLabel}
                          onChange={(e) => setRatingMaxLabel(e.target.value)}
                          placeholder="Rất hiểu rõ"
                          className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                        />
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
                            <input
                              type="text"
                              value={col.title}
                              onChange={(e) => {
                                const next = [...boardColumns];
                                next[idx] = { ...col, title: e.target.value };
                                setBoardColumns(next);
                              }}
                              placeholder={`Tên cột ${idx + 1}`}
                              className="flex-1 bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                            />
                            {boardColumns.length > 1 && (
                              <button
                                onClick={() => setBoardColumns(boardColumns.filter((_, i) => i !== idx))}
                                className="px-2 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg"
                              >
                                ✕
                              </button>
                            )}
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

                {/* ===== Bắt buộc mã SV ===== */}
                <label className="flex items-start gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-xl cursor-pointer hover:bg-zinc-100/70">
                  <input
                    type="checkbox"
                    checked={requiresStudentCode}
                    onChange={(e) => setRequiresStudentCode(e.target.checked)}
                    className="w-4 h-4 accent-emerald-600 mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-zinc-700">Bắt buộc mã SV để trả lời</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      Ghi nhận điểm tham gia cho từng SV. Nếu tắt, hoạt động hoàn toàn ẩn danh (chỉ xem tổng quan).
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
                    <div key={tpl._id} className="bg-zinc-100 border border-zinc-300 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{tpl.name}</div>
                        <div className="text-xs text-zinc-500">
                          {tpl.activitiesSnapshot?.length || 0} hoạt động • {new Date(tpl.createdAt).toLocaleDateString('vi-VN')}
                        </div>
                      </div>
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
                        className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium"
                      >
                        Áp dụng
                      </button>
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
          onClick={() => setFullscreenOverlay(null)}
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
            <div className="mt-10 text-zinc-500 text-sm">Bấm <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Esc</kbd> hoặc click để đóng • Bấm <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Q</kbd> để mở lại</div>
          </div>
        </div>
      )}

      {fullscreenOverlay === "result" && (
        <div className="fixed inset-0 z-[100] bg-zinc-950 text-white overflow-auto">
          <button
            onClick={() => setFullscreenOverlay(null)}
            className="fixed top-6 right-6 px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 z-10"
          >
            Đóng (Esc)
          </button>
          {!activeActivity ? (
            <div className="min-h-screen flex items-center justify-center text-center">
              <div>
                <div className="text-6xl mb-4">📊</div>
                <div className="text-3xl font-semibold mb-2">Chưa có hoạt động đang diễn ra</div>
                <div className="text-zinc-400 text-lg">Khi có hoạt động đang chạy, bấm <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">F</kbd> để chiếu kết quả lên màn hình</div>
              </div>
            </div>
          ) : (
            <div className="min-h-screen p-12 flex flex-col">
              <div className="mb-8">
                <div className="text-emerald-400 text-lg tracking-[6px] mb-2">{activeActivity.type.toUpperCase()} • ĐANG DIỄN RA</div>
                <div className="text-5xl md:text-6xl font-bold tracking-tight">{activeActivity.title}</div>
                {activeActivity.slideCue && (
                  <div className="mt-3 text-amber-400 text-2xl">📍 {activeActivity.slideCue}</div>
                )}
              </div>

              <div className="flex-1 flex items-center justify-center">
                {/* POLL fullscreen */}
                {activeActivity.type === "poll" && pollResults && pollResults.options?.length > 0 && (
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
                {activeActivity.type === "wordcloud" && wordCloudResults && wordCloudResults.words.length > 0 && (
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

                {/* RATING fullscreen */}
                {activeActivity.type === "rating" && ratingResults && (
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
                      {Array.from({ length: (activeActivity.config?.max || 5) - (activeActivity.config?.min || 1) + 1 }, (_, i) => {
                        const score = (activeActivity.config?.min || 1) + i;
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
                {activeActivity.type === "qa" && qaResponses && qaResponses.length > 0 && (
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
                {activeActivity.type === "board" && boardPosts && boardPosts.length > 0 && (
                  <div className="w-full max-w-6xl">
                    <div className="grid grid-cols-3 gap-6">
                      {(activeActivity.config?.columns || []).map((col: any) => {
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

                {/* Empty state cho fullscreen */}
                {((activeActivity.type === "poll" && (!pollResults || pollResults.totalAnswered === 0)) ||
                  (activeActivity.type === "wordcloud" && (!wordCloudResults || wordCloudResults.totalResponses === 0)) ||
                  (activeActivity.type === "rating" && (!ratingResults || ratingResults.total === 0)) ||
                  (activeActivity.type === "qa" && (!qaResponses || qaResponses.length === 0)) ||
                  (activeActivity.type === "board" && (!boardPosts || boardPosts.length === 0))) && (
                  <div className="text-center text-zinc-400">
                    <div className="text-6xl mb-4">⏳</div>
                    <div className="text-3xl">Đang chờ sinh viên trả lời...</div>
                  </div>
                )}
              </div>

              <div className="text-center text-zinc-600 text-sm mt-6">
                Bấm <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">F</kbd> hoặc <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Esc</kbd> để thoát chế độ chiếu
              </div>
            </div>
          )}
        </div>
      )}

      {fullscreenOverlay === "slides" && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
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

            {/* Badge mã phòng nhỏ ở góc — để SV vẫn join được khi đang chiếu slide */}
            {hasPdf && (
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white text-xs flex items-center gap-2">
                <span className="text-zinc-400">Mã phòng:</span>
                <span className="font-mono font-bold tracking-widest">{upperCode}</span>
              </div>
            )}

            {/* Overlay activity result nổi lên trên slide khi có activity đang chạy */}
            {activeActivity && (
              <div className="absolute bottom-6 right-6 bg-zinc-900/95 backdrop-blur-sm border border-emerald-500/40 rounded-2xl p-4 max-w-md text-white shadow-2xl">
                <div className="text-[10px] tracking-[3px] text-emerald-400 mb-1">HOẠT ĐỘNG ĐANG DIỄN RA</div>
                <div className="font-semibold text-base mb-2">{activeActivity.title}</div>
                <div className="text-xs text-zinc-400">
                  {activeActivity.type === "poll" && pollResults && `${pollResults.totalAnswered} đã trả lời`}
                  {activeActivity.type === "wordcloud" && wordCloudResults && `${wordCloudResults.totalResponses} phản hồi`}
                  {activeActivity.type === "rating" && ratingResults && `${ratingResults.total} lượt`}
                  {activeActivity.type === "qa" && qaResponses && `${qaResponses.length} câu hỏi`}
                  {activeActivity.type === "board" && boardPosts && `${boardPosts.length} bài đăng`}
                </div>
                <button
                  onClick={() => setFullscreenOverlay("result")}
                  className="mt-3 w-full px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-black font-semibold hover:bg-amber-400"
                >
                  Chiếu to kết quả (F)
                </button>
              </div>
            )}
          </div>

          {/* Thanh điều khiển slide */}
          <div className="h-14 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between px-6 text-white shrink-0">
            <button
              onClick={() => setFullscreenOverlay(null)}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
            >
              Đóng (Esc)
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={goPdfPrev}
                disabled={!hasPdf || pdfCurrentPage <= 1}
                className="px-4 py-1.5 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-800 disabled:opacity-30"
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
    </div>
  );
}

export default PresenterPage;
