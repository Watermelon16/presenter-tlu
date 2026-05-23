"use client";

import { useEffect } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";

export default function PendingPage() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const me = useQuery(api.userProfiles.me);

  const status = me?.profile?.status;
  const isBanned = status === "banned";

  // Auto-redirect khi admin duyệt — useQuery reactive nên sẽ tự cập nhật
  // status khi admin patch DB, không cần manual refresh.
  useEffect(() => {
    if (status === "approved") {
      toast.success("✓ Admin đã duyệt tài khoản — đang chuyển vào hệ thống...");
      const t = setTimeout(() => {
        router.replace("/");
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [status, router]);

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <Logo size="lg" showText={false} href={null} />
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              {status === "approved"
                ? "✅ Đã được duyệt"
                : isBanned
                  ? "🚫 Tài khoản bị khoá"
                  : "⏳ Đang chờ duyệt"}
            </CardTitle>
            <CardDescription>
              {status === "approved"
                ? "Admin đã phê duyệt. Đang chuyển vào trang chủ..."
                : isBanned
                  ? "Admin đã khoá tài khoản này. Liên hệ admin để biết lý do."
                  : "Tài khoản của bạn đang chờ admin phê duyệt. Trang này sẽ tự chuyển khi admin duyệt — không cần refresh."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {me?.user && (
              <div className="text-sm bg-zinc-50 border border-zinc-200 rounded-lg p-3 space-y-0.5">
                <div>
                  <strong>Email:</strong> {me.user.email}
                </div>
                {me.user.name && (
                  <div>
                    <strong>Tên:</strong> {me.user.name}
                  </div>
                )}
                <div className="text-xs text-zinc-500 mt-1">
                  Status: <span className="font-mono">{status ?? "unknown"}</span>
                </div>
              </div>
            )}
            <Button variant="outline" onClick={() => signOut()} className="w-full">
              Đăng xuất
            </Button>
            <Link
              href="/join"
              className="block text-center text-sm text-emerald-700 hover:underline"
            >
              🎓 Tôi là sinh viên — vào phòng học →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
