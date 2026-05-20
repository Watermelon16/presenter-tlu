"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CreateRoomPage() {
  const [title, setTitle] = useState("");
  const [hostName, setHostName] = useState("");
  const [collectStudentCode, setCollectStudentCode] = useState(true); // Mặc định bật thu thập mã SV
  const [isLoading, setIsLoading] = useState(false);

  const createSession = useMutation(api.sessions.createSession);
  const router = useRouter();

  const handleCreateRoom = async () => {
    if (!title.trim()) {
      toast.error("Vui lòng nhập tên buổi giảng");
      return;
    }

    setIsLoading(true);
    try {
      const result = await createSession({
        title: title.trim(),
        hostName: hostName.trim() || undefined,
        collectStudentCode,
      });

      // Chuyển đến trang Presenter
      router.push(`/presenter/${result.code}`);
    } catch (error) {
      console.error(error);
      toast.error("Không thể tạo phòng. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Presenter TLU</h1>
          <p className="text-zinc-600 mt-2">Công cụ tương tác giảng dạy — Đại học Thủy Lợi</p>
          <p className="text-xs text-zinc-500 mt-3">
            Phát triển bởi <span className="font-medium text-zinc-700">TS. Lê Hồng Phương</span>
            <br />Bộ môn Thủy công, Trường Đại học Thủy lợi
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tạo phòng mới</CardTitle>
            <CardDescription>
              Sinh viên sẽ tham gia bằng mã phòng hoặc quét QR
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Tên buổi giảng</label>
              <Input
                placeholder="Ví dụ: Đập và Hồ chứa - Buổi 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Tên giảng viên (tùy chọn)</label>
              <Input
                placeholder="TS. Lê Hồng Phương"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
              />
            </div>

            {/* Toggle thu thập mã sinh viên */}
            <div className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3">
              <div>
                <div className="text-sm font-medium">Thu thập mã sinh viên để tính điểm</div>
                <div className="text-xs text-zinc-500 mt-0.5">Sinh viên phải nhập Mã SV + Họ tên khi tham gia</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={collectStudentCode}
                  onChange={(e) => setCollectStudentCode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-0 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            <Button
              onClick={handleCreateRoom}
              disabled={isLoading || !title.trim()}
              className="w-full h-11 text-base"
            >
              {isLoading ? "Đang tạo phòng..." : "Tạo phòng và bắt đầu"}
            </Button>

            <p className="text-xs text-center text-zinc-500 pt-2">
              Mã phòng sẽ được tạo tự động và hiển thị sau khi tạo thành công
            </p>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <a 
            href="/join" 
            className="text-sm text-zinc-600 hover:text-zinc-900 underline underline-offset-4"
          >
            Sinh viên? Tham gia phòng tại đây
          </a>
        </div>
      </div>
    </div>
  );
}
