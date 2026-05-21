"use client";

import { Suspense, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VnInput } from "@/components/VnInput";

export default function JoinRoomPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <JoinRoomForm />
    </Suspense>
  );
}

// Lấy hoặc tạo deviceId cố định cho thiết bị này (để chống điểm danh hộ)
function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "presenter_tlu_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    // Tạo UUID đơn giản (random + timestamp)
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

function JoinRoomForm() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [className, setClassName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasRememberedIdentity, setHasRememberedIdentity] = useState(false);

  // Tự động điền mã phòng khi sinh viên quét QR (URL có ?code=...)
  // + Tự động điền identity từ lần trước (localStorage global)
  useEffect(() => {
    const qrCode = searchParams.get("code");
    if (qrCode) setCode(qrCode.toUpperCase());

    // Đọc identity đã lưu (nhớ qua các phòng)
    try {
      const saved = localStorage.getItem("student_identity_global");
      if (saved) {
        const parsed = JSON.parse(saved) as { studentCode: string; fullName: string; className: string };
        if (parsed.studentCode && parsed.fullName && parsed.className) {
          setStudentCode(parsed.studentCode);
          setFullName(parsed.fullName);
          setClassName(parsed.className);
          setHasRememberedIdentity(true);
        }
      }
    } catch {
      // bỏ qua nếu JSON lỗi
    }
  }, [searchParams]);

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
      const upperCode = code.trim().toUpperCase();
      const identity = {
        studentCode: studentCode.trim(),
        fullName: fullName.trim(),
        className: className.trim(),
      };

      await joinSession({
        code: upperCode,
        ...identity,
        deviceId: getOrCreateDeviceId(),
      });

      // Lưu identity: per-room (để room page khỏi hỏi lại) + global (nhớ qua phòng khác)
      localStorage.setItem(`student_${upperCode}`, JSON.stringify(identity));
      localStorage.setItem("student_identity_global", JSON.stringify(identity));

      router.push(`/room/${upperCode}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể tham gia phòng. Vui lòng kiểm tra lại mã.";
      setError(msg);
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
                placeholder="VD: A7K9P2"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono text-lg tracking-[4px]"
                maxLength={8}
              />
            </div>

            <div className="pt-2 border-t">
              <p className="text-sm font-medium mb-3">Thông tin sinh viên (bắt buộc)</p>
              {hasRememberedIdentity && (
                <div className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  ✓ Đã nhớ thông tin của bạn. Bạn chỉ cần nhập mã phòng và bấm Tham gia.
                </div>
              )}
              
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-zinc-600 mb-1.5 block">Mã sinh viên</label>
                  <VnInput
                    placeholder="2351150001"
                    value={studentCode}
                    onValueChange={setStudentCode}
                    className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </div>

                <div>
                  <label className="text-sm text-zinc-600 mb-1.5 block">Họ và tên</label>
                  <VnInput
                    placeholder="Trần Văn An"
                    value={fullName}
                    onValueChange={setFullName}
                    className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </div>

                <div>
                  <label className="text-sm text-zinc-600 mb-1.5 block">Lớp</label>
                  <VnInput
                    placeholder="VD: 65C"
                    value={className}
                    onValueChange={setClassName}
                    className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
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
