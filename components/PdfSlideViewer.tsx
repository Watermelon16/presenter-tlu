"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Config PDF.js worker — dùng file copy về public/ để hoạt động offline
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfSlideViewerProps {
  fileUrl: string;
  currentPage: number;
  onPageChange?: (page: number) => void;
  onTotalPagesLoaded?: (total: number) => void;
  className?: string;
}

/**
 * Render PDF slide fullscreen kiểu PowerPoint Slideshow.
 * Tự fit theo container, không bị scroll, ưu tiên chất lượng hiển thị cho máy chiếu.
 */
export function PdfSlideViewer({
  fileUrl,
  currentPage,
  onTotalPagesLoaded,
  className = "",
}: PdfSlideViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [numPages, setNumPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Theo dõi kích thước container để fit slide
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setLoadError(null);
    onTotalPagesLoaded?.(n);
  };

  const onDocumentLoadError = (err: Error) => {
    console.error("PDF load error:", err);
    setLoadError(err.message || "Không thể tải PDF");
  };

  // Tính size cho Page (giữ tỉ lệ A4 ngang ~16:9 sẽ tự fit)
  const pageHeight = Math.max(0, containerSize.height - 16);
  const pageWidth = Math.max(0, containerSize.width - 16);

  return (
    <div ref={containerRef} className={`w-full h-full bg-black flex items-center justify-center overflow-hidden ${className}`}>
      {loadError ? (
        <div className="text-red-400 text-center px-6">
          <div className="text-2xl mb-2">⚠️ Lỗi tải PDF</div>
          <div className="text-sm text-zinc-400">{loadError}</div>
        </div>
      ) : (
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="text-zinc-400 text-xl">Đang tải slide PDF...</div>
          }
          error={
            <div className="text-red-400">Không thể mở file PDF.</div>
          }
        >
          {numPages > 0 && containerSize.width > 0 && (
            <Page
              pageNumber={Math.min(Math.max(currentPage, 1), numPages)}
              height={pageHeight}
              width={pageWidth > pageHeight * 1.78 ? undefined : pageWidth}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              className="shadow-2xl"
            />
          )}
        </Document>
      )}
    </div>
  );
}
