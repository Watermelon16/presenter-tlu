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
  const isLmsLinked = joinCtx?.isLmsLinked ?? false;

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
  const [studentCodeInput, setStudentCodeInput] = useState("");
  const [fullNameInput, setFullNameInput] = useState("");
  const [classNameInput, setClassNameInput] = useState("");

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

    // GATE: nếu user đã login Convex (GV) thì KHÔNG auto-join SV identity
    // — sẽ tự redirect sang /presenter/CODE ở effect khác. Chỉ chạy auto-join
    // khi me query đã load và xác nhận KHÔNG phải GV approved.
    // me === undefined = đang load, !me?.user = không login (= SV thực sự)
    if (me === undefined) return; // đợi me load
    if (me?.user && me?.profile?.status === "approved") {
      // GV đã login → skip toàn bộ auto-join SV
      return;
    }

    // 0. LMS DEEP LINK: SV vừa điểm danh xong ở LMS rồi redirect sang đây
    // URL dạng (đầy đủ): /room/CODE?from_lms=1&sid=2351150001&name=Trần%20Văn%20An&class=65C
    // Minimal: /room/CODE?sid=2351150001  — backend tự lookup roster nếu phòng LMS-linked
    // LMS đã verify roster, attendance đã ghi sang LMS → Presenter chỉ cần auto-join
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get("sid")?.trim();
      const name = params.get("name")?.trim();
      const cls = params.get("class")?.trim();
      const fromLms = params.get("from_lms") === "1";
      // Auto-join khi: có sid (MSV). Name+class optional (backend resolve từ roster cho phòng LMS).
      // Trigger qua `from_lms=1` HOẶC chỉ cần ?sid= (cho phép LMS link tối giản).
      if (sid && (fromLms || !name)) {
        const lmsIdentity: StudentIdentity = {
          studentCode: sid,
          fullName: name || sid,  // backend sẽ override fullName từ roster nếu LMS-linked
          className: cls || "—",
        };
        joinSession({
          code: upperCode,
          studentCode: lmsIdentity.studentCode,
          // KHÔNG truyền fullName/className cho phòng LMS — để backend lookup roster.
          // Nếu phòng tự do (legacy non-LMS) thì name + class bắt buộc → ko auto-join trừ khi đủ.
          fullName: name || undefined,
          className: cls || undefined,
          deviceId: getOrCreateDeviceId(),
        })
          .then((result) => {
            // Backend trả về fullName/className đã resolved (LMS roster hoặc giá trị legacy)
            const resolved: StudentIdentity = {
              studentCode: sid,
              fullName: result.fullName ?? lmsIdentity.fullName,
              className: result.className ?? lmsIdentity.className,
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
            const msg = e.data || e.message || "Không thể vào phòng";
            toast.error(`Lỗi vào phòng: ${msg}`);
          });
        return;
      }
      if (fromLms && !sid) {
        console.warn("[Presenter] from_lms=1 nhưng thiếu sid:", { name, cls });
      }
    }

    // 1. Per-room (lưu sau khi SV join phòng này)
    const perRoom = localStorage.getItem(`student_${upperCode}`);
    if (perRoom) {
      try {
        const parsed = JSON.parse(perRoom) as StudentIdentity;
        if (parsed.studentCode && parsed.fullName && parsed.className) {
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
        if (parsed.studentCode && parsed.fullName && parsed.className) {
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

  // State để bung/thu lịch sử và xem chi tiết từng activity
  const [showHistory, setShowHistory] = useState(true);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

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
    if (!upperCode || !studentCodeInput.trim()) {
      toast.error("Vui lòng nhập mã sinh viên");
      return;
    }
    if (!isLmsLinked && (!fullNameInput.trim() || !classNameInput.trim())) {
      toast.error("Vui lòng điền đầy đủ thông tin");
      return;
    }

    try {
      // Gọi join để tạo participant + auto-compute attendance status
      // Phòng LMS-linked: backend sẽ tự lookup họ tên/lớp từ roster
      const result = await joinSession({
        code: upperCode,
        studentCode: studentCodeInput.trim(),
        fullName: isLmsLinked ? undefined : fullNameInput.trim(),
        className: isLmsLinked ? undefined : classNameInput.trim(),
        deviceId: getOrCreateDeviceId(),
      });

      // Backend trả fullName/className (đã resolve từ roster nếu LMS-linked)
      const newIdentity: StudentIdentity = {
        studentCode: studentCodeInput.trim(),
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
            <div className="text-sm text-emerald-800 flex-1">
              <span className="font-medium">{identity.fullName}</span>{" "}
              <span className="text-emerald-700">({identity.studentCode})</span>
              <span className="text-emerald-600"> · {identity.className}</span>
              <div className="text-[11px] text-emerald-700/80 mt-0.5">
                ✓ Thiết bị đã đăng ký với SV này trong buổi
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

        {/* LỊCH SỬ BUỔI — SV xem lại closed activities */}
        {identity && myHistory && (
          <ActivityReplay items={(myHistory.items ?? []) as unknown as React.ComponentProps<typeof ActivityReplay>["items"]} />
        )}

        {/* THÀNH TÍCH CÁ NHÂN — chỉ hiện khi SV đã có điểm (đã tham gia ≥1 hoạt động) */}
        {identity && myRankData && myRank >= 0 && myScore > 0 && (
          <div className="mb-6 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-50 to-amber-50 px-5 py-4 border-b border-zinc-200">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-emerald-700 font-semibold tracking-wider">🏆 THÀNH TÍCH CỦA BẠN</div>
                  <div className="flex items-baseline gap-3 mt-1">
                    <div className="text-4xl font-bold text-zinc-900">#{myRank + 1}</div>
                    <div className="text-sm text-zinc-600">
                      <span className="font-semibold text-emerald-700">{myScore} điểm</span>
                      {myAvgMs !== null && (
                        <span className="ml-2 text-zinc-500">⚡ {formatTimeMs(myAvgMs)}</span>
                      )}
                    </div>
                  </div>
                </div>
                {myRank === 0 && <div className="text-4xl">🥇</div>}
                {myRank === 1 && <div className="text-4xl">🥈</div>}
                {myRank === 2 && <div className="text-4xl">🥉</div>}
                {myRank >= 3 && myRank < 10 && <div className="text-3xl">⭐</div>}
              </div>
              <div className="text-xs text-zinc-600 mt-2">
                {rankData?.participantsWithScore || 0} / {rankData?.totalParticipants || 0} sinh viên có điểm
              </div>
            </div>

            {/* Link xem lịch sử xuyên buổi */}
            <div className="px-5 pt-3">
              <Link
                href={`/me?code=${encodeURIComponent(identity.studentCode)}`}
                className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline underline-offset-2"
              >
                📊 Xem thành tích qua các buổi khác →
              </Link>
            </div>

            {/* Top 3 nhỏ */}
            {rankData?.leaderboard && rankData.leaderboard.length > 0 && (
              <div className="px-5 py-3">
                <div className="text-[10px] tracking-wider text-zinc-500 font-medium mb-2">TOP 3</div>
                <div className="space-y-1.5">
                  {rankData.leaderboard.slice(0, 3).map((entry, idx) => {
                    const isMe = entry.studentCode === identity.studentCode;
                    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                    return (
                      <div
                        key={entry.studentCode}
                        className={`flex items-center gap-3 text-sm py-1 px-2 rounded-lg ${isMe ? "bg-emerald-100 border border-emerald-300" : ""}`}
                      >
                        <span className="text-lg">{medal}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-medium truncate ${isMe ? "text-emerald-900" : "text-zinc-800"}`}>
                            {entry.fullName} {isMe && <span className="text-xs text-emerald-700">(bạn)</span>}
                          </div>
                          {entry.avgResponseMs !== null && entry.avgResponseMs !== undefined && (
                            <div className="text-[10px] text-zinc-500 font-mono">⚡ {formatTimeMs(entry.avgResponseMs)} TB</div>
                          )}
                        </div>
                        <div className="text-sm font-mono font-semibold text-emerald-700 tabular-nums shrink-0">{entry.score} đ</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chưa có hoạt động — nếu chưa đăng ký identity, cho SV đăng ký trước */}
        {!activeActivity && !identity && (
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="text-3xl">👋</div>
              <div>
                <div className="font-semibold text-zinc-900">Chào mừng đến với buổi giảng</div>
                <p className="text-sm text-zinc-600 mt-0.5">
                  {isLmsLinked
                    ? `Buổi liên thông LMS${joinCtx?.className ? ` · Lớp ${joinCtx.className}` : ""}. Chỉ cần nhập mã sinh viên.`
                    : "Vui lòng đăng ký thông tin để tham gia hoạt động khi giảng viên bắt đầu."}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <VnInput
                type="text"
                placeholder="Mã sinh viên (VD: 2351150001)"
                value={studentCodeInput}
                onValueChange={(v) => setStudentCodeInput(v.toUpperCase())}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white font-mono"
              />
              {!isLmsLinked && (
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
                    placeholder="Lớp (VD: 65C)"
                    value={classNameInput}
                    onValueChange={setClassNameInput}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white"
                  />
                </>
              )}
              <button
                onClick={saveIdentity}
                disabled={
                  !studentCodeInput.trim() ||
                  (!isLmsLinked && (!fullNameInput.trim() || !classNameInput.trim()))
                }
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
              >
                Đăng ký tham gia
              </button>
              {isLmsLinked && (
                <p className="text-[11px] text-center text-zinc-500">
                  Họ tên và lớp lấy tự động từ danh sách LMS
                </p>
              )}
            </div>
          </div>
        )}

        {/* Chưa có hoạt động + đã có identity — chỉ hiện "đợi" */}
        {!activeActivity && identity && (
          <div className="text-center py-16">
            <div className="mx-auto w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-6">
              <span className="text-3xl">📭</span>
            </div>
            <h1 className="text-2xl font-semibold text-zinc-800 mb-2">Đang chờ giảng viên</h1>
            <p className="text-zinc-600 max-w-sm mx-auto">
              Bạn đã đăng ký. Khi giảng viên bắt đầu hoạt động, bạn sẽ thấy ngay.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-5 py-2.5 text-sm rounded-xl border border-zinc-300 hover:bg-zinc-100 transition-colors"
            >
              Làm mới
            </button>
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
                      placeholder="Mã sinh viên (VD: 2351150001)"
                      value={studentCodeInput}
                      onValueChange={(v) => setStudentCodeInput(v.toUpperCase())}
                      className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-white font-mono"
                    />
                    {!isLmsLinked && (
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
                          placeholder="Lớp (VD: 65C)"
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

        {/* ============== LỊCH SỬ HOẠT ĐỘNG CỦA SV ============== */}
        {identity && myHistory && myHistory.items.length > 0 && (
          <div className="mt-8 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-zinc-50 transition-colors"
            >
              <div className="text-left">
                <div className="font-semibold text-zinc-900">📝 Lịch sử hoạt động</div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  Đã tham gia {myHistory.stats.totalAnswered} / {myHistory.stats.totalActivities} hoạt động trong buổi
                </div>
              </div>
              <div className="text-zinc-400 text-lg">{showHistory ? "▲" : "▼"}</div>
            </button>

            {showHistory && (
              <div className="border-t border-zinc-200 divide-y divide-zinc-100">
                {myHistory.items.map((item) => {
                  const isExpanded = expandedHistoryId === item._id;
                  const isAnsweredItem = item.myResponse?.status === "answered";
                  const isCurrentActive = item.status === "active";
                  const typeIcon: Record<string, string> = {
                    poll: "📊", wordcloud: "☁️", rating: "⭐", qa: "❓", board: "📌", opentext: "✏️",
                  };

                  // Phân loại trạng thái màu
                  const statusBadge =
                    item.status === "active" ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white font-semibold">● ĐANG CHẠY</span>
                    ) : item.status === "closed" ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-300 text-zinc-700 font-medium">ĐÃ ĐÓNG</span>
                    ) : item.status === "expired" ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 font-medium">HẾT GIỜ</span>
                    ) : null;

                  return (
                    <div key={item._id} className={isCurrentActive ? "bg-emerald-50/40" : ""}>
                      <button
                        onClick={() => setExpandedHistoryId(isExpanded ? null : item._id)}
                        className="w-full px-5 py-3 text-left hover:bg-zinc-50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-2xl shrink-0 mt-0.5">{typeIcon[item.type] || "•"}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-zinc-900">{item.title}</span>
                              {statusBadge}
                              {isAnsweredItem && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">✓ Bạn đã tham gia</span>
                              )}
                              {!item.hasParticipated && !isCurrentActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Không tham gia</span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                              {item.slideCue && <span className="text-amber-600">📍 {item.slideCue}</span>}
                              <span>{item.totalAnswers} người trả lời</span>
                              {item.requiresStudentCode ? (
                                <span className="text-emerald-700">📋 Tính điểm</span>
                              ) : (
                                <span className="text-zinc-500">🕶️ Ẩn danh</span>
                              )}
                            </div>
                          </div>
                          <span className="text-zinc-400 text-sm shrink-0">{isExpanded ? "▲" : "▼"}</span>
                        </div>
                      </button>

                      {/* Chi tiết khi expanded */}
                      {isExpanded && (
                        <div className="px-5 pb-4 pl-14 text-sm text-zinc-700 space-y-2">
                          {item.myResponse ? (
                            <HistoryAnswerDisplay item={item} />
                          ) : item.hasParticipated && item.myBoardPosts.length > 0 ? (
                            <div className="space-y-2">
                              <div className="text-xs text-zinc-500">Bài đăng của bạn:</div>
                              {item.myBoardPosts.map((p) => (
                                <div key={p._id} className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
                                  {p.imageUrl && (
                                    <img src={p.imageUrl} alt="" className="max-h-32 rounded mb-2" />
                                  )}
                                  <div>{p.content}</div>
                                  <div className="text-xs text-emerald-600 mt-1">♥ {p.likes} likes</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-zinc-500 italic">Bạn không trả lời hoạt động này.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Hiển thị câu trả lời của SV cho 1 hoạt động trong lịch sử.
 * Format khác nhau tùy loại activity.
 */
function HistoryAnswerDisplay({ item }: { item: {
  type: string;
  config: unknown;
  myResponse: { value: unknown; status: string; submittedAt: number; deviceMismatch?: boolean } | null;
} }) {
  if (!item.myResponse) return null;
  const val = item.myResponse.value;

  // Quiz: kiểm tra đúng/sai
  const cfg = item.config as { isQuiz?: boolean; correctOptionIds?: string[]; options?: Array<{ id: string; text: string }>; pollType?: string } | null;
  const isQuiz = item.type === "poll" && cfg?.isQuiz && Array.isArray(cfg.correctOptionIds);

  if (item.type === "poll") {
    const choiceIds = (val as { choiceIds?: string[] })?.choiceIds || [];
    const opts = cfg?.options || [];
    const myChoices = opts.filter((o) => choiceIds.includes(o.id));

    let isCorrect: boolean | null = null;
    if (isQuiz && cfg.correctOptionIds) {
      const correctSet = new Set(cfg.correctOptionIds);
      const chosenSet = new Set(choiceIds);
      isCorrect = chosenSet.size === correctSet.size && [...chosenSet].every((id) => correctSet.has(id));
    }

    return (
      <div>
        <div className="text-xs text-zinc-500 mb-1.5">Câu trả lời của bạn:</div>
        <div className="space-y-1">
          {myChoices.map((o) => (
            <div key={o.id} className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-sm">
              ✓ {o.text}
            </div>
          ))}
        </div>
        {isQuiz && (
          <div className={`mt-2 text-sm font-medium ${isCorrect ? "text-emerald-700" : "text-red-600"}`}>
            {isCorrect ? "🎉 Bạn trả lời đúng!" : "❌ Đáp án chưa đúng"}
          </div>
        )}
        {isQuiz && !isCorrect && cfg?.correctOptionIds && (
          <div className="mt-2">
            <div className="text-xs text-zinc-500 mb-1">Đáp án đúng:</div>
            {cfg.options?.filter((o) => cfg.correctOptionIds!.includes(o.id)).map((o) => (
              <div key={o.id} className="px-3 py-1.5 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-900 text-sm">
                ✓ {o.text}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (item.type === "rating") {
    const rating = (val as { rating?: number })?.rating ?? (typeof val === "number" ? val : null);
    return (
      <div>
        <div className="text-xs text-zinc-500 mb-1">Bạn chấm:</div>
        <div className="text-3xl font-bold text-emerald-700">{rating ?? "—"}</div>
      </div>
    );
  }

  if (item.type === "wordcloud") {
    return (
      <div>
        <div className="text-xs text-zinc-500 mb-1">Từ khóa của bạn:</div>
        <div className="text-base font-medium text-emerald-700">{typeof val === "string" ? val : ""}</div>
      </div>
    );
  }

  if (item.type === "opentext") {
    return (
      <div>
        <div className="text-xs text-zinc-500 mb-1">Câu trả lời của bạn:</div>
        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 whitespace-pre-wrap">{typeof val === "string" ? val : ""}</div>
      </div>
    );
  }

  if (item.type === "qa") {
    const text = (val as { text?: string })?.text || (typeof val === "string" ? val : "");
    const upvotes = (val as { upvotes?: number })?.upvotes || 0;
    const answer = (val as { answer?: string })?.answer;
    return (
      <div>
        <div className="text-xs text-zinc-500 mb-1">Câu hỏi của bạn:</div>
        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
          <div>{text}</div>
          <div className="text-xs text-emerald-600 mt-2">👍 {upvotes} upvote</div>
          {answer && (
            <div className="mt-2 pt-2 border-t border-zinc-200">
              <div className="text-[10px] font-bold text-emerald-700 mb-1">GIẢNG VIÊN TRẢ LỜI:</div>
              <div className="text-emerald-900">{answer}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
