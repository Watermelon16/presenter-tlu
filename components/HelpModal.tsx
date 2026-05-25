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
                <strong>Chuẩn bị hoạt động</strong>: bấm <Btn>+ Tạo hoạt động</Btn> chọn loại, hoặc
                FAB <Btn tone="violet">✨</Btn> góc phải dưới để AI gen nhanh
                (1 hoạt động / từ PDF / khảo sát).
              </li>
              <li>
                <strong>Đính Mốc slide</strong> cho mỗi hoạt động (vd: <code>5</code>) — khi chiếu
                slide 5, sidebar tự nhận diện & cho phép kích hoạt / xem kết quả nhanh.
              </li>
              <li>
                <strong>Khi thuyết trình</strong>: bấm <Btn>S</Btn> chiếu slide PDF fullscreen → các
                phím tắt tiện ngay tại đó:
                <ul className="list-disc pl-5 mt-1 text-xs space-y-0.5">
                  <li><Btn>A</Btn> kích hoạt hoạt động · <Btn>X</Btn> đóng · <Btn>R</Btn> xem kết quả · <Btn>⇧R</Btn> chạy lại</li>
                  <li><Btn>C</Btn> ẩn QR sidebar · <Btn>K</Btn> QR mini widget (cho SV vào muộn) · <Btn>B</Btn> blank đen</li>
                  <li><Btn>L</Btn> laser · <Btn>P</Btn> bút · <Btn>Y</Btn> highlight · <Btn>G</Btn> gôm tẩy · <Btn>W</Btn> bảng trắng · <Btn>Z</Btn> undo</li>
                  <li><Btn>M</Btn> bảng điểm danh · <Btn>I</Btn> Smart Insights · <Btn>E</Btn> Excel</li>
                  <li>Bấm <Btn>H</Btn> bất cứ lúc nào để hiện bảng phím tắt floating</li>
                </ul>
              </li>
              <li>
                Opentext có đáp án mẫu → sau khi đóng có nút <Btn tone="violet">🤖 Chấm AI</Btn>.
                Mỗi hoạt động đóng đều có nhận xét AI tự sinh ngay phía trên kết quả.
              </li>
              <li>
                Cuối buổi: bấm <Btn>I</Btn> để mở Smart Insights tổng thể, hoặc xuất Excel
                bằng <Btn>E</Btn>.
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
          <Section title="⌨ Phím tắt khi thuyết trình">
            <p className="text-xs text-zinc-600 mb-3">
              💡 Bấm <Btn>H</Btn> bất cứ lúc nào để hiện bảng phím tắt floating ngay trên màn hình.
            </p>
            <div className="space-y-3">
              {/* Hoạt động */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-1.5">Hoạt động</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <KbdRow keys={["A"]} label="Kích hoạt hoạt động kế tiếp" />
                  <KbdRow keys={["X"]} label="Đóng hoạt động đang chạy" />
                  <KbdRow keys={["R"]} label="Xem kết quả + công bố đáp án" />
                  <KbdRow keys={["Shift", "R"]} label="🔄 Chạy lại hoạt động đang focus" />
                  <KbdRow keys={["T"]} label="Đổi tab Kết quả ↔ Bảng thành tích" />
                </div>
              </div>
              {/* Chiếu slide */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-1.5">Chiếu slide</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <KbdRow keys={["S"]} label="Mở/đóng chiếu slide PDF fullscreen" />
                  <KbdRow keys={["Q"]} label="Chiếu QR + mã phòng fullscreen" />
                  <KbdRow keys={["K"]} label="Hiện/ẩn QR mini widget góc trái — cho SV đến muộn quét nhanh" />
                  <KbdRow keys={["B"]} label="Blank đen — tạm dừng slide" />
                  <KbdRow keys={["C"]} label="Ẩn/hiện QR sidebar trong slide overlay" />
                  <KbdRow keys={["←", "→"]} label="Slide trước / sau" />
                  <KbdRow keys={["Space"]} label="Slide kế / bước script tiếp" />
                  <KbdRow keys={["Home"]} label="Slide đầu" />
                  <KbdRow keys={["End"]} label="Slide cuối" />
                  <KbdRow keys={["0-9", "↵"]} label="Nhảy đến slide cụ thể" />
                </div>
              </div>
              {/* Vẽ trên slide */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-1.5">Vẽ trên slide / Bảng trắng</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <KbdRow keys={["L"]} label="Laser pointer (dot đỏ phát sáng)" />
                  <KbdRow keys={["P"]} label="Bút vẽ tự do" />
                  <KbdRow keys={["Y"]} label="Highlight (bút dạ)" />
                  <KbdRow keys={["G"]} label="Gôm tẩy — xoá từng nét (drag để xoá liên tục)" />
                  <KbdRow keys={["W"]} label="Bật/tắt bảng trắng vẽ tự do" />
                  <KbdRow keys={["Z"]} label="Hoàn tác nét vẽ cuối" />
                  <KbdRow keys={["Shift", "D"]} label="Xoá hết nét vẽ slide/bảng hiện tại" />
                </div>
              </div>
              {/* Script + Menu */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-1.5">Menu nhanh + Script</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <KbdRow keys={[","]} label="Bước trước trong script" />
                  <KbdRow keys={["."]} label="Bước sau trong script" />
                  <KbdRow keys={["M"]} label="Mở bảng điểm danh" />
                  <KbdRow keys={["N"]} label="Mở Nhịp lớp (heatmap)" />
                  <KbdRow keys={["I"]} label="Mở Smart Insights AI" />
                  <KbdRow keys={["E"]} label="Xuất Excel phiên hiện tại" />
                </div>
              </div>
              {/* Khác */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-1.5">Khác</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <KbdRow keys={["H"]} label="Hiện/ẩn bảng phím tắt floating" />
                  <KbdRow keys={["Esc"]} label="Thoát overlay (auto về slide nếu vừa xem kết quả)" />
                </div>
              </div>
            </div>
          </Section>

          {/* ========== Section 4: Phiên dạy ========== */}
          <Section title="🔄 Phiên dạy & Chạy lại">
            <p className="text-sm text-zinc-700 mb-3">
              Trên topbar có cụm 2 nút <strong>Phiên mới</strong> + <strong>Chạy lại phiên</strong> — dùng khác nhau:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <div className="font-semibold text-blue-700 text-sm mb-1.5">🔄 Phiên mới</div>
                <div className="text-xs text-zinc-700 leading-relaxed">
                  Dạy <strong>lớp khác</strong> cùng nội dung. Hỏi xuất Excel phiên cũ → tạo phiên #N+1, giữ lịch sử cũ. SV cũ tự đăng ký lại khi reload (cùng mã phòng).
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <div className="font-semibold text-amber-700 text-sm mb-1.5">🔁 Chạy lại phiên</div>
                <div className="text-xs text-zinc-700 leading-relaxed">
                  Reset hoạt động về NHÁP <strong>cùng phiên</strong> (không đổi lớp). Xoá câu trả lời + board posts của phiên hiện tại. Dùng khi muốn chạy lại từ đầu mà chưa muốn tách phiên mới.
                </div>
              </div>
            </div>
            <p className="text-sm text-zinc-700 mb-1.5">Với từng hoạt động khi đang thuyết trình:</p>
            <ul className="text-sm space-y-1 list-disc pl-5 text-zinc-700">
              <li>
                <strong>Khi đang chiếu slide</strong>: sidebar bên phải tự nhận diện hoạt động gắn slide hiện tại (theo Mốc slide).
                Bấm <Btn tone="emerald">📊 Xem kết quả</Btn> để mở fullscreen, hoặc <Btn tone="blue">🔄 Chạy lại hoạt động</Btn> nếu muốn SV làm lại
                (vd: ít SV tham gia, muốn cho thêm thời gian).
              </li>
              <li>
                <strong>Trong dashboard</strong>: cạnh mỗi activity đã đóng có nút <Btn>👁 Xem</Btn> (mở overlay) và <Btn tone="blue">🔄 Chạy lại</Btn>.
              </li>
              <li>
                <strong>Trong overlay kết quả fullscreen</strong>: có nút <Btn tone="blue">🔄 Chạy lại</Btn> ở thanh trên.
              </li>
              <li className="text-xs text-zinc-500 italic mt-1">
                &ldquo;Chạy lại&rdquo; 1 hoạt động sẽ xoá câu trả lời cũ + nhận xét AI cũ, mở lại trạng thái active. KHÔNG đụng các hoạt động khác.
              </li>
            </ul>
            <p className="text-xs text-zinc-500 mt-2">
              Lịch sử các phiên cũ luôn được lưu — xuất Excel "tất cả phiên" để tổng hợp về sau.
            </p>
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
