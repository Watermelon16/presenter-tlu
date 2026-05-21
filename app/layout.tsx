import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Presenter TLU",
  description: "Công cụ tương tác giảng dạy thời gian thực - Đại học Thủy Lợi",
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider>
          <div className="flex-1">{children}</div>
          <footer className="border-t border-zinc-200/50 dark:border-zinc-800/50 py-2 px-3 text-center text-[9px] sm:text-[10px] md:text-[11px] text-zinc-500 select-none whitespace-nowrap overflow-hidden">
            © {new Date().getFullYear()} <span className="font-medium text-zinc-600 dark:text-zinc-400">TS. Lê Hồng Phương</span>
            <span> · </span>
            <span className="hidden sm:inline">Bộ môn Thủy công · </span>
            <span className="sm:hidden">BM Thủy công · </span>
            <span className="hidden sm:inline">Trường Đại học Thủy lợi</span>
            <span className="sm:hidden">ĐH Thủy lợi</span>
          </footer>
        </ConvexClientProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
