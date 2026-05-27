"use client";

import { Suspense, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";

// Chỉ chấp nhận internal path để chặn open redirect.
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

function LoginInner() {
  const { signIn } = useAuthActions();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [busy, setBusy] = useState<"google" | "microsoft" | null>(null);

  const handleGoogle = async () => {
    setBusy("google");
    try {
      await signIn("google", { redirectTo: next });
    } catch (e: unknown) {
      console.error(e);
      setBusy(null);
    }
  };

  const handleMicrosoft = async () => {
    setBusy("microsoft");
    try {
      await signIn("microsoft-entra-id", { redirectTo: next });
    } catch (e: unknown) {
      console.error(e);
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size="xl" showText={false} href={null} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Presenter <span className="text-emerald-600">TLU</span>
          </h1>
          <p className="text-zinc-600 mt-2">Đăng nhập dành cho giảng viên</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Đăng nhập</CardTitle>
            <CardDescription>
              Chọn tài khoản phù hợp với email của bạn. <strong>@tlu.edu.vn</strong> dùng Microsoft. Sinh viên không cần đăng nhập.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Microsoft — ưu tiên hiển thị trước vì @tlu.edu.vn dùng MS */}
            <Button
              onClick={handleMicrosoft}
              disabled={busy !== null}
              className="w-full h-11 text-base flex items-center justify-center gap-2 bg-[#2F2F2F] hover:bg-[#1F1F1F] text-white"
            >
              <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
              </svg>
              {busy === "microsoft" ? "Đang chuyển..." : "Đăng nhập với Microsoft (@tlu.edu.vn)"}
            </Button>

            <div className="flex items-center gap-3 my-1">
              <div className="h-px flex-1 bg-zinc-200" />
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider">hoặc</span>
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            <Button
              onClick={handleGoogle}
              disabled={busy !== null}
              variant="outline"
              className="w-full h-11 text-base flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                />
              </svg>
              {busy === "google" ? "Đang chuyển..." : "Đăng nhập với Google (Gmail)"}
            </Button>

            <div className="text-xs text-zinc-500 leading-relaxed bg-zinc-50 border border-zinc-200 rounded-lg p-3">
              <strong>Lần đầu đăng ký?</strong> Tài khoản mới ở trạng thái <em>chờ duyệt</em>. Admin sẽ phê duyệt
              trong vòng 24 giờ.
            </div>
          </CardContent>
        </Card>

        <div className="text-center mt-6 space-y-2 text-sm">
          <div>
            <Link href="/join" className="text-emerald-700 hover:underline font-medium">
              🎓 Tôi là sinh viên — vào phòng học →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams cần Suspense boundary trong App Router
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <LoginInner />
    </Suspense>
  );
}
