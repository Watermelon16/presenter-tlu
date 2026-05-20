"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";

interface StudentIdentity {
  studentCode: string;
  fullName: string;
  className: string;
}

export default function ParticipantRoomPage() {
  const { code } = useParams<{ code: string }>();
  const upperCode = code?.toUpperCase();

  // Lấy thông tin buổi
  const session = useQuery(
    api.sessions.getSessionByCode,
    upperCode ? { code: upperCode } : "skip"
  );

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

  // Load danh tính từ localStorage khi vào phòng
  useEffect(() => {
    if (!upperCode) return;
    const saved = localStorage.getItem(`student_${upperCode}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as StudentIdentity;
        setIdentity(parsed);
      } catch {}
    }
  }, [upperCode]);

  // Tính hạng cá nhân
  let myRank = -1;
  let myScore = 0;

  const rankData = myRankData as any;
  if (identity && rankData?.leaderboard) {
    const foundIndex = rankData.leaderboard.findIndex(
      (s: any) => s.studentCode === identity.studentCode
    );
    if (foundIndex >= 0) {
      myRank = foundIndex;
      myScore = rankData.leaderboard[foundIndex].score;
    }
  }

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

  // Reset vote state khi hoạt động thay đổi
  useEffect(() => {
    setSelectedOptions([]);
    setWordcloudInput("");
    setQaQuestionInput("");
    setHasSubmitted(false);
    setSubmitError("");
  }, [activeActivity?._id]);

  // Luôn thu thập danh tính khi vào phòng (để liên thông với danh sách sinh viên của giảng viên)
  // Chỉ cần nhập 1 lần / phòng (dựa vào localStorage)
  const needsIdentity = !identity;

  // Lưu danh tính
  const saveIdentity = async () => {
    if (!upperCode || !studentCodeInput.trim() || !fullNameInput.trim() || !classNameInput.trim()) {
      toast.error("Vui lòng điền đầy đủ thông tin");
      return;
    }

    const newIdentity: StudentIdentity = {
      studentCode: studentCodeInput.trim(),
      fullName: fullNameInput.trim(),
      className: classNameInput.trim(),
    };

    try {
      // Gọi join để tạo participant (nếu session yêu cầu)
      await joinSession({
        code: upperCode,
        studentCode: newIdentity.studentCode,
        fullName: newIdentity.fullName,
        className: newIdentity.className,
      });

      localStorage.setItem(`student_${upperCode}`, JSON.stringify(newIdentity));
      setIdentity(newIdentity);
      setShowIdentityForm(false);
      setStudentCodeInput("");
      setFullNameInput("");
      setClassNameInput("");

      // Feedback nhẹ cho sinh viên biết họ đã được ghi nhận
      toast.success("Đã ghi nhận thông tin. Câu trả lời của bạn sẽ được dùng để tính điểm tham gia.", { duration: 4000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể lưu thông tin. Vui lòng thử lại.";
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
        value = parseInt(selectedOptions[0]);
      } else if (activeActivity.type === "qa") {
        value = qaQuestionInput.trim();
      } else {
        value =
          activeActivity.config?.pollType === "multiple_choice"
            ? selectedOptions
            : selectedOptions[0];
      }

      await submitResponse({
        activityId: activeActivity._id,
        studentCode: identity?.studentCode,
        value,
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

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-zinc-500">Đang tải phòng...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-12">
      {/* Header đơn giản */}
      <div className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-zinc-500">PHÒNG</div>
            <div className="font-mono text-2xl tracking-[4px] font-semibold text-zinc-900">
              {session.code}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium text-zinc-700">{session.title}</div>
            {session.hostName && (
              <div className="text-xs text-zinc-500">{session.hostName}</div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-8">

        {/* Banner xác nhận danh tính cho sinh viên - Rất quan trọng để họ biết mình đang được tính điểm */}
        {identity && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="text-emerald-600 text-lg leading-none mt-0.5">✓</div>
            <div className="text-sm text-emerald-800">
              <span className="font-medium">{identity.fullName}</span> ({identity.studentCode}) — Thông tin của bạn đã được ghi nhận để tính điểm tham gia.
            </div>
          </div>
        )}

        {/* Hiển thị hạng cá nhân - Tăng động lực */}
        {identity && myRankData && (
          <div className="mb-6 bg-white border border-zinc-200 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-emerald-600 font-semibold tracking-wider">THÀNH TÍCH CỦA BẠN</div>
                {myRank >= 0 ? (
                  <>
                    <div className="text-4xl font-bold text-zinc-900 mt-1">#{myRank + 1}</div>
                    <div className="text-sm text-zinc-600 mt-0.5">
                      {myScore} điểm • {rankData.participantsWithScore} / {rankData.totalParticipants} người đã tham gia
                    </div>
                  </>
                ) : (
                  <div className="text-lg text-zinc-600 mt-1">Bạn chưa có điểm nào. Hãy tham gia các hoạt động nhé!</div>
                )}
              </div>
              {myRank >= 0 && myRank < 3 && (
                <div className="text-4xl">🎉</div>
              )}
            </div>
          </div>
        )}

        {/* Chưa có hoạt động nào đang diễn ra */}
        {!activeActivity && (
          <div className="text-center py-16">
            <div className="mx-auto w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-6">
              <span className="text-3xl">📭</span>
            </div>
            <h1 className="text-2xl font-semibold text-zinc-800 mb-2">Chưa có hoạt động</h1>
            <p className="text-zinc-600 max-w-sm mx-auto">
              Giảng viên chưa bắt đầu hoạt động nào. Vui lòng chờ hoặc làm mới trang sau vài giây.
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
                    <input
                      type="text"
                      placeholder="Mã sinh viên (VD: 2351150001)"
                      value={studentCodeInput}
                      onChange={(e) => setStudentCodeInput(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-white font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Họ và tên (VD: Trần Văn An)"
                      value={fullNameInput}
                      onChange={(e) => setFullNameInput(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Lớp (VD: 65C)"
                      value={classNameInput}
                      onChange={(e) => setClassNameInput(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-white"
                    />
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
                <div className="mb-3 text-xs text-emerald-600">
                  Thông tin của bạn đã được ghi nhận để tính điểm tham gia.
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

                <input
                  type="text"
                  maxLength={30}
                  value={wordcloudInput}
                  onChange={(e) => setWordcloudInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && wordcloudInput.trim()) {
                      handleSubmit();
                    }
                  }}
                  placeholder="Ví dụ: cao trình đỉnh đập, dung tích hồ, mực nước chết..."
                  className="w-full px-5 py-4 rounded-2xl border border-zinc-200 text-lg focus:outline-none focus:border-emerald-500"
                  disabled={isSubmitting || timeLeft === 0}
                />

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
                <textarea
                  value={wordcloudInput}
                  onChange={(e) => setWordcloudInput(e.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="Nhập câu trả lời của bạn..."
                  className="w-full px-5 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 resize-y"
                  disabled={isSubmitting || timeLeft === 0}
                />
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
            {activeActivity.type === "rating" && !hasSubmitted && (
              <div className="bg-white border rounded-3xl p-6 shadow-sm">
                <div className="mb-4 text-sm text-zinc-500">
                  {activeActivity.config?.minLabel} — {activeActivity.config?.maxLabel}
                </div>

                <div className="flex justify-between gap-2">
                  {Array.from({ length: (activeActivity.config?.max || 5) - (activeActivity.config?.min || 1) + 1 }, (_, i) => {
                    const value = (activeActivity.config?.min || 1) + i;
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
                  {isSubmitting ? "Đang gửi..." : "Gửi đánh giá"}
                </button>
              </div>
            )}

            {/* Q&A - Gửi câu hỏi + Danh sách câu hỏi */}
            {activeActivity.type === "qa" && (
              <div className="bg-white border rounded-3xl p-6 shadow-sm space-y-6">
                {/* Form gửi câu hỏi */}
                {!hasSubmitted && (
                  <>
                    <div>
                      <div className="mb-2 text-sm text-zinc-500">Bạn có câu hỏi gì?</div>
                      <textarea
                        value={qaQuestionInput}
                        onChange={(e) => setQaQuestionInput(e.target.value)}
                        placeholder="Nhập câu hỏi của bạn..."
                        rows={2}
                        className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 resize-y"
                        disabled={isSubmitting || timeLeft === 0}
                      />
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
                    : "Cảm ơn bạn đã đóng góp. Phần tham gia của bạn đang được ghi nhận để tính điểm."}
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

                {activeActivity.type === "poll" && !isQuiz && pollResults && pollResults.totalAnswered > 0 && (
                  <div className="mt-6 pt-6 border-t border-emerald-200 text-left">
                    <div className="text-sm font-medium text-emerald-800 mb-3">Kết quả hiện tại</div>
                    {pollResults.options?.map((opt: any) => {
                      const pct = pollResults.totalAnswered
                        ? Math.round((opt.count / pollResults.totalAnswered) * 100)
                        : 0;
                      return (
                        <div key={opt.id} className="mb-2.5">
                          <div className="flex justify-between text-sm mb-1">
                            <span>{opt.text}</span>
                            <span className="font-mono text-emerald-700">{pct}%</span>
                          </div>
                          <div className="h-2 bg-emerald-100 rounded-full overflow-hidden">
                            <div
                              className="h-2 bg-emerald-500 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeActivity.type === "wordcloud" && (
                  <p className="mt-4 text-sm text-emerald-600">Từ khóa của bạn đã được ghi nhận và góp phần tạo nên đám mây từ.</p>
                )}

                {activeActivity.type === "qa" && (
                  <p className="mt-4 text-sm text-emerald-600">Câu hỏi của bạn đã được gửi. Giảng viên sẽ xem và trả lời sớm nhất có thể.</p>
                )}

                {/* === BOARD EXPERIENCE (Sinh viên) === */}
                {(activeActivity as any).type === "board" && (
                  <>
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

                        <textarea
                          value={boardContentInput}
                          onChange={(e) => setBoardContentInput(e.target.value)}
                          placeholder="Viết ý tưởng, nhận xét, câu hỏi... (có thể đăng nhiều lần)"
                          rows={2}
                          className="w-full px-4 py-3 rounded-2xl border border-zinc-200 text-base focus:outline-none focus:border-emerald-500 resize-y"
                          disabled={isSubmitting || timeLeft === 0 || isUploadingImage}
                        />

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
                  </>
                )}
              </div>
            )}

            {/* Hoạt động đã đóng */}
            {activeActivity.status !== "active" && (
              <div className="bg-zinc-100 rounded-3xl p-8 text-center text-zinc-600">
                Hoạt động này đã kết thúc.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
