"use client";

// QR + link cố định cho khảo sát "mở đến hạn" — GV chiếu/chia sẻ cho SV vào làm.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SurveyQrModal({
  url, title, deadlineLabel, onClose,
}: {
  url: string;
  title: string;
  deadlineLabel?: string;
  onClose: () => void;
}) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 512, color: { dark: "#000000", light: "#FFFFFF" } })
      .then(setDataUrl)
      .catch(() => {});
  }, [url]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-0.5">🗳 {title}</h3>
        <p className="text-xs text-zinc-500 mb-4">
          SV quét QR để làm khảo sát bất kỳ lúc nào{deadlineLabel ? ` trước ${deadlineLabel}` : ""}.
        </p>
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="QR khảo sát" className="w-56 h-56 mx-auto rounded-lg border border-zinc-200" />
        ) : (
          <div className="w-56 h-56 mx-auto bg-zinc-100 rounded-lg animate-pulse" />
        )}
        <div className="mt-4 flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-zinc-200 text-xs text-zinc-600 truncate"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(url).then(
                () => toast.success("Đã copy link"),
                () => toast.error("Không copy được")
              );
            }}
          >
            Copy
          </Button>
        </div>
        <Button variant="outline" className="mt-4 w-full" onClick={onClose}>Đóng</Button>
      </div>
    </div>
  );
}
