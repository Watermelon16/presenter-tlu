"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AttendanceStatus = "present" | "late" | "excused" | "absent" | "early_leave";

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Có mặt",
  late: "Đi muộn",
  excused: "Vắng có phép",
  absent: "Vắng không phép",
  early_leave: "Về sớm",
};

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: "bg-emerald-100 text-emerald-800 border-emerald-300",
  late: "bg-amber-100 text-amber-800 border-amber-300",
  excused: "bg-sky-100 text-sky-800 border-sky-300",
  absent: "bg-red-100 text-red-800 border-red-300",
  early_leave: "bg-violet-100 text-violet-800 border-violet-300",
};

const STATUS_ICON: Record<AttendanceStatus, string> = {
  present: "✓",
  late: "⏰",
  excused: "📝",
  absent: "✕",
  early_leave: "↩",
};

interface Props {
  sessionId: Id<"sessions">;
  onClose: () => void;
}

export function AttendanceModal({ sessionId, onClose }: Props) {
  const session = useQuery(api.sessions.getSessionById, { sessionId });
  const participants = useQuery(api.participants.listParticipants, { sessionId });
  const setStatus = useMutation(api.participants.setAttendanceStatus);
  const setStatusBulk = useMutation(api.participants.setAttendanceStatusBulk);
  const updateSettings = useMutation(api.participants.updateAttendanceSettings);

  const [showSettings, setShowSettings] = useState(false);
  const [lateThreshold, setLateThreshold] = useState<number>(10);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [settingsInitialized, setSettingsInitialized] = useState(false);

  // Init settings từ session khi load
  if (session && !settingsInitialized) {
    setLateThreshold(session.lateThresholdMinutes ?? 10);
    setWebhookUrl(session.attendanceWebhookUrl ?? "");
    setSettingsInitialized(true);
  }

  if (session === undefined || participants === undefined) {
    return (
      <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-10 text-zinc-600">Đang tải...</div>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-10 text-zinc-600">Không tìm thấy buổi giảng.</div>
      </div>
    );
  }

  // Count by status
  const counts = {
    present: participants.filter((p) => p.attendanceStatus === "present").length,
    late: participants.filter((p) => p.attendanceStatus === "late").length,
    excused: participants.filter((p) => p.attendanceStatus === "excused").length,
    absent: participants.filter((p) => p.attendanceStatus === "absent").length,
    early_leave: participants.filter((p) => p.attendanceStatus === "early_leave").length,
    total: participants.length,
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const handleSetStatus = async (
    participantId: Id<"participants">,
    status: AttendanceStatus
  ) => {
    try {
      await setStatus({ participantId, status });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  };

  const handleBulk = async (status: AttendanceStatus) => {
    const target = participants.filter((p) => p.attendanceStatus !== status);
    if (target.length === 0) {
      toast.message("Tất cả SV đã có trạng thái này");
      return;
    }
    if (
      !confirm(
        `Đánh "${STATUS_LABEL[status]}" cho ${target.length} SV còn lại (${target.length}/${participants.length})?`
      )
    )
      return;
    try {
      const result = await setStatusBulk({
        participantIds: target.map((p) => p._id),
        status,
      });
      toast.success(`Đã đánh ${result.count} SV thành "${STATUS_LABEL[status]}"`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateSettings({
        sessionId,
        lateThresholdMinutes: lateThreshold,
        attendanceWebhookUrl: webhookUrl.trim() || undefined,
      });
      toast.success("Đã lưu cài đặt điểm danh");
      setShowSettings(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  };

  const exportCsv = () => {
    const rows = [
      ["Mã SV", "Họ tên", "Lớp", "Trạng thái", "Giờ scan", "Ghi chú"],
      ...participants.map((p) => [
        p.studentCode,
        p.fullName,
        p.className,
        p.attendanceStatus ? STATUS_LABEL[p.attendanceStatus as AttendanceStatus] : "",
        new Date(p.joinedAt).toLocaleString("vi-VN"),
        p.attendanceNote ?? "",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diem-danh-${session.code}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Đã tải CSV để import LMS");
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-6 flex flex-col max-h-[calc(100vh-3rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold">📋 Điểm danh — {session.title}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {counts.total} SV đã scan ·{" "}
              {session.officialStartAt ? (
                <>
                  Giờ bắt đầu (T₀): <strong>{formatTime(session.officialStartAt)}</strong> · Ngưỡng đi muộn:{" "}
                  <strong>{session.lateThresholdMinutes ?? 10} phút</strong>
                </>
              ) : (
                "Chưa có SV nào scan — T₀ chưa xác lập"
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Stats chips */}
        <div className="px-6 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-2 bg-zinc-50">
          {(["present", "late", "excused", "absent", "early_leave"] as AttendanceStatus[]).map(
            (s) => (
              <div
                key={s}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${STATUS_COLOR[s]}`}
              >
                {STATUS_ICON[s]} {STATUS_LABEL[s]}: <span className="font-bold">{counts[s]}</span>
              </div>
            )
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="text-xs text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded-lg border border-zinc-200 hover:bg-white"
            >
              ⚙️ {showSettings ? "Ẩn cài đặt" : "Cài đặt"}
            </button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              💾 Tải CSV
            </Button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="px-6 py-3 border-b border-zinc-100 bg-amber-50/40 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1">
                  Ngưỡng đi muộn (phút sau T₀)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={lateThreshold}
                  onChange={(e) => setLateThreshold(Number(e.target.value) || 0)}
                  className="h-9"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  SV scan trong {lateThreshold} phút đầu = Có mặt. Sau đó = Đi muộn.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1">
                  Webhook URL (tùy chọn)
                </label>
                <Input
                  type="url"
                  placeholder="https://lms.example.com/api/attendance"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="h-9 font-mono text-xs"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Presenter POST tới URL này mỗi lần SV scan (chưa triển khai gửi — chỉ lưu config).
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSaveSettings}>
                Lưu cài đặt
              </Button>
            </div>
          </div>
        )}

        {/* Bulk actions */}
        <div className="px-6 py-2 border-b border-zinc-100 flex flex-wrap gap-1.5 text-xs">
          <span className="text-zinc-500 mr-2 self-center">Đánh tất cả còn lại:</span>
          {(["present", "late", "excused", "absent", "early_leave"] as AttendanceStatus[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => handleBulk(s)}
                className={`px-2 py-1 rounded border ${STATUS_COLOR[s]} hover:opacity-80`}
              >
                {STATUS_ICON[s]} {STATUS_LABEL[s]}
              </button>
            )
          )}
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {counts.total === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <div className="text-4xl mb-2">👥</div>
              Chưa có SV nào scan QR. Bấm <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-xs">Q</kbd> chiếu QR.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500 border-b border-zinc-200 sticky top-0 bg-white">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-10">#</th>
                  <th className="text-left px-3 py-2 font-medium">Mã SV</th>
                  <th className="text-left px-3 py-2 font-medium">Họ tên</th>
                  <th className="text-left px-3 py-2 font-medium">Lớp</th>
                  <th className="text-left px-3 py-2 font-medium">Giờ scan</th>
                  <th className="text-left px-3 py-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {[...participants]
                  .sort((a, b) => a.joinedAt - b.joinedAt)
                  .map((p: Doc<"participants">, idx) => {
                    const status = (p.attendanceStatus ?? "absent") as AttendanceStatus;
                    return (
                      <tr
                        key={p._id}
                        className={`border-b border-zinc-100 hover:bg-zinc-50 ${p.flagged ? "bg-red-50/40" : ""}`}
                      >
                        <td className="px-3 py-2 text-zinc-500">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono">
                          {p.studentCode}
                          {p.flagged && (
                            <span
                              title={p.flagReason || "Có dấu hiệu gian lận"}
                              className="ml-1 text-red-600 cursor-help"
                            >
                              🚩
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium">{p.fullName}</td>
                        <td className="px-3 py-2 text-zinc-600">{p.className}</td>
                        <td className="px-3 py-2 text-xs text-zinc-500">{formatTime(p.joinedAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            {(["present", "late", "excused", "absent", "early_leave"] as AttendanceStatus[]).map(
                              (s) => {
                                const isActive = status === s;
                                return (
                                  <button
                                    key={s}
                                    onClick={() => handleSetStatus(p._id, s)}
                                    className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                      isActive
                                        ? STATUS_COLOR[s] + " font-bold"
                                        : "bg-white border-zinc-200 text-zinc-400 hover:bg-zinc-50"
                                    }`}
                                    title={STATUS_LABEL[s] + (p.attendanceManualOverride && isActive ? " (GV chỉnh tay)" : "")}
                                  >
                                    {STATUS_ICON[s]}
                                  </button>
                                );
                              }
                            )}
                            {p.attendanceManualOverride && (
                              <span className="text-[10px] text-zinc-400 ml-1" title="GV đã chỉnh tay">
                                ✋
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex items-center justify-between bg-zinc-50 text-xs text-zinc-500">
          <div>
            Auto-compute: T₀ + {session.lateThresholdMinutes ?? 10}p → muộn. GV bấm icon trạng thái để override.
          </div>
          <Button onClick={onClose} variant="outline" size="sm">
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
