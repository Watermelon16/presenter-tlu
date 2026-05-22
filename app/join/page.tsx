"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VnInput } from "@/components/VnInput";
import { Logo } from "@/components/Logo";

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
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

type StoredIdentity = { studentCode: string; fullName: string; className: string };

function readSavedIdentity(): StoredIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem("student_identity_global");
    if (!saved) return null;
    const parsed = JSON.parse(saved) as StoredIdentity;
    if (parsed.studentCode && parsed.fullName && parsed.className) return parsed;
    return null;
  } catch {
    return null;
  }
}

function JoinRoomForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const joinSession = useMutation(api.participants.joinSession);

  // Lazy init: đọc ngay tại first render, không dùng useEffect (tránh flash trống)
  const qrCode = (searchParams.get("code") || "").toUpperCase().trim();
  const [savedIdentity] = useState<StoredIdentity | null>(() => readSavedIdentity());
  const [code, setCode] = useState(qrCode);
  const [studentCode, setStudentCode] = useState(savedIdentity?.studentCode ?? "");
  const [fullName, setFullName] = useState(savedIdentity?.fullName ?? "");
  const [className, setClassName] = useState(savedIdentity?.className ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Auto-join khi: có ?code= (QR scan) + có identity đã lưu
  const autoJoinFired = useRef(false);
  const [autoJoining, setAutoJoining] = useState(qrCode && !!savedIdentity);

  useEffect(() => {
    if (autoJoinFired.current) return;
    if (!qrCode || !savedIdentity) return;
    autoJoinFired.current = true;

    (async () => {
      try {
        await joinSession({
          code: qrCode,
          ...savedIdentity,
          deviceId: getOrCreateDeviceId(),
        });
        localStorage.setItem(`student_${qrCode}`, JSON.stringify(savedIdentity));
        localStorage.setItem("student_identity_global", JSON.stringify(savedIdentity));
        router.replace(`/room/${qrCode}`);
      } catch (err: unknown) {
        // Auto-join thất bại (phòng đóng, mã sai, v.v.) → hiện form để SV sửa
        setAutoJoining(false);
        const msg = err instanceof Error ? err.message : "Không thể tự động vào phòng. Vui lòng kiểm tra mã.";
        setError(msg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Đang auto-join (QR + saved identity) → splash screen
  if (autoJoining) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <Logo size="lg" />
          </div>
          <div className="text-4xl animate-pulse">📡</div>
          <div className="text-zinc-700 font-medium">Đang vào phòng {qrCode}...</div>
          <div className="text-xs text-zinc-500">
            {savedIdentity?.fullName} · {savedIdentity?.studentCode}
          </div>
        </div>
      </div>
    );
  }

  const hasRememberedIdentity = !!savedIdentity;
  const codeFromQr = qrCode.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size="md" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Tham gia buổi giảng</h1>
          <p className="text-zinc-600 mt-2">
            {codeFromQr ? "Đã có mã phòng từ QR" : "Nhập mã phòng và thông tin của bạn"}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Thông tin tham gia</CardTitle>
            <CardDescription>
              Thông tin sẽ được nhớ cho các lần sau — chỉ cần điền 1 lần
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mã phòng — chỉ hiện input nếu KHÔNG có QR; có QR thì hiện badge */}
            {codeFromQr ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-emerald-700 font-medium tracking-wider">MÃ PHÒNG (từ QR)</div>
                  <div className="font-mono text-2xl tracking-[4px] font-semibold text-emerald-900">{code}</div>
                </div>
                <button
                  onClick={() => {
                    // Cho phép nhập tay nếu QR sai
                    router.replace("/join");
                    setCode("");
                  }}
                  className="text-xs text-emerald-700 hover:underline"
                >
                  Đổi mã
                </button>
              </div>
            ) : (
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
            )}

            <div className="pt-2 border-t">
              <p className="text-sm font-medium mb-3">Thông tin sinh viên</p>
              {hasRememberedIdentity && (
                <div className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  ✓ Đã nhớ thông tin từ lần trước. Sửa nếu cần.
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
              Thông tin sẽ được lưu trên máy này. Lần sau quét QR sẽ tự động vào phòng.
            </p>
          </CardContent>
        </Card>

        <div className="text-center mt-4">
          <Link
            href={
              studentCode.trim()
                ? `/me?code=${encodeURIComponent(studentCode.trim())}`
                : "/me"
            }
            className="text-sm text-zinc-600 hover:text-zinc-900 underline underline-offset-4"
          >
            🏆 Xem thành tích của tôi qua các buổi
          </Link>
        </div>
      </div>
    </div>
  );
}
