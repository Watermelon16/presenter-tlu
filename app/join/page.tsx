"use client";

import { Suspense, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function JoinRoomPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <JoinRoomForm />
    </Suspense>
  );
}

function JoinRoomForm() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");

  // Tự động điền mã phòng khi sinh viên quét QR (URL có ?code=...)
  useEffect(() => {
    const qrCode = searchParams.get("code");
    if (qrCode) setCode(qrCode.toUpperCase());
  }, [searchParams]);
  const [studentCode, setStudentCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [className, setClassName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const joinSession = useMutation(api.participants.joinSession);
  const router = useRouter();

  const handleJoin = async () => {
    if (!code.trim() || !studentCode.trim() || !fullName.trim() || !className.trim()) {
      setError("Vui lòng điền đầy đủ thông tin");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      await joinSession({
        code: code.trim(),
        studentCode: studentCode.trim(),
        fullName: fullName.trim(),
        className: className.trim(),
      });

      // Sau khi join thành công, chuyển vào phòng (sẽ phát triển sau)
      router.push(`/room/${code.trim().toUpperCase()}`);
    } catch (err: any) {
      setError(err.message || "Không thể tham gia phòng. Vui lòng kiểm tra lại mã.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Tham gia buổi giảng</h1>
          <p className="text-zinc-600 mt-2">Nhập mã phòng và thông tin của bạn</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Thông tin tham gia</CardTitle>
            <CardDescription>
              Thông tin này sẽ được sử dụng để ghi nhận hoạt động và đánh giá
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Mã phòng</label>
              <Input
                placeholder="VD: TLU234"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono text-lg tracking-[4px]"
                maxLength={8}
              />
            </div>

            <div className="pt-2 border-t">
              <p className="text-sm font-medium mb-3">Thông tin sinh viên (bắt buộc)</p>
              
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-zinc-600 mb-1.5 block">Mã sinh viên</label>
                  <Input
                    placeholder="2351150001"
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm text-zinc-600 mb-1.5 block">Họ và tên</label>
                  <Input
                    placeholder="Trần Văn An"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm text-zinc-600 mb-1.5 block">Lớp</label>
                  <Input
                    placeholder="65CTL1 - Công trình Thủy lợi"
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md">{error}</p>
            )}

            <Button
              onClick={handleJoin}
              disabled={isLoading || !code.trim() || !studentCode.trim() || !fullName.trim() || !className.trim()}
              className="w-full h-11 text-base mt-2"
            >
              {isLoading ? "Đang tham gia..." : "Tham gia phòng"}
            </Button>

            <p className="text-xs text-center text-zinc-500">
              Thông tin của bạn sẽ được ghi nhận trong suốt buổi giảng
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
