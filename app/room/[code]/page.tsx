"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import React, { useState, useEffect } from "react";
import { VnInput, VnTextarea } from "@/components/VnInput";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { ActivityReplay } from "@/components/ActivityReplay";
import { ReactionBar } from "@/components/ReactionBar";

// Append voice transcript vào current text (space giữa nếu cần)
function appendVoice(current: string, voice: string): string {
  const c = current.trim();
  const v = voice.trim();
  if (!c) return v;
  return `${c} ${v}`;
}
import {
  isPushSupported,
  getNotificationPermission,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pushClient";
import { Logo } from "@/components/Logo";

interface StudentIdentity {
  studentCode: string;
  fullName: string;
  className: string;
}

// Lấy hoặc tạo deviceId cố định cho thiết bị này (chống điểm danh hộ / làm bài hộ)
function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "presenter_tlu_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

export default function ParticipantRoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const upperCode = code?.toUpperCase();

  // Lấy thông tin buổi
  const session = useQuery(
    api.sessions.getSessionByCode,
    upperCode ? { code: upperCode } : "skip"
  );

  // Ngữ cảnh phòng: có liên thông LMS không?
  const joinCtx = useQuery(
    api.lms.peekJoinContext,
    upperCode ? { code: upperCode } : "skip"
  );

  // Check current user — nếu là GV đã login + sở hữu session (hoặc admin)
  // thì auto-redirect sang /presenter/CODE (host view). SV không login → ở lại /room/.
  // Trừ khi URL có ?from_lms=1 (SV vừa checkin LMS xong → luôn vào /room dù có cookie)
  const me = useQuery(api.userProfiles.me);
  useEffect(() => {
    if (!upperCode || !session || !me?.user || !me?.profile) return;
    if (me.profile.status !== "approved") return;

    // Nếu SV đang chuyển từ LMS → đừng redirect
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("from_lms") === "1") return;
      if (params.get("as_student") === "1") return; // GV test SV view
    }

    const isOwner = session.ownerUserId === me.user._id;
    const isAdmin = me.profile.role === "admin";
    if (isOwner || isAdmin) {
      router.replace(`/presenter/${upperCode}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?._id, me?.user?._id, me?.profile?.status, me?.profile?.role, upperCode]);

  // Lấy hoạt động đang active
  const activeActivity = useQuery(
    api.activities.getActiveActivity,
    session?._id ? { sessionId: session._id } : "skip"
  );

  // Kết quả poll (nếu là poll)
  const pollResults = useQuery(
    api.responses.getPollVoteCounts,
    activeActivity && activeActivity.type === "poll"
      ? { activityId: activeActivity._id }
      : "skip"
  );

  // Danh sách câu hỏi Q&A
  const qaQuestions = useQuery(
    api.responses.getActivityResponses,
    activeActivity && activeActivity.type === "qa"
      ? { activityId: activeActivity._id }
      : "skip"
  );

  const submitResponse = useMutation(api.responses.submitResponse);
  const joinSession = useMutation(api.participants.joinSession);
  const upvoteQuestion = useMutation(api.responses.upvoteQuestion);
  const heartbeat = useMutation(api.presence.heartbeat);

  // Presence: báo "còn online" định kỳ để presenter đếm số SV đang kết nối
  useEffect(() => {
    if (!session?._id) return;
    const sid = session._id;
    const clientId = getOrCreateDeviceId();
    const ping = () => heartbeat({ sessionId: sid, clientId }).catch(() => {});
    ping();
    const id = setInterval(ping, 20_000);
    return () => clearInterval(id);
  }, [session?._id, heartbeat]);

  // Board
  const boardPosts = useQuery(
    api.board.listBoardPosts,
    activeActivity && activeActivity.type === "board"
      ? { activityId: activeActivity._id }
      : "skip"
  );

  // Bảng thành tích - xem hạng cá nhân
  const myRankData = useQuery(
    api.leaderboard.getParticipationLeaderboard,
    session?._id ? { sessionId: session._id } : "skip"
  );
  const createBoardPost = useMutation(api.board.createBoardPost);
  const toggleLikeBoardPost = useMutation(api.board.toggleLikeBoardPost);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  // Danh tính sinh viên (lưu localStorage theo mã phòng)
  const [identity, setIdentity] = useState<StudentIdentity | null>(null);
  const [showIdentityForm, setShowIdentityForm] = useState(false);

  // Query câu trả lời đã gửi của chính SV cho activity hiện tại (chống submit lại)
  const myResponse = useQuery(
    api.responses.getMyResponse,
    activeActivity?._id && identity?.studentCode
      ? { activityId: activeActivity._id, studentCode: identity.studentCode }
      : "skip"
  );

  // Form nhập danh tính
  // Pre-fill MSV/họ tên/lớp từ URL params NGAY (synchronous) — kể cả khi auto-join
  // chưa chạy / fail. SV không phải retype.
  const [studentCodeInput, setStudentCodeInput] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("sid")?.trim() || "";
  });
  const [fullNameInput, setFullNameInput] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("name")?.trim() || "";
  });
  const [classNameInput, setClassNameInput] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("class")?.trim() || "";
  });

  // Cờ "đang auto-join từ LMS link" — hiện loading splash thay vì form
  const [autoJoining, setAutoJoining] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!new URLSearchParams(window.location.search).get("sid")?.trim();
  });

  // Chế độ vào phòng (accessMode) — quyết định trường nào hiện/bắt buộc trong form danh tính.
  // roster: chỉ MSV (họ tên/lớp tự động) · open: MSV tùy chọn + họ tên + lớp · public: chỉ họ tên.
  const accessMode = joinCtx?.accessMode ?? "open";
  const showNameFields = accessMode !== "roster";
  const requireClass = accessMode === "open";
  // Đối chiếu MSV với danh sách lớp (nếu có) → hiện "✓ khớp" và miễn khai họ tên/lớp.
  const roomCtxMatch = useQuery(
    api.lms.peekJoinContext,
    upperCode && studentCodeInput.trim()
      ? { code: upperCode, studentCode: studentCodeInput.trim() }
      : "skip"
  );
  const rosterMatch = roomCtxMatch?.rosterMatch ?? null;

  // Trạng thái vote (Poll)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  // Trạng thái nhập cho Word Cloud
  const [wordcloudInput, setWordcloudInput] = useState("");
  // Trạng thái nhập cho Q&A
  const [qaQuestionInput, setQaQuestionInput] = useState("");
  // Trạng thái nhập cho Board
  const [boardContentInput, setBoardContentInput] = useState("");
  const [boardSelectedColumn, setBoardSelectedColumn] = useState<string>("");
  const [boardSelectedImage, setBoardSelectedImage] = useState<File | null>(null);
  const [boardImagePreview, setBoardImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Timer
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Web Push notification state
  const [pushStatus, setPushStatus] = useState<
    "unsupported" | "default" | "denied" | "subscribed" | "unsubscribed" | "checking"
  >("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(false);
  const registerPushSubscription = useMutation(api.pushSubscriptions.registerSubscription);
  const unregisterPushSubscription = useMutation(api.pushSubscriptions.unregisterSubscription);

  // Load danh tính: ưu tiên LMS deep link → per-room → fallback global identity
  useEffect(() => {
    if (!upperCode) return;

    // Nếu URL có ?sid= (LMS deep link) → BYPASS me-gate, auto-join NGAY.
    // Tránh case me query treo lâu → splash kẹt.
    const hasSidParam = typeof window !== "undefined" &&
      !!new URLSearchParams(window.location.search).get("sid")?.trim();

    if (!hasSidParam) {
      // GATE: nếu user đã login Convex (GV) thì KHÔNG auto-join SV identity
      // — sẽ tự redirect sang /presenter/CODE ở effect khác. Chỉ chạy auto-join
      // khi me query đã load và xác nhận KHÔNG phải GV approved.
      if (me === undefined) return; // đợi me load
      if (me?.user && me?.profile?.status === "approved") {
        // GV đã login → skip toàn bộ auto-join SV
        return;
      }
    }

    // 0. LMS DEEP LINK: SV vừa điểm danh xong ở LMS rồi redirect sang đây.
    // Bất kỳ URL nào có ?sid=<MSV> đều được coi là "đăng nhập tự động".
    // - Phòng LMS-linked: backend lookup roster → resolve fullName/className
    // - Phòng tự do (legacy): backend cần fullName/className → fail nếu thiếu
    //   → fallback hiện form pre-fill MSV để SV chỉ gõ thêm 2 trường.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get("sid")?.trim();
      const name = params.get("name")?.trim();
      const cls = params.get("class")?.trim();
      if (sid) {
        // Timeout 10s — nếu joinSession hang (network/cache issue) → bỏ splash
        // để SV có thể nhập thủ công thay vì kẹt mãi.
        const timeoutId = setTimeout(() => {
          setAutoJoining(false);
          toast.error("Tự động vào phòng chậm. Bạn có thể bấm 'Đăng ký tham gia' bên dưới.");
        }, 10_000);

        joinSession({
          code: upperCode,
          studentCode: sid,
          fullName: name || undefined,
          className: cls || undefined,
          deviceId: getOrCreateDeviceId(),
        })
          .then((result) => {
            const resolved: StudentIdentity = {
              studentCode: sid,
              fullName: result.fullName ?? name ?? sid,
              className: result.className ?? cls ?? "—",
            };
            localStorage.setItem(`student_${upperCode}`, JSON.stringify(resolved));
            localStorage.setItem("student_identity_global", JSON.stringify(resolved));
            localStorage.setItem("last_joined_code", upperCode);
            setIdentity(resolved);
            toast.success(`✓ Chào ${resolved.fullName} — đã vào phòng`, { duration: 4000 });
            // Dọn URL để không lộ query params khi SV share screenshot
            window.history.replaceState({}, "", window.location.pathname);
          })
          .catch((err: unknown) => {
            const e = err as { data?: string; message?: string };
            const msg = e.data || e.message || "Không thể tự động vào phòng";
            console.error("[auto-join] joinSession failed:", err);
            toast.error(`Tự động vào phòng lỗi: ${msg}. Bạn có thể nhập thủ công.`);
          })
          .finally(() => {
            clearTimeout(timeoutId);
            setAutoJoining(false);
          });
        return;
      }
      // Không có sid trong URL → tắt autoJoining (đã init true nhầm)
      setAutoJoining(false);
    } else {
      setAutoJoining(false);
    }

    // 1. Per-room (lưu sau khi SV join phòng này)
    const perRoom = localStorage.getItem(`student_${upperCode}`);
    if (perRoom) {
      try {
        const parsed = JSON.parse(perRoom) as StudentIdentity;
        if (parsed.studentCode && parsed.fullName) {
          setIdentity(parsed);
          return;
        }
      } catch {}
    }

    // 2. Fallback: global identity từ lần trước
    const global = localStorage.getItem("student_identity_global");
    if (global) {
      try {
        const parsed = JSON.parse(global) as StudentIdentity;
        if (parsed.studentCode && parsed.fullName) {
          // Tự động đăng ký vào phòng này với identity đã nhớ
          joinSession({
            code: upperCode,
            studentCode: parsed.studentCode,
            fullName: parsed.fullName,
            className: parsed.className,
            deviceId: getOrCreateDeviceId(),
          })
            .then(() => {
              localStorage.setItem(`student_${upperCode}`, JSON.stringify(parsed));
              localStorage.setItem("last_joined_code", upperCode);
              setIdentity(parsed);
            })
            .catch(() => {
              // Phòng đã đóng hoặc không tồn tại — không tự đăng ký, để SV nhập thủ công
            });
        }
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upperCode, me?.user?._id, me?.profile?.status]);

  // Tự động re-register khi:
  //  - Identity tồn tại (đã có trong localStorage)
  //  - Session vừa load HOẶC currentRun đổi (giảng viên bấm "Phiên mới")
  // → Backend joinSession sẽ tạo participant cho run hiện tại (idempotent)
  // Tránh lỗi: SV reload, localStorage có identity nhưng KHÔNG có participant record
  // cho phiên hiện tại → bảng thành tích bỏ qua SV này
  // GATE: skip nếu user là GV approved (cùng logic effect ở trên)
  useEffect(() => {
    if (!session?._id || !upperCode || !identity?.studentCode) return;
    if (me?.user && me?.profile?.status === "approved") return;
    joinSession({
      code: upperCode,
      studentCode: identity.studentCode,
      fullName: identity.fullName,
      className: identity.className,
      deviceId: getOrCreateDeviceId(),
    }).catch(() => {
      // Im lặng — phòng đóng / lỗi mạng
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?._id, session?.currentRun, identity?.studentCode, me?.user?._id, me?.profile?.status]);

  // Đọc trạng thái push hiện tại + auto-resubscribe nếu đã subscribed trước đó.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) {
        if (!cancelled) setPushStatus("unsupported");
        return;
      }
      const permission = getNotificationPermission();
      if (permission === "denied") {
        if (!cancelled) setPushStatus("denied");
        return;
      }
      const existing = await getExistingSubscription();
      if (!cancelled) {
        if (existing && permission === "granted") {
          setPushStatus("subscribed");
        } else if (permission === "granted") {
          setPushStatus("unsubscribed");
        } else {
          setPushStatus("default");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Khi đã subscribed + có identity + session → đảm bảo subscription được lưu cho session này
  useEffect(() => {
    if (pushStatus !== "subscribed") return;
    if (!session?._id || !identity?.studentCode) return;
    (async () => {
      const sub = await getExistingSubscription();
      if (!sub) return;
      const p256dh = sub.getKey("p256dh");
      const auth = sub.getKey("auth");
      if (!p256dh || !auth) return;
      const toB64 = (buf: ArrayBuffer) => {
        const bytes = new Uint8Array(buf);
        let s = "";
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
      };
      try {
        await registerPushSubscription({
          sessionId: session._id,
          studentCode: identity.studentCode,
          endpoint: sub.endpoint,
          p256dh: toB64(p256dh),
          auth: toB64(auth),
        });
      } catch {
        // im lặng
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushStatus, session?._id, identity?.studentCode]);

  const handleEnablePush = async () => {
    if (!session?._id || !identity?.studentCode) {
      toast.error("Cần vào phòng trước khi bật thông báo");
      return;
    }
    setPushBusy(true);
    try {
      const serialized = await subscribeToPush();
      if (!serialized) {
        toast.error("Trình duyệt không hỗ trợ thông báo");
        return;
      }
      await registerPushSubscription({
        sessionId: session._id,
        studentCode: identity.studentCode,
        endpoint: serialized.endpoint,
        p256dh: serialized.p256dh,
        auth: serialized.auth,
      });
      setPushStatus("subscribed");
      toast.success("Đã bật thông báo. Điện thoại sẽ rung khi có hoạt động mới.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Không thể bật thông báo";
      toast.error(msg);
      const perm = getNotificationPermission();
      if (perm === "denied") setPushStatus("denied");
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) {
        try {
          await unregisterPushSubscription({ endpoint });
        } catch {
          // ignore
        }
      }
      setPushStatus("unsubscribed");
      toast.message("Đã tắt thông báo.");
    } finally {
      setPushBusy(false);
    }
  };

  // Lịch sử hoạt động của SV
  const myHistory = useQuery(
    api.responses.getMyHistoryInSession,
    session?._id && identity?.studentCode
      ? { sessionId: session._id, studentCode: identity.studentCode }
      : "skip"
  );


  // Tính hạng cá nhân + stat tốc độ
  let myRank = -1;
  let myScore = 0;
  let myAvgMs: number | null = null;

  type LeaderboardEntry = {
    studentCode: string;
    fullName: string;
    score: number;
    avgResponseMs: number | null;
    answeredCount?: number;
  };
  const rankData = myRankData as {
    leaderboard?: LeaderboardEntry[];
    totalParticipants?: number;
    participantsWithScore?: number;
  } | undefined;
  if (identity && rankData?.leaderboard) {
    const foundIndex = rankData.leaderboard.findIndex(
      (s) => s.studentCode === identity.studentCode
    );
    if (foundIndex >= 0) {
      myRank = foundIndex;
      myScore = rankData.leaderboard[foundIndex].score;
      myAvgMs = rankData.leaderboard[foundIndex].avgResponseMs;
    }
  }

  // Format thời gian ms cho hiển thị
  const formatTimeMs = (ms: number | null) => {
    if (ms === null || ms === undefined) return "—";
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}p${Math.round(s % 60).toString().padStart(2, "0")}`;
  };

  // Timer đếm ngược
  useEffect(() => {
    if (!activeActivity?.timeLimit || !activeActivity?.startedAt) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = (Date.now() - activeActivity.startedAt!) / 1000 / 60;
      const remaining = Math.max(0, activeActivity.timeLimit! - elapsed);
      setTimeLeft(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeActivity?.startedAt, activeActivity?.timeLimit]);

  // Reset vote state khi hoạt động thay đổi HOẶC khi giảng viên chạy lại (startedAt mới)
  useEffect(() => {
    setSelectedOptions([]);
    setWordcloudInput("");
    setQaQuestionInput("");
    setSubmitError("");
    // hasSubmitted sẽ set lại từ myResponse trong effect khác
  }, [activeActivity?._id, activeActivity?.startedAt]);

  // Sync hasSubmitted với câu trả lời đã có trên server
  // → SV reload trang vẫn thấy "đã trả lời" + chống submit lại
  useEffect(() => {
    if (myResponse && myResponse.status === "answered") {
      setHasSubmitted(true);
      // Khôi phục selection cũ để hiển thị "bạn đã chọn gì"
      const val = myResponse.value;
      if (activeActivity?.type === "poll") {
        const choiceIds = (val as { choiceIds?: string[] })?.choiceIds;
        if (choiceIds) setSelectedOptions(choiceIds);
      } else if (activeActivity?.type === "rating") {
        const r = (val as { rating?: number })?.rating;
        if (r !== undefined) setSelectedOptions([String(r)]);
      } else if (activeActivity?.type === "wordcloud" || activeActivity?.type === "opentext") {
        if (typeof val === "string") setWordcloudInput(val);
      } else if (activeActivity?.type === "qa") {
        const text = (val as { text?: string })?.text || (typeof val === "string" ? val : "");
        if (text) setQaQuestionInput(text);
      }
    } else {
      setHasSubmitted(false);
    }
  }, [myResponse, activeActivity?._id, activeActivity?.type, activeActivity?.startedAt]);

  // Luôn thu thập danh tính khi vào phòng (để liên thông với danh sách sinh viên của giảng viên)
  // Chỉ cần nhập 1 lần / phòng (dựa vào localStorage)
  const needsIdentity = !identity;

  // Lưu danh tính
  const saveIdentity = async () => {
    if (!upperCode) return;
    // Khớp danh sách lớp (rosterMatch) → họ tên/lớp lấy tự động, không cần khai.
    if (accessMode === "roster" && !studentCodeInput.trim()) {
      toast.error("Vui lòng nhập mã sinh viên");
      return;
    }
    if (showNameFields && !rosterMatch && !fullNameInput.trim()) {
      toast.error("Vui lòng nhập họ và tên");
      return;
    }
    if (requireClass && !rosterMatch && !classNameInput.trim()) {
      toast.error("Vui lòng nhập lớp");
      return;
    }

    try {
      // Gọi join để tạo participant + (nếu là SV chính thức) auto-compute điểm danh.
      // MSV khớp danh sách → backend tự lookup họ tên/lớp. Khách → ghi nhận không điểm danh.
      const result = await joinSession({
        code: upperCode,
        studentCode: studentCodeInput.trim() || undefined,
        fullName: showNameFields ? fullNameInput.trim() || undefined : undefined,
        className: showNameFields ? classNameInput.trim() || undefined : undefined,
        deviceId: getOrCreateDeviceId(),
      });

      // Backend trả studentCode (đã resolve — khách không có MSV nhận guest_<device>)
      // + fullName/className (từ roster nếu khớp).
      const newIdentity: StudentIdentity = {
        studentCode: result.studentCode ?? studentCodeInput.trim(),
        fullName: result.fullName ?? fullNameInput.trim(),
        className: result.className ?? classNameInput.trim(),
      };

      localStorage.setItem(`student_${upperCode}`, JSON.stringify(newIdentity));
      // Lưu global để nhớ qua các phòng khác
      localStorage.setItem("student_identity_global", JSON.stringify(newIdentity));
      // Lưu mã phòng vào gần nhất — dùng để fallback nếu QR cắt query
      localStorage.setItem("last_joined_code", upperCode);
      setIdentity(newIdentity);
      setShowIdentityForm(false);
      setStudentCodeInput("");
      setFullNameInput("");
      setClassNameInput("");

      // Feedback với attendance status
      if (result?.attendanceStatus === "late") {
        const lateBy = result.lateBySeconds ?? 0;
        const lateMinutes = Math.floor(lateBy / 60);
        toast.warning(
          `✓ Điểm danh: Đi muộn (trễ ${lateMinutes}p${lateBy % 60}s)`,
          { duration: 6000 }
        );
      } else if (result?.attendanceStatus === "present") {
        toast.success("✓ Điểm danh: Có mặt đúng giờ", { duration: 4000 });
      } else {
        toast.success("Đã ghi nhận thông tin.", { duration: 4000 });
      }
    } catch (err: unknown) {
      // ConvexError: message thật nằm ở `data`. Raw Error: ở `message`.
      const errObj = err as { data?: string; message?: string };
      const msg =
        (typeof errObj.data === "string" && errObj.data) ||
        (errObj.message && !errObj.message.includes("Server Error") ? errObj.message : null) ||
        "Không thể lưu thông tin. Vui lòng thử lại.";
      toast.error(msg);
    }
  };

  // Chọn / bỏ chọn option (hỗ trợ single và multiple)
  const toggleOption = (optionId: string) => {
    if (!activeActivity) return;

    const pollType = activeActivity.config?.pollType || "single_choice";

    if (pollType === "single_choice") {
      setSelectedOptions([optionId]);
    } else {
      if (selectedOptions.includes(optionId)) {
        setSelectedOptions(selectedOptions.filter((id) => id !== optionId));
      } else {
        setSelectedOptions([...selectedOptions, optionId]);
      }
    }
  };

  // Gửi câu trả lời
  const handleSubmit = async () => {
    if (!activeActivity) return;

    if (!identity) {
      setShowIdentityForm(true);
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      // Board dùng mutation riêng (hỗ trợ cột + ảnh)
      if (activeActivity.type === "board") {
        if (!boardContentInput.trim() && !boardSelectedImage) {
          setSubmitError("Vui lòng nhập nội dung hoặc chọn ảnh");
          setIsSubmitting(false);
          return;
        }
        if (!boardSelectedColumn) {
          setSubmitError("Vui lòng chọn cột để đăng");
          setIsSubmitting(false);
          return;
        }

        let imageStorageId: string | undefined = undefined;

        // Nếu có ảnh → upload trước
        if (boardSelectedImage) {
          setIsUploadingImage(true);
          try {
            const uploadUrl = await generateUploadUrl();
            const result = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": boardSelectedImage.type },
              body: boardSelectedImage,
            });
            if (!result.ok) throw new Error("Upload ảnh thất bại");
            const { storageId } = await result.json();
            imageStorageId = storageId;
          } catch (uploadErr) {
            setSubmitError("Không thể upload ảnh. Vui lòng thử lại.");
            setIsUploadingImage(false);
            setIsSubmitting(false);
            return;
          }
          setIsUploadingImage(false);
        }

        await createBoardPost({
          activityId: activeActivity._id,
          content: boardContentInput.trim() || "",
          columnId: boardSelectedColumn,
          imageStorageId: imageStorageId as any,
          studentCode: identity?.studentCode,
          deviceId: getOrCreateDeviceId(),
        });

        // Reset form board (cho phép đăng tiếp)
        setBoardContentInput("");
        setBoardSelectedColumn("");
        setBoardSelectedImage(null);
        setBoardImagePreview(null);
        setSubmitError("");
        return;
      }

      // Các loại khác dùng submitResponse chung
      if (selectedOptions.length === 0 && !wordcloudInput.trim() && !qaQuestionInput.trim()) {
        setIsSubmitting(false);
        return;
      }

      let value: any;

      if (activeActivity.type === "wordcloud" || activeActivity.type === "opentext") {
        value = wordcloudInput.trim();
      } else if (activeActivity.type === "rating") {
        // Backend mong { rating: number }
        value = { rating: parseInt(selectedOptions[0]) };
      } else if (activeActivity.type === "qa") {
        value = { text: qaQuestionInput.trim(), upvotes: 0, status: "visible" };
      } else {
        // Poll: Backend mong { choiceIds: string[] }
        value = { choiceIds: selectedOptions };
      }

      await submitResponse({
        activityId: activeActivity._id,
        studentCode: identity?.studentCode,
        value,
        deviceId: getOrCreateDeviceId(),
      });

      setHasSubmitted(true);
    } catch (err: any) {
      setSubmitError(err.message || "Gửi thất bại");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format thời gian còn lại
  const formatTimeLeft = (minutes: number) => {
    const mins = Math.floor(minutes);
    const secs = Math.floor((minutes - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Xử lý chọn ảnh cho Board
  const handleBoardImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Giới hạn 5MB
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError("Ảnh quá lớn (tối đa 5MB)");
      return;
    }

    setBoardSelectedImage(file);
    const previewUrl = URL.createObjectURL(file);
    setBoardImagePreview(previewUrl);
    setSubmitError("");
  };

  const removeBoardImage = () => {
    if (boardImagePreview) {
      URL.revokeObjectURL(boardImagePreview);
    }
    setBoardSelectedImage(null);
    setBoardImagePreview(null);
  };

  const options: Array<{ id: string; text: string }> = activeActivity?.config?.options || [];

  // Quiz mode: kiểm tra đúng/sai cho Poll khi đã submit
  const isQuiz: boolean = !!(
    activeActivity?.type === "poll" &&
    activeActivity.config?.isQuiz &&
    Array.isArray(activeActivity.config?.correctOptionIds)
  );
  const correctIds: string[] = isQuiz ? (activeActivity!.config.correctOptionIds as string[]) : [];
  let isCorrect: boolean | null = null;
  if (isQuiz && hasSubmitted) {
    const chosen: string[] =
      activeActivity!.config?.pollType === "multiple_choice"
        ? selectedOptions
        : [selectedOptions[0]].filter(Boolean);
    const chosenSet = new Set(chosen);
    const correctSet = new Set(correctIds);
    isCorrect =
      chosenSet.size === correctSet.size && [...chosenSet].every((id) => correctSet.has(id));
  }

  // ==================== RENDER ====================

  // Splash hiển thị tên SV ngay từ URL params (LMS deep link) để user
  // biết hệ thống đang xử lý — KHÔNG đợi Convex load.
  if (session === undefined) {
    let lmsName: string | null = null;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("from_lms") === "1") {
        lmsName = params.get("name");
      }
    }
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-zinc-50 to-zinc-50 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center text-white font-bold text-xl shadow-lg">
            PT
          </div>
          {lmsName && (
            <div className="text-2xl font-semibold text-zinc-800">
              👋 Chào {lmsName}
            </div>
          )}
          <div className="flex items-center justify-center gap-2 text-zinc-500">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm">Đang kết nối phòng giảng...</span>
          </div>
          <div className="text-xs text-zinc-400 font-mono">
            Phòng: {upperCode}
          </div>
        </div>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-md">
          <div className="text-4xl">😕</div>
          <div className="text-lg font-medium text-zinc-800">
            Không tìm thấy phòng <span className="font-mono">{upperCode}</span>
          </div>
          <div className="text-sm text-zinc-500">
            Mã phòng có thể đã kết thúc hoặc bạn nhập sai. Vui lòng kiểm tra lại với giảng viên.
          </div>
          <Link
            href="/join"
            className="inline-block mt-4 px-5 py-2 rounded-xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800"
          >
            Nhập mã khác
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-12">
      {/* Thanh thả cảm xúc (emoji bay lên màn chiếu của GV) — ẩn nếu GV tắt reactions */}
      {session.reactionsEnabled !== false && <ReactionBar sessionId={session._id} />}

      {/* Header đơn giản */}
      <div className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo size="sm" showText={false} href="/" />
            <div className="min-w-0">
              <div className="text-[10px] text-zinc-500 tracking-wider">PHÒNG</div>
              <div className="font-mono text-xl tracking-[3px] font-semibold text-zinc-900 leading-none">
                {session.code}
              </div>
            </div>
          </div>
          <div className="text-right min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-700 truncate" title={session.title}>{session.title}</div>
            {session.hostName && (
              <div className="text-xs text-emerald-700 truncate" title={session.hostName}>
                👨‍🏫 {session.hostName}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-8">

        {/* Banner xác nhận danh tính cho sinh viên */}
        {identity && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="text-emerald-600 text-lg leading-none mt-0.5">✓</div>
            <div className="text-sm text-emerald-800 flex-1 min-w-0">
              <span className="font-medium">{identity.fullName}</span>
              {/* Ẩn mã khách (guest_dev_...) — chỉ hiện MSV thật cho gọn */}
              {identity.studentCode && !identity.studentCode.startsWith("guest_") && (
                <span className="text-emerald-700"> · {identity.studentCode}</span>
              )}
              {identity.className && identity.className !== "—" && (
                <span className="text-emerald-600"> · {identity.className}</span>
              )}
              <div className="text-[11px] text-emerald-700/80 mt-0.5">
                ✓ Thiết bị đã đăng ký trong buổi này
              </div>
            </div>
          </div>
        )}

        {/* Banner bật thông báo Web Push (chỉ khi support, có identity, chưa subscribed, chưa dismiss) */}
        {identity &&
          !pushDismissed &&
          (pushStatus === "default" || pushStatus === "unsubscribed") && (
            <div className="mb-4 bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-start gap-3">
              <div className="text-2xl shrink-0">🔔</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-sky-900">
                  Bật thông báo để không bỏ lỡ hoạt động
                </div>
                <div className="text-xs text-sky-700 mt-0.5">
                  Điện thoại sẽ rung khi giảng viên kích hoạt câu hỏi mới — dù bạn không mở app.
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleEnablePush}
                    disabled={pushBusy}
                    className="px-3 py-1 text-xs rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium disabled:opacity-60"
                  >
                    {pushBusy ? "Đang bật..." : "Bật thông báo"}
                  </button>
                  <button
                    onClick={() => setPushDismissed(true)}
                    className="px-3 py-1 text-xs rounded-md text-sky-700 hover:bg-sky-100"
                  >
                    Để sau
                  </button>
                </div>
              </div>
            </div>
          )}

        {identity && pushStatus === "denied" && !pushDismissed && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
            <div>⚠</div>
            <div className="flex-1">
              Trình duyệt đang chặn thông báo cho trang này. Mở phần Cài đặt
              site để cho phép thông báo nếu bạn muốn nhận cảnh báo hoạt động.
            </div>
            <button
              onClick={() => setPushDismissed(true)}
              className="text-amber-700 hover:text-amber-900"
            >
              ✕
            </button>
          </div>
        )}

        {/* Auto-join splash khi vào từ LMS deep link — ẩn form, hiện loading */}
        {!identity && autoJoining && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-8 text-center space-y-3">
            <div className="text-5xl animate-pulse">📡</div>
            <div className="font-semibold text-zinc-900">Đang vào phòng...</div>
            <div className="text-sm text-zinc-500">
              Đăng nhập tự động từ LMS · MSV {studentCodeInput || "..."}
            </div>
            <button
              onClick={() => setAutoJoining(false)}
              className="mt-4 text-sm text-emerald-700 hover:text-emerald-900 underline underline-offset-4"
            >
              Bỏ qua, nhập thủ công →
            </button>
          </div>
        )}

        {/* Chưa có hoạt động — nếu chưa đăng ký identity, cho SV đăng ký trước */}
        {!activeActivity && !identity && !autoJoining && (
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="text-3xl">👋</div>
              <div>
                <div className="font-semibold text-zinc-900">Chào mừng đến với buổi giảng</div>
                <p className="text-sm text-zinc-600 mt-0.5">
                  {accessMode === "roster"
                    ? `Buổi học theo danh sách lớp${joinCtx?.className ? ` · Lớp ${joinCtx.className}` : ""}. Chỉ cần nhập mã sinh viên.`
                    : accessMode === "public"
                      ? "Buổi học quảng bá — chỉ cần nhập họ tên để vào học."
                      : "Vui lòng đăng ký thông tin để tham gia. Mã sinh viên nếu có."}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <VnInput
                type="text"
                placeholder={accessMode === "roster" ? "Mã sinh viên (VD: 2351150001)" : "Mã sinh viên (nếu có)"}
                value={studentCodeInput}
                onValueChange={(v) => setStudentCodeInput(v.toUpperCase())}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white font-mono"
              />
              {rosterMatch && (
                <p className="text-xs text-emerald-700">
                  ✓ {rosterMatch.fullName}
                  {joinCtx?.className ? ` — Lớp ${joinCtx.className}` : ""}
                </p>
              )}
              {showNameFields && !rosterMatch && (
                <>
                  <VnInput
                    type="text"
                    placeholder="Họ và tên (VD: Trần Văn An)"
                    value={fullNameInput}
                    onValueChange={setFullNameInput}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white"
                  />
                  <VnInput
                    type="text"
                    placeholder={requireClass ? "Lớp (VD: 65C)" : "Lớp (nếu có)"}
                    value={classNameInput}
                    onValueChange={setClassNameInput}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white"
                  />
                </>
              )}
              <button
                onClick={saveIdentity}
                disabled={
                  (accessMode === "roster" && !studentCodeInput.trim()) ||
                  (showNameFields && !rosterMatch && !fullNameInput.trim()) ||
                  (requireClass && !rosterMatch && !classNameInput.trim())
                }
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
              >
                Đăng ký tham gia
              </button>
              {accessMode === "roster" && (
                <p className="text-[11px] text-center text-zinc-500">
                  Họ tên và lớp lấy tự động từ danh sách lớp
                </p>
              )}
            </div>
          </div>
        )}

        {/* Đã vào phòng — chờ hoạt động. App realtime (Convex) nên tự cập nhật,
            KHÔNG cần bấm gì. Thay nút "Làm mới" gây hiểu nhầm bằng chỉ báo kết nối
            trực tiếp + gộp gọn thành tích cá nhân vào đây. */}
        {!activeActivity && identity && (
          <div className="space-y-4">
            <div className="bg-white border border-zinc-200 rounded-3xl px-6 py-8 text-center overflow-hidden">
              {/* Sóng radar — đang "lắng nghe" giảng viên (Tailwind animate-ping) */}
              <div className="relative mx-auto w-20 h-20 mb-5">
                <span className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" />
                <span
                  className="absolute inset-2 rounded-full bg-emerald-400/25 animate-ping"
                  style={{ animationDelay: "0.7s" }}
                />
                <div className="absolute inset-3 rounded-full bg-emerald-100 flex items-center justify-center">
                  <span className="text-3xl">📡</span>
                </div>
              </div>

              <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
                Bạn đã vào phòng 👋
              </h1>
              <div className="inline-flex items-center gap-2 text-sm text-emerald-700 mb-3">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Kết nối trực tiếp · tự động cập nhật
              </div>
              <p className="text-zinc-600 text-sm max-w-xs mx-auto leading-relaxed">
                Hoạt động sẽ <span className="font-medium text-zinc-900">tự hiện ngay</span> khi
                giảng viên bắt đầu. Bạn không cần bấm gì cả — cứ để máy ở đây.
              </p>

              {/* Thành tích cá nhân — gộp gọn vào thẻ kết nối */}
              {myRank >= 0 && myScore > 0 && (
                <div className="mt-6 pt-6 border-t border-zinc-100">
                  <div className="flex gap-2">
                    <div className="flex-1 bg-zinc-50 rounded-2xl py-3">
                      <div className="text-[11px] text-zinc-500">Hạng</div>
                      <div className="text-xl font-semibold text-zinc-900">
                        {myRank === 0 ? "🥇" : myRank === 1 ? "🥈" : myRank === 2 ? "🥉" : ""}#{myRank + 1}
                      </div>
                    </div>
                    <div className="flex-1 bg-zinc-50 rounded-2xl py-3">
                      <div className="text-[11px] text-zinc-500">Điểm</div>
                      <div className="text-xl font-semibold text-emerald-700">{myScore}</div>
                    </div>
                    {myAvgMs !== null && (
                      <div className="flex-1 bg-zinc-50 rounded-2xl py-3">
                        <div className="text-[11px] text-zinc-500">Tốc độ TB</div>
                        <div className="text-xl font-semibold text-zinc-900">⚡{formatTimeMs(myAvgMs)}</div>
                      </div>
                    )}
                  </div>

                  {rankData?.leaderboard && rankData.leaderboard.length > 0 && (
                    <div className="mt-3 text-left">
                      <div className="text-[10px] tracking-wider text-zinc-400 font-medium mb-1.5 text-center">
                        TOP 3 THAM GIA
                      </div>
                      <div className="space-y-1">
                        {rankData.leaderboard.slice(0, 3).map((entry, idx) => {
                          const isMe = entry.studentCode === identity.studentCode;
                          const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                          return (
                            <div
                              key={entry.studentCode}
                              className={`flex items-center gap-2 text-sm py-1 px-2 rounded-lg ${isMe ? "bg-emerald-50 border border-emerald-200" : ""}`}
                            >
                              <span>{medal}</span>
                              <span className={`flex-1 truncate ${isMe ? "text-emerald-900 font-medium" : "text-zinc-700"}`}>
                                {entry.fullName}{isMe && " (bạn)"}
                              </span>
                              <span className="font-mono text-emerald-700 text-xs shrink-0">{entry.score}đ</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <Link
                    href={`/me?code=${encodeURIComponent(identity.studentCode)}`}
                    className="inline-block mt-3 text-xs text-emerald-700 hover:text-emerald-900 hover:underline underline-offset-2"
                  >
                    📊 Xem thành tích qua các buổi khác →
                  </Link>
                </div>
              )}
            </div>

            {/* Trang tự cập nhật — link tải lại an toàn, nói rõ KHÔNG mất dữ liệu */}
            <div className="text-center text-xs text-zinc-400">
              💾 Thông tin của bạn đã được lưu ·{" "}
              <button
                onClick={() => window.location.reload()}
                className="underline underline-offset-2 hover:text-zinc-600"
              >
                tải lại trang
              </button>
              <span className="text-zinc-300"> (không mất dữ liệu)</span>
            </div>
          </div>
        )}

        {/* Có hoạt động đang diễn ra */}
        {activeActivity && (
          <div className="space-y-6">
            {/* Tiêu đề hoạt động + Timer */}
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="uppercase tracking-widest text-xs font-medium text-emerald-600 mb-1">
                    HOẠT ĐỘNG ĐANG DIỄN RA
                  </div>
                  <h1 className="text-3xl font-semibold text-zinc-900 leading-tight">
                    {activeActivity.title}
                  </h1>
                </div>

                {timeLeft !== null && (
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-zinc-500">THỜI GIAN CÒN LẠI</div>
                    <div className="text-4xl font-mono font-semibold tabular-nums text-amber-600">
                      {formatTimeLeft(timeLeft)}
                    </div>
                  </div>
                )}
              </div>

              {activeActivity.config?.description && (
                <p className="mt-3 text-lg text-zinc-600">
                  {activeActivity.config.description}
                </p>
              )}
            </div>

            {/* Yêu cầu danh tính */}
            {!identity && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <div className="font-medium text-amber-800 mb-1">Hoạt động này cần ghi nhận điểm</div>
                <p className="text-sm text-amber-700 mb-4">
                  Vui lòng xác nhận thông tin của bạn để câu trả lời được lưu lại.
                </p>

                {!showIdentityForm ? (
                  <button
                    onClick={() => setShowIdentityForm(true)}
                    className="w-full py-3 rounded-xl bg-amber-600 text-white font-medium active:bg-amber-700"
                  >
                    Nhập thông tin sinh viên
                  </button>
                ) : (
                  <div className="space-y-3">
                    <VnInput
                      type="text"
                      placeholder={accessMode === "roster" ? "Mã sinh viên (VD: 2351150001)" : "Mã sinh viên (nếu có)"}
                      value={studentCodeInput}
                      onValueChange={(v) => setStudentCodeInput(v.toUpperCase())}
                      className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-white font-mono"
                    />
                    {rosterMatch && (
                      <p className="text-xs text-emerald-700">
                        ✓ {rosterMatch.fullName}
                        {joinCtx?.className ? ` — Lớp ${joinCtx.className}` : ""}
                      </p>
                    )}
                    {showNameFields && !rosterMatch && (
                      <>
                        <VnInput
                          type="text"
                          placeholder="Họ và tên (VD: Trần Văn An)"
                          value={fullNameInput}
                          onValueChange={setFullNameInput}
                          className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-white"
                        />
                        <VnInput
                          type="text"
                          placeholder={requireClass ? "Lớp (VD: 65C)" : "Lớp (nếu có)"}
                          value={classNameInput}
                          onValueChange={setClassNameInput}
                          className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-white"
                        />
                      </>
                    )}
                    <div className="flex gap-3 pt-1">
                      <button
                        onClick={() => setShowIdentityForm(false)}
                        className="flex-1 py-3 rounded-xl border border-amber-300 text-amber-700"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={saveIdentity}
                        className="flex-1 py-3 rounded-xl bg-amber-600 text-white font-medium"
                      >
                        Xác nhận
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Form trả lời - Poll */}
            {activeActivity.type === "poll" && !hasSubmitted && (
              <div className="bg-white border rounded-3xl p-6 shadow-sm">
                <div className="mb-3 text-xs">
                  {activeActivity.requiresStudentCode ? (
                    <span className="text-emerald-600">📋 Câu trả lời được ghi nhận để tính điểm tham gia.</span>
                  ) : (
                    <span className="text-zinc-500">🕶️ Khảo sát ẩn danh — không tính điểm cá nhân.</span>
                  )}
                </div>

                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="text-zinc-500">
                    {activeActivity.config?.pollType === "multiple_choice"
                      ? "Bạn có thể chọn nhiều đáp án"
                      : "Chọn một đáp án"}
                  </span>
                  {activeActivity.config?.pollType === "multiple_choice" && selectedOptions.length > 0 && (
                    <span className="font-mono text-emerald-600">
                      Đã chọn {selectedOptions.length}
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {options.map((opt: any) => {
                    const isSelected = selectedOptions.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(opt.id)}
                        disabled={isSubmitting || timeLeft === 0}
                        className={`w-full text-left px-5 py-4 rounded-2xl border text-base transition-all active:scale-[0.985] ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                            : "border-zinc-200 hover:border-zinc-300 active:bg-zinc-50"
                        }`}
                      >
                        {opt.text}
                      </button>
                    );
                  })}
                </div>

                {submitError && (
                  <div className="mt-4 text-sm text-red-600 bg-red-50 p-3 rounded-xl">
                    {submitError}
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={selectedOptions.length === 0 || isSubmitting || timeLeft === 0}
                  className="mt-6 w-full py-4 rounded-2xl bg-zinc-900 text-white text-lg font-medium disabled:opacity-50 active:bg-black transition-colors"
                >
                  {isSubmitting ? "Đang gửi..." : "Gửi câu trả lời"}
                </button>

                {timeLeft !== null && timeLeft <= 0 && (
                  <p className="text-center text-sm text-red-600 mt-3">Đã hết thời gian trả lời</p>
                )}
              </div>
            )}

            {/* Form trả lời - Word Cloud */}
            {activeActivity.type === "wordcloud" && !hasSubmitted && (
              <div className="bg-white border rounded-3xl p-6 shadow-sm">
                <div className="mb-4 text-sm text-zinc-500">
                  Nhập từ khóa hoặc ý kiến ngắn (tối đa 30 ký tự)
                </div>

                <div className="flex items-center gap-2">
                  <VnInput
                    type="text"
                    maxLength={30}
                    value={wordcloudInput}
                    onValueChange={setWordcloudInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && wordcloudInput.trim()) {
                        handleSubmit();
                      }
                    }}
                    placeholder="Ví dụ: cao trình đỉnh đập, dung tích hồ, mực nước chết..."
                    className="flex-1 px-5 py-4 rounded-2xl border border-zinc-200 text-lg focus:outline-none focus:border-emerald-500"
                    disabled={isSubmitting || timeLeft === 0}
                  />
                  <VoiceInputButton
                    onTranscript={(t) => setWordcloudInput(appendVoice(wordcloudInput, t).slice(0, 30))}
                  />
                </div>

                {submitError && (
                  <div className="mt-4 text-sm text-red-600 bg-red-50 p-3 rounded-xl">
                    {submitError}
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!wordcloudInput.trim() || isSubmitting || timeLeft === 0}
                  className="mt-4 w-full py-4 rounded-2xl bg-zinc-900 text-white text-lg font-medium disabled:opacity-50 active:bg-black transition-colors"
                >
                  {isSubmitting ? "Đang gửi..." : "Gửi từ khóa"}
                </button>

                {timeLeft !== null && timeLeft <= 0 && (
                  <p className="text-center text-sm text-red-600 mt-3">Đã hết thời gian</p>
                )}
              </div>
            )}

            {/* Form trả lời - Open Text */}
            {activeActivity.type === "opentext" && !hasSubmitted && (
              <div className="bg-white border rounded-3xl p-6 shadow-sm">
                <div className="mb-3 text-sm text-zinc-500">
                  Câu trả lời ngắn (tối đa 500 ký tự)
                </div>
                <div className="relative">
                  <VnTextarea
                    value={wordcloudInput}
                    onValueChange={setWordcloudInput}
                    maxLength={500}
                    rows={4}
                    placeholder="Nhập câu trả lời (hoặc bấm 🎤 để nói)..."
                    className="w-full px-5 py-3 pr-14 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 resize-y"
                    disabled={isSubmitting || timeLeft === 0}
                  />
                  <div className="absolute top-2 right-2">
                    <VoiceInputButton
                      size="sm"
                      onTranscript={(t) => setWordcloudInput(appendVoice(wordcloudInput, t).slice(0, 500))}
                    />
                  </div>
                </div>
                <div className="flex justify-end text-xs text-zinc-500 mt-1">
                  {wordcloudInput.length} / 500
                </div>

                {submitError && (
                  <div className="mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-xl">{submitError}</div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!wordcloudInput.trim() || isSubmitting || timeLeft === 0}
                  className="mt-3 w-full py-4 rounded-2xl bg-zinc-900 text-white text-lg font-medium disabled:opacity-50 active:bg-black transition-colors"
                >
                  {isSubmitting ? "Đang gửi..." : "Gửi câu trả lời"}
                </button>

                {timeLeft !== null && timeLeft <= 0 && (
                  <p className="text-center text-sm text-red-600 mt-3">Đã hết thời gian</p>
                )}
              </div>
            )}

            {/* Form trả lời - Rating / Thang điểm */}
            {activeActivity.type === "rating" && !hasSubmitted && (() => {
              const cfg = activeActivity.config || {};
              const min = cfg.min ?? 1;
              const max = cfg.max ?? 5;
              const pointLabels: Record<string, string> = cfg.pointLabels || {};

              const labelOf = (point: number) => {
                if (pointLabels[String(point)]) return pointLabels[String(point)];
                if (point === min && cfg.minLabel) return cfg.minLabel;
                if (point === max && cfg.maxLabel) return cfg.maxLabel;
                return "";
              };

              const hasAnyDetailedLabel =
                Object.keys(pointLabels).length > 0 ||
                Array.from({ length: max - min + 1 }, (_, i) => labelOf(min + i)).some((l) => l);

              return (
                <div className="bg-white border rounded-3xl p-6 shadow-sm">
                  {/* Header tiêu đề thang điểm */}
                  {(cfg.minLabel || cfg.maxLabel) && (
                    <div className="mb-4 flex items-center justify-between text-xs text-zinc-500">
                      <span>{min}: {cfg.minLabel || "—"}</span>
                      <span>{max}: {cfg.maxLabel || "—"}</span>
                    </div>
                  )}

                  {hasAnyDetailedLabel ? (
                    // ===== VERTICAL: nhãn từng điểm rõ ràng =====
                    <div className="space-y-2">
                      {Array.from({ length: max - min + 1 }, (_, i) => {
                        const value = min + i;
                        const label = labelOf(value);
                        const selected = selectedOptions[0] === value.toString();
                        return (
                          <button
                            key={value}
                            onClick={() => setSelectedOptions([value.toString()])}
                            className={`w-full px-4 py-3 rounded-2xl border flex items-center gap-3 text-left transition-all ${
                              selected
                                ? "bg-emerald-50 border-emerald-500 text-emerald-900 shadow"
                                : "bg-white border-zinc-200 hover:border-zinc-400 active:bg-zinc-50"
                            }`}
                          >
                            <span className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shrink-0 ${
                              selected ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-700"
                            }`}>
                              {value}
                            </span>
                            <span className="flex-1 text-base font-medium">
                              {label || `Mức ${value}`}
                            </span>
                            {selected && <span className="text-emerald-600 text-xl shrink-0">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    // ===== HORIZONTAL: chỉ số (không có nhãn) — compact =====
                    <div className="flex justify-between gap-2">
                      {Array.from({ length: max - min + 1 }, (_, i) => {
                        const value = min + i;
                        return (
                          <button
                            key={value}
                            onClick={() => setSelectedOptions([value.toString()])}
                            className={`flex-1 py-4 rounded-2xl border text-lg font-semibold transition-all ${
                              selectedOptions[0] === value.toString()
                                ? "bg-emerald-600 border-emerald-500 text-white"
                                : "bg-zinc-50 border-zinc-200 hover:border-zinc-400 active:bg-zinc-100"
                            }`}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {submitError && (
                    <div className="mt-4 text-sm text-red-600 bg-red-50 p-3 rounded-xl">{submitError}</div>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={selectedOptions.length === 0 || isSubmitting || timeLeft === 0}
                    className="mt-6 w-full py-4 rounded-2xl bg-zinc-900 text-white text-lg font-medium disabled:opacity-50 active:bg-black transition-colors"
                  >
                    {isSubmitting ? "Đang gửi..." : "Gửi đánh giá"}
                  </button>
                </div>
              );
            })()}

            {/* Q&A - Gửi câu hỏi + Danh sách câu hỏi */}
            {activeActivity.type === "qa" && (
              <div className="bg-white border rounded-3xl p-6 shadow-sm space-y-6">
                {/* Form gửi câu hỏi */}
                {!hasSubmitted && (
                  <>
                    <div>
                      <div className="mb-2 text-sm text-zinc-500">Bạn có câu hỏi gì?</div>
                      <div className="relative">
                        <VnTextarea
                          value={qaQuestionInput}
                          onValueChange={setQaQuestionInput}
                          placeholder="Nhập câu hỏi (hoặc bấm 🎤 để nói)..."
                          rows={2}
                          className="w-full px-4 py-3 pr-12 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 resize-y"
                          disabled={isSubmitting || timeLeft === 0}
                        />
                        <div className="absolute top-2 right-2">
                          <VoiceInputButton
                            size="sm"
                            onTranscript={(t) => setQaQuestionInput(appendVoice(qaQuestionInput, t))}
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleSubmit}
                      disabled={!qaQuestionInput.trim() || isSubmitting || timeLeft === 0}
                      className="w-full py-3.5 rounded-2xl bg-zinc-900 text-white font-medium disabled:opacity-50 active:bg-black transition-colors"
                    >
                      {isSubmitting ? "Đang gửi..." : "Gửi câu hỏi"}
                    </button>
                  </>
                )}

                {/* Danh sách câu hỏi */}
                {qaQuestions && qaQuestions.length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-zinc-700 mb-3">Câu hỏi từ cả lớp</div>
                    <div className="space-y-3 max-h-[260px] overflow-auto pr-1">
                      {qaQuestions
                        .filter((q: any) => {
                          const val = q.value;
                          if (typeof val === "object" && val !== null) {
                            return val.status !== "hidden";
                          }
                          return true;
                        })
                        .sort((a: any, b: any) => {
                          const aVal = typeof a.value === "object" ? a.value : {};
                          const bVal = typeof b.value === "object" ? b.value : {};
                          const aUp = aVal.upvotes || 0;
                          const bUp = bVal.upvotes || 0;
                          const aAnswered = aVal.status === "answered";
                          const bAnswered = bVal.status === "answered";

                          // Answered questions go lower
                          if (aAnswered && !bAnswered) return 1;
                          if (!aAnswered && bAnswered) return -1;

                          // Then sort by upvotes desc
                          if (bUp !== aUp) return bUp - aUp;

                          // Finally by time (newer first)
                          return (b.submittedAt || 0) - (a.submittedAt || 0);
                        })
                        .map((q: any, idx: number) => {
                          const val = typeof q.value === "object" ? q.value : { text: q.value };
                          const questionText = val.text || q.value;
                          const upvotes = val.upvotes || 0;
                          const isAnswered = val.status === "answered";
                          const answer = val.answer;

                          return (
                            <div 
                              key={idx} 
                              className={`bg-zinc-50 border rounded-2xl p-4 transition-all ${
                                isAnswered 
                                  ? "border-emerald-200 bg-emerald-50/50" 
                                  : "border-zinc-200"
                              }`}
                            >
                              <div className="flex justify-between items-start gap-3">
                                <div className="flex-1">
                                  <div className="text-sm text-zinc-800">{questionText}</div>
                                </div>
                                <button
                                  onClick={() => upvoteQuestion({ responseId: q._id })}
                                  className="flex flex-col items-center text-xs text-emerald-600 hover:text-emerald-700 active:scale-95 transition-all shrink-0"
                                >
                                  <span>▲</span>
                                  <span className="font-mono">{upvotes}</span>
                                </button>
                              </div>

                              {isAnswered && (
                                <div className="mt-1.5 inline-flex items-center text-[10px] font-medium text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                                  Đã trả lời
                                </div>
                              )}

                              {answer && (
                                <div className="mt-3 pt-3 border-t border-emerald-200">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <div className="text-[10px] font-bold tracking-[0.5px] text-emerald-700">GIẢNG VIÊN TRẢ LỜI</div>
                                    <div className="h-px flex-1 bg-emerald-200" />
                                  </div>
                                  <div className="text-[13.5px] leading-snug text-emerald-900 whitespace-pre-wrap">
                                    {answer}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {submitError && (
                  <div className="text-sm text-red-600">{submitError}</div>
                )}
              </div>
            )}

            {/* Feedback sau khi tham gia - Tối ưu trải nghiệm sinh viên */}
            {hasSubmitted && activeActivity?.type !== "board" && (
              <div className={`border rounded-3xl p-8 text-center ${
                isQuiz
                  ? isCorrect
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-red-50 border-red-200"
                  : "bg-emerald-50 border-emerald-200"
              }`}>
                <div className="text-5xl mb-4">
                  {isQuiz ? (isCorrect ? "🎉" : "❌") : "✅"}
                </div>
                <div className={`text-2xl font-semibold mb-2 ${
                  isQuiz ? (isCorrect ? "text-emerald-800" : "text-red-700") : "text-emerald-800"
                }`}>
                  {isQuiz
                    ? (isCorrect ? "Chính xác! 🎉" : "Chưa đúng")
                    : "Đã ghi nhận!"}
                </div>
                <p className={isQuiz ? (isCorrect ? "text-emerald-700" : "text-red-600") : "text-emerald-700"}>
                  {isQuiz
                    ? (isCorrect ? "Bạn đã chọn đúng đáp án." : "Đáp án đúng được đánh dấu bên dưới.")
                    : activeActivity.requiresStudentCode
                      ? "Cảm ơn bạn đã trả lời. Câu trả lời được ghi nhận để tính điểm tham gia."
                      : "Cảm ơn bạn đã trả lời. Hoạt động này là khảo sát ẩn danh, không tính điểm."}
                </p>

                {/* Quiz: hiển thị đáp án đúng */}
                {isQuiz && (
                  <div className="mt-6 pt-6 border-t border-zinc-200 text-left">
                    <div className="text-sm font-medium text-zinc-700 mb-3">Đáp án đúng:</div>
                    {(activeActivity.config?.options || []).filter((opt: any) => correctIds.includes(opt.id)).map((opt: any) => (
                      <div key={opt.id} className="px-3 py-2 mb-2 bg-emerald-100 border border-emerald-300 rounded-lg text-emerald-900 text-sm font-medium">
                        ✓ {opt.text}
                      </div>
                    ))}
                  </div>
                )}

                {activeActivity.type === "poll" && !isQuiz && (
                  <div className="mt-4 text-xs text-emerald-700">
                    Kết quả sẽ được giảng viên công bố trên màn hình chiếu.
                  </div>
                )}

                {activeActivity.type === "wordcloud" && (
                  <p className="mt-4 text-sm text-emerald-600">Từ khóa của bạn đã được ghi nhận và góp phần tạo nên đám mây từ.</p>
                )}

                {activeActivity.type === "qa" && (
                  <p className="mt-4 text-sm text-emerald-600">Câu hỏi của bạn đã được gửi. Giảng viên sẽ xem và trả lời sớm nhất có thể.</p>
                )}
              </div>
            )}

            {/* === BOARD EXPERIENCE (Sinh viên) — Render OUTSIDE feedback block === */}
            {activeActivity.type === "board" && (
              <>
                {/* Yêu cầu danh tính nếu chưa có */}
                {!identity && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 text-sm text-amber-800">
                    Vui lòng nhập thông tin sinh viên ở phía trên để tham gia.
                  </div>
                )}

                {identity && (<>
                    {/* Form đăng bài - chỉ hiện khi còn active */}
                    {activeActivity.status === "active" && (
                      <div className="bg-white border rounded-3xl p-6 shadow-sm space-y-4 mb-6">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-zinc-700">Đăng ghi chú mới</div>
                          {boardPosts && boardPosts.length > 0 && (
                            <div className="text-xs text-emerald-600">{boardPosts.length} bài trên bảng</div>
                          )}
                        </div>

                        {/* Feedback cá nhân cho sinh viên - giúp họ thấy đóng góp của mình được ghi nhận */}
                        {identity && boardPosts && (
                          <div className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg inline-block">
                            Bạn đã đăng {boardPosts.filter((p: any) => p.studentCode === identity.studentCode).length} bài trong buổi này
                          </div>
                        )}

                        {/* Chọn cột */}
                        <div className="flex flex-wrap gap-2">
                          {((activeActivity as any).config?.columns || []).map((col: any) => (
                            <button
                              key={col.id}
                              onClick={() => setBoardSelectedColumn(col.id)}
                              className={`px-4 py-1.5 rounded-full text-sm border transition-all active:scale-[0.985] ${
                                boardSelectedColumn === col.id
                                  ? "bg-emerald-600 text-white border-emerald-600"
                                  : "border-zinc-300 hover:bg-zinc-100 text-zinc-700"
                              }`}
                            >
                              {col.title}
                            </button>
                          ))}
                        </div>

                        <div className="relative">
                          <VnTextarea
                            value={boardContentInput}
                            onValueChange={setBoardContentInput}
                            placeholder="Viết ý tưởng, nhận xét, câu hỏi... (có thể đăng nhiều lần — hoặc bấm 🎤 để nói)"
                            rows={2}
                            className="w-full px-4 py-3 pr-12 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 resize-y"
                            disabled={isSubmitting || timeLeft === 0 || isUploadingImage}
                          />
                          <div className="absolute top-2 right-2">
                            <VoiceInputButton
                              size="sm"
                              onTranscript={(t) => setBoardContentInput(appendVoice(boardContentInput, t))}
                            />
                          </div>
                        </div>

                        {/* Ảnh đính kèm */}
                        <div>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleBoardImageSelect}
                            className="hidden"
                            id="board-image-upload"
                            disabled={isSubmitting || isUploadingImage}
                          />
                          <div className="flex items-center gap-3">
                            <label
                              htmlFor="board-image-upload"
                              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-300 text-sm hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50"
                            >
                              📷 Thêm ảnh
                            </label>
                            {boardImagePreview && (
                              <button
                                type="button"
                                onClick={removeBoardImage}
                                className="text-xs px-3 py-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                              >
                                Xóa ảnh
                              </button>
                            )}
                          </div>

                          {/* Preview ảnh */}
                          {boardImagePreview && (
                            <div className="mt-3 relative inline-block">
                              <img
                                src={boardImagePreview}
                                alt="Preview"
                                className="max-h-40 rounded-2xl border border-zinc-200 object-contain"
                              />
                            </div>
                          )}
                        </div>

                        <button
                          onClick={handleSubmit}
                          disabled={
                            (!boardContentInput.trim() && !boardSelectedImage) ||
                            !boardSelectedColumn ||
                            isSubmitting ||
                            timeLeft === 0 ||
                            isUploadingImage
                          }
                          className="w-full py-3 rounded-2xl bg-zinc-900 text-white font-medium disabled:opacity-50 active:bg-black transition-colors"
                        >
                          {isUploadingImage
                            ? "Đang tải ảnh..."
                            : isSubmitting
                            ? "Đang đăng..."
                            : "Đăng lên bảng"}
                        </button>

                        {submitError && <div className="text-sm text-red-600">{submitError}</div>}
                      </div>
                    )}

                    {/* BẢNG HIỆN TẠI / KẾT QUẢ - Luôn hiển thị cho board (kể cả khi đã đóng) */}
                    {boardPosts && boardPosts.length > 0 ? (
                      <div className="space-y-3">
                        <div className="text-sm font-medium text-zinc-700 px-1">
                          {activeActivity.status === "active" ? "Bảng hiện tại" : "Kết quả bảng"}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {((activeActivity as any).config?.columns || []).map((col: any) => {
                            const postsInColumn = boardPosts
                              .filter((p: any) => p.columnId === col.id)
                              .sort((a: any, b: any) => (b.likes || 0) - (a.likes || 0) || b.createdAt - a.createdAt);

                            return (
                              <div key={col.id} className="bg-white border border-zinc-200 rounded-3xl p-4 flex flex-col min-h-[240px]">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="font-semibold text-emerald-700 text-sm">{col.title}</div>
                                  <div className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                    {postsInColumn.length}
                                  </div>
                                </div>

                                <div className="space-y-2.5 flex-1 overflow-auto pr-1 -mr-1">
                                  {postsInColumn.length === 0 && (
                                    <div className="text-xs text-zinc-400 italic py-8 text-center">Chưa có bài nào</div>
                                  )}

                                  {postsInColumn.map((post: any) => {
                                    const isMine = identity && post.studentCode === identity.studentCode;
                                    return (
                                      <div 
                                        key={post._id} 
                                        className={`bg-zinc-50 border rounded-2xl p-3 text-sm transition-all ${isMine ? 'border-emerald-300 bg-emerald-50/60' : 'border-zinc-200'}`}
                                      >
                                        {post.imageUrl && (
                                          <img
                                            src={post.imageUrl}
                                            alt="Ảnh đăng"
                                            className="mb-2 rounded-xl max-h-56 w-full object-contain bg-white"
                                          />
                                        )}
                                        {post.content && (
                                          <div className="whitespace-pre-wrap break-words text-zinc-800 leading-snug">
                                            {post.content}
                                          </div>
                                        )}

                                        <div className="mt-2 flex items-center justify-between text-xs">
                                          <div className={`font-medium ${isMine ? 'text-emerald-700' : 'text-emerald-600'}`}>
                                            {isMine ? "Bạn" : (post.studentCode ? post.studentCode : "Ẩn danh")}
                                          </div>

                                          <button
                                            onClick={() => toggleLikeBoardPost({ postId: post._id })}
                                            disabled={activeActivity.status !== "active"}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-white active:bg-white text-emerald-600 transition-colors disabled:opacity-50"
                                          >
                                            <span>♥</span>
                                            <span className="font-mono tabular-nums">{post.likes || 0}</span>
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white border border-zinc-200 rounded-3xl p-8 text-center text-sm text-zinc-500">
                        {activeActivity.status === "active" 
                          ? "Chưa có ai đăng bài. Hãy là người đầu tiên!" 
                          : "Chưa có bài đăng nào."}
                      </div>
                    )}
                </>)}
              </>
            )}

            {/* Hoạt động đã đóng (chỉ hiển thị cho non-board) */}
            {activeActivity.status !== "active" && activeActivity.type !== "board" && (
              <div className="bg-zinc-100 rounded-3xl p-8 text-center text-zinc-600">
                Hoạt động này đã kết thúc.
              </div>
            )}
          </div>
        )}

        {/* BUỔI HỌC CỦA BẠN — lịch sử DUY NHẤT (gộp 2 mục cũ), đặt ở CHÂN trang:
            nội dung hiện tại (thẻ kết nối / hoạt động) là hero ở trên, phần xem
            lại quá khứ nằm dưới cùng. */}
        {identity && myHistory && (
          <div className="mt-8">
            <ActivityReplay
              items={(myHistory.items ?? []) as unknown as React.ComponentProps<typeof ActivityReplay>["items"]}
              stats={myHistory.stats}
            />
          </div>
        )}

      </div>
    </div>
  );
}
