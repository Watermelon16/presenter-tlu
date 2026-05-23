"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type Status = "present" | "late" | "excused" | "absent" | "early_leave";

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  present: { label: "Có mặt", cls: "bg-emerald-100 text-emerald-700" },
  late: { label: "Đi muộn", cls: "bg-amber-100 text-amber-700" },
  excused: { label: "Có phép", cls: "bg-sky-100 text-sky-700" },
  absent: { label: "Vắng", cls: "bg-rose-100 text-rose-700" },
  early_leave: { label: "Về sớm", cls: "bg-purple-100 text-purple-700" },
};

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function LmsAttendancePanel({ code }: { code: string }) {
  const state = useQuery(api.lms.getAttendanceState, { code });
  const [expanded, setExpanded] = useState(false);

  if (!state || !state.isLmsLinked) return null;

  const { counts, rows, rosterCount, className, attendanceOpenAt, lateCutoffMinutes, attendanceFinalizedAt } = state;
  const lateCutoffAt = attendanceOpenAt ? attendanceOpenAt + lateCutoffMinutes * 60_000 : null;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-600 text-white font-semibold">LMS</span>
          <span className="text-sm font-semibold text-zinc-800">
            Điểm danh{className ? ` · Lớp ${className}` : ""}
          </span>
          {attendanceFinalizedAt ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 font-medium">ĐÃ ĐÓNG</span>
          ) : attendanceOpenAt ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
              ĐÃ MỞ {formatTime(attendanceOpenAt)}
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
              CHƯA MỞ BUỔI ĐIỂM DANH
            </span>
          )}
          {lateCutoffAt && !attendanceFinalizedAt && (
            <span className="text-[10px] text-zinc-500">
              Muộn sau {formatTime(lateCutoffAt)}
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="px-3 py-1.5 text-xs rounded-lg bg-white border border-zinc-200 hover:bg-zinc-50 font-medium"
        >
          {expanded ? "Thu gọn" : `Xem danh sách (${rosterCount})`}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Có mặt" value={counts.present} color="emerald" />
        <Stat label="Đi muộn" value={counts.late} color="amber" />
        <Stat label="Có phép" value={counts.excused} color="sky" />
        <Stat label="Vắng" value={counts.absent} color="rose" />
        <Stat label="Chưa điểm danh" value={counts.notCheckedIn} color="zinc" />
      </div>

      {expanded && (
        <div className="mt-4 bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 sticky top-0">
                <tr className="text-left text-xs text-zinc-600">
                  <th className="px-3 py-2 font-medium">Mã SV</th>
                  <th className="px-3 py-2 font-medium">Họ tên</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Lúc</th>
                  <th className="px-3 py-2 font-medium">Quét tại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => {
                  const meta = r.attendanceStatus ? STATUS_META[r.attendanceStatus as Status] : null;
                  return (
                    <tr key={r.studentCode} className={r.flagged ? "bg-amber-50" : ""}>
                      <td className="px-3 py-2 font-mono text-xs">{r.studentCode}</td>
                      <td className="px-3 py-2">{r.fullName}</td>
                      <td className="px-3 py-2">
                        {meta ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${meta.cls}`}>
                            {meta.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400">chưa điểm danh</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">{formatTime(r.checkinAt)}</td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {r.checkinSource === "lms" ? "LMS" : r.checkinSource === "presenter" ? "Presenter" : "—"}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-500">
                      Roster trống. LMS sẽ đẩy danh sách khi tạo phòng.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "emerald" | "amber" | "sky" | "rose" | "zinc" }) {
  const cls = {
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    sky: "bg-sky-100 text-sky-700",
    rose: "bg-rose-100 text-rose-700",
    zinc: "bg-zinc-100 text-zinc-700",
  }[color];
  return (
    <div className={`rounded-lg px-3 py-2 ${cls}`}>
      <div className="text-xl font-semibold leading-none">{value}</div>
      <div className="text-[11px] mt-1 font-medium opacity-80">{label}</div>
    </div>
  );
}
