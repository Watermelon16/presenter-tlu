"use client";

import { Button } from "@/components/ui/button";

interface Props {
  onClose: () => void;
}

export function HelpModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6 flex flex-col max-h-[calc(100vh-3rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold">📖 Hướng dẫn sử dụng nhanh</h2>
            <p className="text-xs text-zinc-500">Workflow + phím tắt + tính năng AI</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          {/* ========== Section 1: Quick start workflow ========== */}
          <Section title="🚀 Bắt đầu nhanh">
            <ol className="text-sm space-y-2 list-decimal pl-5 text-zinc-700">
              <li>
                <strong>Tạo hoạt động</strong>: bấm <Btn>+ Tạo hoạt động</Btn> → chọn loại
                (poll, quiz, wordcloud, rating, opentext, qa, board)
              </li>
              <li>
                <strong>Hoặc dùng AI</strong> để gen nhanh: dropdown <Btn tone="violet">🤖 AI</Btn> →
                <ul className="list-disc pl-5 mt-1 text-xs space-y-0.5">
                  <li><strong>Từ slide PDF</strong>: upload PDF → AI gen 5-10 hoạt động bám sát slide</li>
                  <li><strong>Khảo sát từ chủ đề</strong>: nhập topic → AI gen survey (rating + opentext + poll)</li>
                </ul>
              </li>
              <li>
                Bấm <Btn tone="emerald">▶ Bắt đầu</Btn> trên hoạt động → SV trả lời được
              </li>
              <li>
                Bấm <Btn tone="red">⏹ Đóng</Btn> khi xong. Cho opentext có đáp án mẫu → bấm{" "}
                <Btn tone="violet">🤖 Chấm AI</Btn>
              </li>
              <li>
                Cuối buổi: <Btn tone="violet">🤖 AI → Smart insights</Btn> để AI phân tích tổng thể buổi
              </li>
            </ol>
          </Section>

          {/* ========== Section 2: Topbar map ========== */}
          <Section title="🗺 Bản đồ topbar">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <Card title="🎬 Chiếu (vàng)">
                Slide PDF, Bảng thành tích, QR mã phòng — những gì hiện lên màn chiếu cho SV
              </Card>
              <Card title="🤖 AI (tím)">
                Gen activity từ PDF, Khảo sát từ chủ đề, Smart insights cuối buổi
              </Card>
              <Card title="💾 Xuất (xanh lục)">
                Excel phiên hiện tại, Excel tất cả phiên (sau khi dạy nhiều lớp)
              </Card>
              <Card title="⚙️ Cài đặt">
                Hướng dẫn, API key, Cấu hình điểm thành tích, Text lớn, Kết thúc buổi
              </Card>
            </div>
          </Section>

          {/* ========== Section 3: Keyboard shortcuts ========== */}
          <Section title="⌨ Phím tắt">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <KbdRow keys={["Q"]} label="Chiếu QR + mã phòng fullscreen" />
              <KbdRow keys={["S"]} label="Chiếu slide PDF fullscreen" />
              <KbdRow keys={["A"]} label="Kích hoạt hoạt động kế tiếp" />
              <KbdRow keys={["X"]} label="Đóng hoạt động đang chạy" />
              <KbdRow keys={["Esc"]} label="Thoát overlay" />
              <KbdRow keys={["←", "→"]} label="Chuyển slide (trong overlay slide)" />
              <KbdRow keys={["Space"]} label="Slide kế / bước tiếp script" />
              <KbdRow keys={["Home"]} label="Về slide đầu" />
              <KbdRow keys={["End"]} label="Slide cuối" />
              <KbdRow keys={["0-9", "↵"]} label="Nhảy đến slide cụ thể (gõ số + Enter)" />
            </div>
          </Section>

          {/* ========== Section 4: Phiên dạy ========== */}
          <Section title="🔄 Phiên dạy nhiều lớp">
            <p className="text-sm text-zinc-700 mb-2">
              1 buổi giảng có thể dạy cho nhiều lớp khác nhau (cùng nội dung). Mỗi lần là 1 <strong>phiên</strong>:
            </p>
            <ul className="text-sm space-y-1.5 list-disc pl-5 text-zinc-700">
              <li>
                Sau buổi đầu, bấm <Btn tone="blue">🔄 Phiên mới</Btn> ở topbar (cạnh badge PHIÊN #N)
              </li>
              <li>Hỏi có xuất Excel phiên cũ không → reset activities về NHÁP để dạy lại</li>
              <li>SV cũ tự đăng ký lại khi reload (cùng mã phòng)</li>
              <li>Lịch sử các phiên cũ vẫn lưu — xuất Excel tất cả phiên sau cùng</li>
            </ul>
          </Section>

          {/* ========== Section 5: AI key ========== */}
          <Section title="🔑 API key cho AI">
            <p className="text-sm text-zinc-700 mb-2">
              App dùng 3 provider AI để tránh phụ thuộc 1 chỗ:
            </p>
            <ul className="text-sm space-y-1.5 list-disc pl-5 text-zinc-700">
              <li>
                <strong>Gemini</strong>: server có key sẵn, dùng được luôn. Nhập key cá nhân để dùng quota riêng.
              </li>
              <li>
                <strong>DeepSeek</strong>: cần nạp ≥ $2 (đã bỏ free credit). Model rẻ.
              </li>
              <li>
                <strong>OpenRouter</strong>: free tier 50 req/ngày trên model <code>:free</code>. Khuyên dùng nếu Gemini hết quota.
              </li>
            </ul>
            <p className="text-xs text-zinc-500 mt-2">
              Mở <strong>⚙️ → 🔑 API key</strong> để paste key.
            </p>
          </Section>

          {/* ========== Section 6: Sinh viên ========== */}
          <Section title="🎓 Sinh viên tham gia">
            <ul className="text-sm space-y-1.5 list-disc pl-5 text-zinc-700">
              <li>
                SV vào <code className="text-xs bg-zinc-100 px-1 rounded">{`<your-domain>/join`}</code> + nhập mã phòng
              </li>
              <li>Hoặc scan QR (bấm <Btn>Q</Btn> để chiếu QR fullscreen)</li>
              <li>Bật Web Push notification trên điện thoại → SV thấy thông báo ngay khi GV kích hoạt hoạt động</li>
              <li>Xem lịch sử thành tích qua các buổi: <code className="text-xs bg-zinc-100 px-1 rounded">/me</code> + nhập mã SV</li>
            </ul>
          </Section>
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end bg-zinc-50 shrink-0">
          <Button onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-900 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Btn({ children, tone }: { children: React.ReactNode; tone?: "emerald" | "red" | "violet" | "blue" }) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : tone === "red"
        ? "bg-red-100 text-red-800 border-red-200"
        : tone === "violet"
          ? "bg-violet-100 text-violet-800 border-violet-200"
          : tone === "blue"
            ? "bg-blue-100 text-blue-800 border-blue-200"
            : "bg-zinc-100 text-zinc-800 border-zinc-200";
  return <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>{children}</span>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 rounded-lg p-3 bg-zinc-50/50">
      <div className="font-semibold text-zinc-800 mb-1">{title}</div>
      <div className="text-zinc-600 leading-relaxed">{children}</div>
    </div>
  );
}

function KbdRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-300 rounded shadow-sm text-zinc-800"
          >
            {k}
          </kbd>
        ))}
      </div>
      <span className="text-zinc-700">{label}</span>
    </div>
  );
}
