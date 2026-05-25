"use client";

/**
 * Nhận xét nhanh hiển thị inline trong result panel.
 * Tự sinh ngay khi hoạt động chuyển sang closed (nếu auto bật + có key).
 * UI cố ý giữ trung tính, không phô trương "AI" — như một note tóm tắt.
 *
 * Key gửi trực tiếp browser → provider qua HTTPS. Server không thấy key.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { runActivityReview, snapshotHasData } from "@/lib/activityReviewClient";
import { MODELS, type Provider } from "@/lib/aiModels";
import { AiClientError } from "@/lib/aiClient";

const MODEL_KEY = "ai-review-activity-model";
const AUTO_KEY = "ai-review-activity-auto";

type Props = {
  activity: Doc<"activities">;
};

export function ActivityAiReviewCard({ activity }: Props) {
  const [autoEnabled, setAutoEnabled] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(AUTO_KEY);
      if (v === "false") setAutoEnabled(false);
    } catch {}
  }, []);

  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    if (typeof window === "undefined") return MODELS[0].id;
    try {
      return localStorage.getItem(MODEL_KEY) || MODELS[0].id;
    } catch {
      return MODELS[0].id;
    }
  });
  const modelDef = MODELS.find((m) => m.id === selectedModelId) ?? MODELS[0];
  const provider: Provider = modelDef.provider;

  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);
  const currentKey = (dbKeys?.[provider] ?? "").trim();

  const snapshot = useQuery(
    api.activityAiReview.getReviewSnapshot,
    activity.status === "closed" ? { activityId: activity._id } : "skip"
  );

  const setReview = useMutation(api.activityAiReview.setActivityAiReview);
  const clearReview = useMutation(api.activityAiReview.clearActivityAiReview);

  const [stage, setStage] = useState<"idle" | "running" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string>("");
  const [showMenu, setShowMenu] = useState(false);
  const triggeredRef = useRef<string>("");

  const triggerKey = `${activity._id}:${activity.aiReview?.createdAt ?? "none"}`;

  const runReview = async () => {
    if (!snapshot) return;
    if (!snapshotHasData(snapshot)) {
      setStage("error");
      setErrMsg("Chưa có dữ liệu để nhận xét.");
      return;
    }
    if (!currentKey) {
      setStage("error");
      setErrMsg(`Chưa có API key ${provider}. Mở ⚙️ Cài đặt → 🔑 API key.`);
      return;
    }
    setStage("running");
    setErrMsg("");
    try {
      const { result } = await runActivityReview({
        snapshot,
        provider,
        model: modelDef.id,
        apiKey: currentKey,
      });
      await setReview({
        activityId: activity._id,
        summary: result.summary,
        observations: result.observations,
        suggestion: result.suggestion,
        provider,
        model: modelDef.id,
      });
      setStage("idle");
    } catch (e: unknown) {
      let msg = "Lỗi khi sinh nhận xét";
      if (e instanceof AiClientError) msg = e.message;
      else if (e instanceof Error) msg = e.message;
      setErrMsg(msg);
      setStage("error");
    }
  };

  // Auto trigger sau khi đóng
  useEffect(() => {
    if (!autoEnabled) return;
    if (activity.status !== "closed") return;
    if (activity.aiReview) return;
    if (snapshot === undefined || snapshot === null) return;
    if (!snapshotHasData(snapshot)) return;
    if (!currentKey) return;
    if (triggeredRef.current === triggerKey) return;
    if (stage === "running") return;

    triggeredRef.current = triggerKey;
    runReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.status, activity.aiReview, snapshot, currentKey, autoEnabled, triggerKey, stage]);

  if (activity.status !== "closed") return null;

  const review = activity.aiReview;
  const snapshotLoading = snapshot === undefined;
  const hasNoData = snapshot !== undefined && snapshot !== null && !snapshotHasData(snapshot);

  // Không hiện gì nếu hoạt động đóng nhưng chưa ai trả lời (board: chưa ai post)
  if (!review && hasNoData && stage !== "error") return null;

  return (
    <div className="mx-auto max-w-5xl mt-6 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-5 py-4 text-left relative">
      {/* Menu nhỏ ở góc phải — LUÔN hiện khi card hiện */}
      <div className="absolute top-2 right-2 z-30">
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-200 text-sm leading-none"
          title="Tuỳ chọn"
        >
          ⋯
        </button>
        {showMenu && (
          <div
            className="absolute right-0 top-7 w-64 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl py-2 text-xs"
            onMouseLeave={() => setShowMenu(false)}
          >
            <label className="flex items-center justify-between px-3 py-1.5 hover:bg-zinc-800 cursor-pointer">
              <span className="text-zinc-300">Tự động khi đóng hoạt động</span>
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => {
                  setAutoEnabled(e.target.checked);
                  try {
                    localStorage.setItem(AUTO_KEY, e.target.checked ? "true" : "false");
                  } catch {}
                }}
                className="accent-emerald-500"
              />
            </label>
            <div className="px-3 py-1.5 border-t border-zinc-800">
              <div className="text-zinc-500 mb-1">Model</div>
              <select
                value={selectedModelId}
                onChange={(e) => {
                  setSelectedModelId(e.target.value);
                  try {
                    localStorage.setItem(MODEL_KEY, e.target.value);
                  } catch {}
                }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="text-zinc-500 mt-1 text-[10px]">
                Provider: <span className="text-zinc-400">{provider}</span>
                {!currentKey && <span className="text-rose-400"> · thiếu key</span>}
              </div>
            </div>
            {review && (
              <button
                onClick={async () => {
                  setShowMenu(false);
                  await clearReview({ activityId: activity._id });
                  triggeredRef.current = "";
                }}
                className="w-full text-left px-3 py-1.5 border-t border-zinc-800 text-zinc-300 hover:bg-zinc-800"
              >
                🔄 Sinh lại
              </button>
            )}
          </div>
        )}
      </div>

      {/* Snapshot đang load */}
      {snapshotLoading && !review && (
        <div className="text-sm text-zinc-500">Đang tải kết quả...</div>
      )}

      {/* Chưa có API key */}
      {!snapshotLoading && !review && !currentKey && stage === "idle" && (
        <div className="text-sm text-zinc-400">
          Chưa có API key {provider}. Mở <strong className="text-zinc-200">⚙️ Cài đặt → 🔑 API key AI</strong> để bật nhận xét tự động.
        </div>
      )}

      {/* Có key + chưa chạy (auto tắt hoặc snapshot vừa load) */}
      {!snapshotLoading && !review && currentKey && stage === "idle" && !hasNoData && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-zinc-400">
            {autoEnabled ? "Đang chuẩn bị nhận xét..." : "Tự động đang tắt."}
          </div>
          <button
            onClick={() => {
              triggeredRef.current = "";
              runReview();
            }}
            className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-200"
          >
            ▶ Sinh nhận xét
          </button>
        </div>
      )}

      {/* Loading state — pulse dots */}
      {stage === "running" && !review && (
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse" />
          <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
          <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
          <span>Đang phân tích kết quả...</span>
        </div>
      )}

      {/* Error */}
      {stage === "error" && !review && (
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm text-rose-300">⚠ {errMsg}</div>
          <button
            onClick={() => {
              triggeredRef.current = "";
              runReview();
            }}
            className="text-xs text-zinc-400 hover:text-white underline shrink-0"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Result */}
      {review && (
        <div className="space-y-2.5">
          {/* Summary — dòng đầu hơi nổi bật */}
          <div className="text-base md:text-lg text-zinc-100 leading-snug font-medium pr-8">
            {review.summary}
          </div>

          {/* Observations — bullet kín đáo */}
          {review.observations.length > 0 && (
            <ul className="space-y-1 text-sm text-zinc-300">
              {review.observations.map((o, i) => (
                <li key={i} className="leading-relaxed flex gap-2">
                  <span className="text-zinc-500 shrink-0">·</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Gợi ý — màu vàng nhẹ */}
          {review.suggestion && (
            <div className="text-sm text-amber-200/90 border-l-2 border-amber-500/60 pl-3 mt-2">
              {review.suggestion}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
