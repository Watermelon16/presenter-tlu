"use client";

import { useEffect, useState } from "react";

// Gắn nhãn khách trùng thiết bị: nhiều khách cùng deviceId → "cùng máy #N". Hàm thuần
// (không phải hook) để gọi an toàn sau early-return trong component.
function computeGuestDeviceTags(guests: { deviceId: string | null }[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const g of guests) if (g.deviceId) count.set(g.deviceId, (count.get(g.deviceId) ?? 0) + 1);
  const tag = new Map<string, number>();
  let n = 0;
  for (const g of guests) {
    if (g.deviceId && (count.get(g.deviceId) ?? 0) > 1 && !tag.has(g.deviceId)) tag.set(g.deviceId, ++n);
  }
  return tag;
}
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Status = "present" | "late" | "excused" | "absent" | "early_leave";

const STATUS_META: Record<Status, { label: string; icon: string; cls: string; ring: string }> = {
  present:     { label: "Có mặt",          icon: "✓", cls: "bg-emerald-100 text-emerald-800 border-emerald-300", ring: "ring-emerald-500" },
  late:        { label: "Đi muộn",         icon: "⏰", cls: "bg-amber-100 text-amber-800 border-amber-300",       ring: "ring-amber-500" },
  excused:     { label: "Vắng có phép",    icon: "📝", cls: "bg-sky-100 text-sky-800 border-sky-300",             ring: "ring-sky-500" },
  absent:      { label: "Vắng không phép", icon: "✗", cls: "bg-rose-100 text-rose-800 border-rose-300",           ring: "ring-rose-500" },
  early_leave: { label: "Về sớm",          icon: "↩", cls: "bg-violet-100 text-violet-800 border-violet-300",     ring: "ring-violet-500" },
};
const STATUS_ORDER: Status[] = ["present", "late", "excused", "absent", "early_leave"];

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function fmtClock(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtRemaining(targetMs: number, nowMs: number): string {
  const diff = Math.round((targetMs - nowMs) / 1000);
  if (diff > 0) {
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return m > 0 ? `còn ${m}p${s.toString().padStart(2, "0")}s` : `còn ${s}s`;
  }
  return `đã qua ${Math.floor(Math.abs(diff) / 60)}p`;
}
function fmtRelative(ts: number, nowMs: number): string {
  const diffSec = Math.round((nowMs - ts) / 1000);
  if (diffSec < 60) return "vừa xong";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}p trước`;
  return `${Math.floor(m / 60)}h${m % 60}p trước`;
}

export function AttendancePanel({
  code,
  sessionId,
  open,
  onClose,
}: {
  code: string;
  sessionId: Id<"sessions">;
  open: boolean;
  onClose: () => void;
}) {
  const state = useQuery(api.lms.getAttendanceState, open ? { code } : "skip");
  const setStatus = useMutation(api.participants.setAttendanceStatus);
  const setStatusBulk = useMutation(api.participants.setAttendanceStatusBulk);
  const updateSettings = useMutation(api.participants.updateAttendanceSettings);
  const pushAllToLms = useMutation(api.participants.pushAllParticipantsToLms);
  const setAccessMode = useMutation(api.sessions.setAccessMode);
  const [isPushingLms, setIsPushingLms] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [lateThreshold, setLateThreshold] = useState(10);
  const [absentAfter, setAbsentAfter] = useState(50);
  const [settingsInited, setSettingsInited] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (state && !settingsInited) {
      setLateThreshold(state.lateCutoffMinutes ?? 10);
      setAbsentAfter(state.absentAfterMinutes ?? 50);
      setSettingsInited(true);
    }
  }, [state, settingsInited]);

  if (!open) return null;
  if (!state) {
    return (
      <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl px-6 py-8 text-zinc-500" onClick={(e) => e.stopPropagation()}>
          Đang tải...
        </div>
      </div>
    );
  }

  const {
    counts, rows, isLmsLinked, className, accessMode,
    attendanceOpenAt, lateCutoffMinutes, absentAfterMinutes, attendanceFinalizedAt,
    rosterCount, guestCount, rosterSyncedAt, sessionTitle,
  } = state;
  // Phòng thủ: nếu Convex chưa kịp deploy field mới → tránh crash (guests = [])
  const guests = state.guests ?? [];
  const lateCutoffAt = attendanceOpenAt ? attendanceOpenAt + lateCutoffMinutes * 60_000 : null;
  const absentCutoffAt = attendanceOpenAt ? attendanceOpenAt + absentAfterMinutes * 60_000 : null;

  // Đánh dấu khách đăng ký TRÙNG thiết bị (thường là đăng ký thử từ 1 điện thoại).
  const guestDeviceTag = computeGuestDeviceTags(guests);
  const dupGuestCount = guests.filter((g) => g.deviceId && guestDeviceTag.has(g.deviceId)).length;
  const distinctGuestDevices = new Set(guests.map((g) => g.deviceId ?? `_${g.studentCode}`)).size;

  let nextCutoff: { label: string; at: number } | null = null;
  if (lateCutoffAt && now < lateCutoffAt) nextCutoff = { label: "muộn", at: lateCutoffAt };
  else if (absentCutoffAt && now < absentCutoffAt) nextCutoff = { label: "vắng", at: absentCutoffAt };

  const totalSV = isLmsLinked ? Math.max(rosterCount, rows.length) : rows.length;
  const scannedSV = rows.filter((r) => r.attendanceStatus != null).length;

  const pills: Array<{ key: keyof typeof counts; label: string; value: number; color: string }> = [
    { key: "present",    label: "Có mặt",       value: counts.present,    color: "bg-emerald-50 border-emerald-300 text-emerald-800" },
    { key: "late",       label: "Đi muộn",      value: counts.late,       color: "bg-amber-50 border-amber-300 text-amber-800" },
    { key: "excused",    label: "Vắng có phép", value: counts.excused,    color: "bg-sky-50 border-sky-300 text-sky-800" },
    { key: "absent",     label: "Vắng không phép", value: counts.absent,  color: "bg-rose-50 border-rose-300 text-rose-800" },
    { key: "earlyLeave", label: "Về sớm",       value: counts.earlyLeave, color: "bg-violet-50 border-violet-300 text-violet-800" },
  ];
  if (isLmsLinked) {
    pills.push({ key: "notCheckedIn", label: "Chưa điểm danh", value: counts.notCheckedIn, color: "bg-zinc-50 border-zinc-300 text-zinc-700" });
  }

  const handleSetStatus = async (participantId: string | null, newStatus: Status, currentNote?: string | null) => {
    if (!participantId) {
      toast.message("SV chưa có bản ghi điểm danh — đợi SV scan QR trước");
      return;
    }
    // Yêu cầu ghi chú cho 2 trạng thái cần lý do
    let note: string | undefined = undefined;
    if (newStatus === "excused" || newStatus === "early_leave") {
      const placeholder = newStatus === "excused"
        ? "VD: nghỉ ốm có giấy, đi công tác đoàn..."
        : "VD: về sớm vì việc gia đình, lúc 15:30...";
      const input = window.prompt(
        `Ghi chú lý do "${STATUS_META[newStatus].label}" (tuỳ chọn):`,
        currentNote ?? placeholder
      );
      if (input === null) return; // user cancel
      note = input.trim() || undefined;
    }
    try {
      await setStatus({ participantId: participantId as Id<"participants">, status: newStatus, note });
      toast.success(`Đã đánh ${STATUS_META[newStatus].label}${note ? ` · ${note}` : ""}`);
    } catch (e: unknown) {
      const err = e as { data?: string; message?: string };
      toast.error(err.data || err.message || "Lỗi");
    }
  };

  const handlePushAllToLms = async () => {
    if (isPushingLms) return;
    setIsPushingLms(true);
    try {
      const r = await pushAllToLms({ sessionId });
      if (r.queued === 0) {
        toast.message("Không có SV nào để đồng bộ");
      } else {
        toast.success(`Đã đẩy ${r.queued} SV lên LMS${r.skipped ? ` (bỏ qua ${r.skipped} chưa điểm danh)` : ""}. LMS sẽ cập nhật trong vài giây.`);
      }
    } catch (e: unknown) {
      const err = e as { data?: string; message?: string };
      toast.error(err.data || err.message || "Lỗi đồng bộ LMS");
    } finally {
      setIsPushingLms(false);
    }
  };

  const handleBulkRemaining = async (newStatus: Status) => {
    const remaining = rows.filter((r) => r.attendanceStatus == null && r.participantId).map((r) => r.participantId as string);
    if (remaining.length === 0) {
      toast.message("Không còn SV nào chưa có trạng thái");
      return;
    }
    if (!confirm(`Đánh ${remaining.length} SV còn lại thành "${STATUS_META[newStatus].label}"?`)) return;
    try {
      const r = await setStatusBulk({ participantIds: remaining as Id<"participants">[], status: newStatus });
      toast.success(`Đã đánh ${r.count} SV → ${STATUS_META[newStatus].label}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Lỗi");
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateSettings({
        sessionId,
        lateThresholdMinutes: lateThreshold,
        absentAfterMinutes: absentAfter,
      });
      toast.success("Đã lưu cài đặt");
      setShowSettings(false);
    } catch (e: unknown) {
      const err = e as { data?: string; message?: string };
      toast.error(err.data || err.message || "Lỗi");
    }
  };

  const exportCsv = () => {
    const header = ["STT", "Mã SV", "Họ tên", "Lớp", "Trạng thái", "Ghi chú", "Giờ scan", "Nguồn"];
    const lines = [header.join(",")];
    rows.forEach((r, i) => {
      const meta = r.attendanceStatus ? STATUS_META[r.attendanceStatus as Status] : null;
      const cells = [
        i + 1, r.studentCode, r.fullName, r.className || className || "",
        meta ? meta.label : "(chưa điểm danh)",
        r.attendanceNote ?? "",
        fmtTime(r.checkinAt),
        r.checkinSource === "lms" ? "LMS" : r.checkinSource === "presenter" ? "Presenter" : "—",
      ];
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diem-danh-${code}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Đã tải CSV");
  };

  const t0Text = attendanceOpenAt
    ? `Giờ bắt đầu (T₀): ${fmtClock(attendanceOpenAt)} · Muộn sau ${lateCutoffMinutes}p, vắng sau ${absentAfterMinutes}p`
    : "Chưa có T₀ — đợi LMS bấm 'Bắt đầu' hoặc SV đầu tiên scan";

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-6 flex flex-col max-h-[calc(100vh-3rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
              📋 Điểm danh — {sessionTitle}
              {isLmsLinked && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white font-semibold">LMS</span>
              )}
              {className && (
                <span className="text-sm text-zinc-500 font-normal">· Lớp {className}</span>
              )}
              {attendanceFinalizedAt && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 font-medium">ĐÃ ĐÓNG</span>
              )}
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              <strong className="text-zinc-700">{scannedSV}/{totalSV}</strong> SV đã scan · {t0Text}
              {guestCount > 0 && (
                <span className="ml-2 text-sky-700 font-medium">· {guestCount} khách (ngoài danh sách)</span>
              )}
              {nextCutoff && !attendanceFinalizedAt && (
                <span className="ml-2 text-emerald-700 font-medium">
                  ({fmtRemaining(nextCutoff.at, now)} đến mốc {nextCutoff.label})
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none shrink-0"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>

        {/* Counts pills + actions */}
        <div className="px-6 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap bg-zinc-50">
          {pills.map((p) => (
            <div key={p.key} className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${p.color}`}>
              {p.label}: <span className="font-bold tabular-nums">{p.value}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            {isLmsLinked && (
              <button
                onClick={handlePushAllToLms}
                disabled={isPushingLms}
                className="px-3 py-1.5 text-xs rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-medium disabled:opacity-60"
                title="Đẩy trạng thái hiện tại của TẤT CẢ SV lên LMS — fix khi 2 bên lệch nhau"
              >
                {isPushingLms ? "Đang đẩy..." : "🔄 Đồng bộ lại với LMS"}
              </button>
            )}
            <button onClick={() => setShowSettings((v) => !v)} className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 font-medium">
              ⚙️ Cài đặt
            </button>
            <button onClick={exportCsv} className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 font-medium">
              💾 Tải CSV
            </button>
          </div>
        </div>

        {/* Settings collapsible */}
        {showSettings && (
          <div className="px-6 py-3 border-b border-zinc-100 bg-amber-50/40 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-zinc-700 block mb-1">Chế độ vào học</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "roster", label: "Danh sách lớp", desc: "Chỉ SV trong danh sách" },
                  { key: "open", label: "Ghi danh tự do", desc: "Ai cũng vào · khai họ tên" },
                  { key: "public", label: "Quảng bá", desc: "Chỉ cần họ tên" },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    onClick={async () => {
                      try {
                        await setAccessMode({ sessionId, accessMode: m.key });
                        toast.success(`Đã chuyển: ${m.label}`);
                      } catch {
                        toast.error("Không đổi được chế độ vào học");
                      }
                    }}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      accessMode === m.key
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-zinc-200 bg-white hover:bg-zinc-50"
                    }`}
                  >
                    <div className="text-xs font-semibold text-zinc-800">{m.label}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">{m.desc}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">
                Khách (không có trong danh sách lớp) vẫn học được nhưng không vào sổ điểm danh.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">Ngưỡng đi muộn (phút sau T₀)</label>
              <input
                type="number"
                min={0}
                max={120}
                value={lateThreshold}
                onChange={(e) => setLateThreshold(Number(e.target.value) || 0)}
                className="w-full h-9 px-3 rounded-md border border-zinc-200 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">Ngưỡng vắng (phút sau T₀)</label>
              <input
                type="number"
                min={lateThreshold + 1}
                max={240}
                value={absentAfter}
                onChange={(e) => setAbsentAfter(Number(e.target.value) || 0)}
                className="w-full h-9 px-3 rounded-md border border-zinc-200 text-sm"
              />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-zinc-500">
                0..{lateThreshold}p = Có mặt · {lateThreshold}..{absentAfter}p = Muộn · &gt;{absentAfter}p = Vắng
              </p>
              <button onClick={handleSaveSettings} className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500">
                Lưu cài đặt
              </button>
            </div>
          </div>
        )}

        {/* Bulk actions */}
        <div className="px-6 py-2.5 border-b border-zinc-100 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-zinc-600 font-medium shrink-0">Đánh tất cả còn lại:</span>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => handleBulkRemaining(s)}
              className={`px-3 py-1.5 rounded-lg border ${STATUS_META[s].cls} font-medium hover:opacity-80 transition-opacity`}
            >
              {STATUS_META[s].icon} {STATUS_META[s].label}
            </button>
          ))}
        </div>

        {rosterSyncedAt && isLmsLinked && (
          <div className="px-6 py-1.5 text-[11px] text-zinc-500 bg-zinc-50/60 border-b border-zinc-100">
            Roster đồng bộ từ LMS {fmtRelative(rosterSyncedAt, now)} ({fmtTime(rosterSyncedAt)})
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-white sticky top-0 z-10 border-b border-zinc-200">
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-6 py-2.5 font-medium w-10">#</th>
                <th className="px-3 py-2.5 font-medium">Mã SV</th>
                <th className="px-3 py-2.5 font-medium">Họ tên</th>
                <th className="px-3 py-2.5 font-medium">Lớp</th>
                <th className="px-3 py-2.5 font-medium">Giờ scan</th>
                {isLmsLinked && <th className="px-3 py-2.5 font-medium">Nguồn</th>}
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r, i) => {
                const active = r.attendanceStatus;
                return (
                  <tr key={r.studentCode + (r.participantId ?? "")} className={r.flagged ? "bg-amber-50/60" : "hover:bg-zinc-50/60"}>
                    <td className="px-6 py-2.5 text-xs text-zinc-400 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-sm">
                      {r.studentCode}
                      {r.flagged && <span className="ml-1 text-amber-600" title="Không có trong roster LMS">⚠</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{r.fullName}</div>
                      {r.attendanceNote && (
                        <div className="text-[11px] text-zinc-500 mt-0.5 italic" title="Ghi chú GV">
                          📝 {r.attendanceNote}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-600">{r.className || className || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-zinc-500 tabular-nums">{fmtClock(r.checkinAt)}</td>
                    {isLmsLinked && (
                      <td className="px-3 py-2.5 text-xs text-zinc-500">
                        {r.checkinSource === "lms" ? "LMS" : r.checkinSource === "presenter" ? "Presenter" : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {STATUS_ORDER.map((s) => {
                          const isActive = active === s;
                          const meta = STATUS_META[s];
                          return (
                            <button
                              key={s}
                              onClick={() => handleSetStatus(r.participantId, s, r.attendanceNote)}
                              disabled={!r.participantId}
                              className={`w-7 h-7 rounded text-xs border transition-all ${
                                isActive
                                  ? `${meta.cls} ring-2 ${meta.ring} font-bold`
                                  : "border-zinc-200 hover:border-zinc-400 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed"
                              }`}
                              title={meta.label + (r.attendanceManualOverride && isActive ? " (GV chỉnh tay)" : "")}
                            >
                              {meta.icon}
                            </button>
                          );
                        })}
                        {r.attendanceManualOverride && (
                          <span className="text-[10px] text-violet-700 ml-1" title="GV chỉnh tay — auto sẽ không đè">✏️</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={isLmsLinked ? 7 : 6} className="px-6 py-12 text-center text-sm text-zinc-500">
                    Chưa có SV nào{isLmsLinked ? " trong roster LMS" : " tham gia"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Danh sách KHÁCH (ngoài danh sách lớp) — không vào sổ điểm danh */}
        {guests.length > 0 && (
          <div className="px-6 py-3 border-t border-zinc-200 bg-sky-50/40 shrink-0 max-h-56 overflow-y-auto">
            <div className="text-sm font-semibold text-sky-800 mb-2">
              👤 Khách (ngoài danh sách): {guestCount}
              {dupGuestCount > 0 && (
                <span className="ml-2 text-xs font-normal text-amber-700">
                  · ~{distinctGuestDevices} thiết bị thực · {dupGuestCount} đăng ký trùng máy
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-zinc-500">
                  <th className="px-2 py-1 w-7">#</th>
                  <th className="px-2 py-1">Tên / Mã</th>
                  <th className="px-2 py-1">Lớp</th>
                  <th className="px-2 py-1 whitespace-nowrap">Giờ vào</th>
                  <th className="px-2 py-1">Thiết bị</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-100">
                {guests.map((g, i) => {
                  const tag = g.deviceId ? guestDeviceTag.get(g.deviceId) : undefined;
                  return (
                    <tr key={`${g.studentCode}_${i}`} className={tag ? "bg-amber-50/60" : ""}>
                      <td className="px-2 py-1.5 text-zinc-400 tabular-nums">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-zinc-800">{g.fullName || g.studentCode}</span>
                        {g.studentCode && !g.studentCode.startsWith("guest_") && (
                          <span className="ml-1.5 text-xs text-zinc-400 font-mono">{g.studentCode}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-600">{g.className || "—"}</td>
                      <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap">{fmtTime(g.joinedAt)}</td>
                      <td className="px-2 py-1.5">
                        {tag ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap">
                            ⚠ cùng máy #{tag}
                          </span>
                        ) : (
                          <span className="text-[11px] text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-zinc-500 mt-2">
              Khách KHÔNG vào sổ điểm danh. Dòng tô vàng “cùng máy” = nhiều khách đăng ký từ 1 thiết bị (thường là đăng ký thử).
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-zinc-500">
            Auto: T₀+{lateCutoffMinutes}p → muộn · T₀+{absentAfterMinutes}p → vắng. GV bấm icon trạng thái để override.
            {isLmsLinked && <span className="ml-1 text-emerald-700 font-medium">· Đồng bộ realtime với LMS</span>}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100 font-medium"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
