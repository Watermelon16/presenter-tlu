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
    icon: "/favicon.ico",
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
          <footer className="border-t border-zinc-200/50 dark:border-zinc-800/50 py-3 px-4 text-center text-[11px] text-zinc-500 select-none">
            © {new Date().getFullYear()} <span className="font-medium text-zinc-600 dark:text-zinc-400">TS. Lê Hồng Phương</span> — Bộ môn Thủy công, Trường Đại học Thủy lợi
          </footer>
        </ConvexClientProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
