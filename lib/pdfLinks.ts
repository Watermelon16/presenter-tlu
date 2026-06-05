"use client";

/**
 * Trích "liên kết trang" có sẵn trong file PDF (internal link annotations,
 * tức GoTo destinations) để biến thành hotspot — GV không phải vẽ lại tay.
 *
 * Toạ độ trả về ở dạng tỉ lệ 0..1, gốc top-left, khớp đúng model hotspot
 * (xem components/SlideHotspotLayer.tsx). Chỉ lấy link nội bộ (nhảy trang),
 * bỏ qua link mở URL ngoài.
 */

import { pdfjs } from "react-pdf";

// Worker đã được set ở PdfSlideViewer, set lại ở đây cho idempotent (nếu helper
// chạy trước khi viewer mount).
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export type ExtractedLink = {
  page: number; // trang chứa link (1-based)
  x: number;
  y: number;
  w: number;
  h: number;
  targetPage: number; // trang đích (1-based)
};

// pdfjs annotation typings khá lỏng — khai báo tối thiểu phần ta dùng.
type LinkAnnotation = {
  subtype?: string;
  rect?: number[];
  dest?: unknown;
  url?: string;
  // PowerPoint export link "đến slide N" thành URI action giá trị là số trang
  // trần. pdfjs không nhận ra GoTo → dest/url rỗng, số nằm ở unsafeUrl.
  unsafeUrl?: string;
};

export async function extractPdfLinks(fileUrl: string): Promise<ExtractedLink[]> {
  const pdf = await pdfjs.getDocument(fileUrl).promise;
  const out: ExtractedLink[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const annots = (await page.getAnnotations()) as LinkAnnotation[];

    for (const a of annots) {
      if (a.subtype !== "Link") continue;
      if (!a.rect || a.rect.length < 4) continue;

      // Tìm trang đích từ 1 trong 2 dạng:
      let targetPage: number | null = null;

      if (a.dest && !a.url) {
        // (1) GoTo destination chuẩn — resolve ra chỉ số trang.
        let dest: unknown = a.dest;
        if (typeof dest === "string") {
          dest = await pdf.getDestination(dest);
        }
        if (Array.isArray(dest) && dest.length > 0) {
          const ref = dest[0];
          let targetIndex: number | null = null;
          if (typeof ref === "number") {
            targetIndex = ref;
          } else if (ref && typeof ref === "object") {
            try {
              // ref là RefProxy {num, gen}
              targetIndex = await pdf.getPageIndex(ref as Parameters<typeof pdf.getPageIndex>[0]);
            } catch {
              targetIndex = null;
            }
          }
          if (targetIndex != null) targetPage = targetIndex + 1;
        }
      } else if (!a.dest) {
        // (2) Link "đến slide N" bị export thành số trang trần (PowerPoint).
        // pdfjs để giá trị ở url/unsafeUrl; nhận diện nếu là số nguyên thuần.
        const raw = (a.url ?? a.unsafeUrl ?? "").toString().trim();
        if (/^\d+$/.test(raw)) {
          const n = parseInt(raw, 10);
          if (n >= 1 && n <= pdf.numPages) targetPage = n;
        }
      }

      if (targetPage == null) continue;
      if (targetPage === pageNum) continue; // bỏ link tự trỏ về chính nó

      // rect PDF (gốc bottom-left) → viewport (gốc top-left).
      const r = viewport.convertToViewportRectangle(a.rect);
      const vx1 = Math.min(r[0], r[2]);
      const vy1 = Math.min(r[1], r[3]);
      const vx2 = Math.max(r[0], r[2]);
      const vy2 = Math.max(r[1], r[3]);
      const x = vx1 / viewport.width;
      const y = vy1 / viewport.height;
      const w = (vx2 - vx1) / viewport.width;
      const h = (vy2 - vy1) / viewport.height;
      if (w <= 0 || h <= 0) continue;

      out.push({ page: pageNum, x, y, w, h, targetPage });
    }
  }

  return out;
}
