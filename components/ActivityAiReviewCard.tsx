"use client";

/**
 * Hiển thị nhận xét AI cho 1 hoạt động (đã đóng).
 *
 * Tự chạy AI ngay khi hoạt động chuyển sang status="closed" (nếu auto bật + có key).
 * Kết quả lưu vào Convex (activities.aiReview), tránh gen lại mỗi lần reload.
 *
 * Key gửi trực tiếp browser → provider qua HTTPS. Server Convex không nhìn thấy key.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { runActivityReview, snapshotHasData } from "@/lib/activityReviewClient";
import { MODELS, PROVIDER_INFO, type Provider } from "@/lib/aiModels";
import { AiClientError } from "@/lib/aiClient";

const MODEL_KEY = "ai-review-activity-model";
const AUTO_KEY = "ai-review-activity-auto";

type Props = {
  activity: Doc<"activities">;
  // Có thể không truyền — component tự đọc snapshot
};

export function ActivityAiReviewCard({ activity }: Props) {
  // Auto toggle (localStorage)
  const [autoEnabled, setAutoEnabled] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(AUTO_KEY);
      if (v === "false") setAutoEnabled(false);
    } catch {}
  }, []);

  // Model select (localStorage)
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

  // API key check
  const dbKeys = useQuery(api.userProfiles.getMyAiApiKeys);
  const currentKey = (dbKeys?.[provider] ?? "").trim();

  // Snapshot
  const snapshot = useQuery(
    api.activityAiReview.getReviewSnapshot,
    activity.status === "closed" ? { activityId: activity._id } : "skip"
  );

  const setReview = useMutation(api.activityAiReview.setActivityAiReview);
  const clearReview = useMutation(api.activityAiReview.clearActivityAiReview);

  const [stage, setStage] = useState<"idle" | "running" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string>("");
  const triggeredRef = useRef<string>(""); // activityId đã trigger để tránh gọi lại

  // Triggered key: tránh chạy lại nếu chỉ thay đổi state khác
  const triggerKey = `${activity._id}:${activity.aiReview?.createdAt ?? "none"}`;

  const runReview = async () => {
    if (!snapshot) return;
    if (!snapshotHasData(snapshot)) {
      setStage("error");
      setErrMsg("Không có dữ liệu để nhận xét (chưa có SV trả lời).");
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
      let msg = "Lỗi khi gọi AI";
      if (e instanceof AiClientError) msg = e.message;
      else if (e instanceof Error) msg = e.message;
      setErrMsg(msg);
      setStage("error");
    }
  };

  // Auto trigger
  useEffect(() => {
    if (!autoEnabled) return;
    if (activity.status !== "closed") return;
    if (activity.aiReview) return; // đã có
    if (snapshot === undefined) return; // đang load
    if (snapshot === null) return;
    if (!snapshotHasData(snapshot)) return;
    if (!currentKey) return;
    if (triggeredRef.current === triggerKey) return;
    if (stage === "running") return;

    triggeredRef.current = triggerKey;
    runReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.status, activity.aiReview, snapshot, currentKey, autoEnabled, triggerKey, stage]);

  // Reset triggered khi clear
  useEffect(() => {
    if (!activity.aiReview) {
      // Cho phép re-trigger nếu user clear
    }
  }, [activity.aiReview]);

  if (activity.status !== "closed") return null;

  const review = activity.aiReview;

  return (
    <div className="mx-auto max-w-5xl mt-6 rounded-2xl border border-violet-500/40 bg-violet-950/40 px-6 py-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          <div>
            <div className="text-violet-200 text-lg font-semibold">Nhận xét tự động</div>
            <div className="text-xs text-violet-300/70">
              {review
                ? `${PROVIDER_INFO[review.provider as Provider]?.label ?? review.provider} · ${review.model}`
                : "Sinh ngay khi đóng hoạt động"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-violet-200/80 cursor-pointer">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => {
                setAutoEnabled(e.target.checked);
                try {
                  localStorage.setItem(AUTO_KEY, e.target.checked ? "true" : "false");
                } catch {}
              }}
              className="accent-violet-400"
            />
            Tự động
          </label>
          <select
            value={selectedModelId}
            onChange={(e) => {
              setSelectedModelId(e.target.value);
              try {
                localStorage.setItem(MODEL_KEY, e.target.value);
              } catch {}
            }}
            className="bg-violet-900/40 border border-violet-700 rounded px-2 py-1 text-violet-100 text-xs focus:outline-none"
            title="Đổi model"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-zinc-900">
                {m.label}
              </option>
            ))}
          </select>
          {review ? (
            <button
              onClick={async () => {
                await clearReview({ activityId: activity._id });
                triggeredRef.current = ""; // reset để trigger lại
              }}
              className="px-2.5 py-1 bg-violet-700 hover:bg-violet-600 rounded text-white font-semibold"
              title="Xoá và sinh lại"
            >
              🔄 Sinh lại
            </button>
          ) : (
            <button
              onClick={() => {
                triggeredRef.current = "";
                runReview();
              }}
              disabled={stage === "running" || !currentKey}
              className="px-2.5 py-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white font-semibold"
            >
              {stage === "running" ? "Đang phân tích..." : "▶ Phân tích"}
            </button>
          )}
        </div>
      </div>

      {/* Running state */}
      {stage === "running" && !review && (
        <div className="flex items-center gap-3 text-violet-200/80 text-sm py-2">
          <div className="w-2 h-2 bg-violet-400 rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
          <div className="w-2 h-2 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
          <span>Đang phân tích kết quả...</span>
        </div>
      )}

      {/* Error */}
      {stage === "error" && (
        <div className="text-sm text-rose-200 bg-rose-950/40 border border-rose-800 rounded-lg px-3 py-2 mt-1">
          ⚠ {errMsg}
        </div>
      )}

      {/* No data hint khi không thể chạy */}
      {!review && stage === "idle" && snapshot !== undefined && !snapshotHasData(snapshot) && (
        <div className="text-sm text-violet-200/60 italic">
          Chưa có SV trả lời — không có dữ liệu để nhận xét.
        </div>
      )}

      {/* Result */}
      {review && (
        <div className="space-y-3">
          <div className="text-lg md:text-xl text-white leading-snug font-medium">
            {review.summary}
          </div>
          {review.observations.length > 0 && (
            <ul className="space-y-1.5 text-sm md:text-base text-violet-100/90 list-disc list-inside">
              {review.observations.map((o, i) => (
                <li key={i} className="leading-relaxed">{o}</li>
              ))}
            </ul>
          )}
          {review.suggestion && (
            <div className="mt-2 px-4 py-3 bg-amber-500/15 border border-amber-500/40 rounded-lg text-amber-100 text-sm md:text-base">
              <span className="font-semibold text-amber-300">💡 Gợi ý:</span> {review.suggestion}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
