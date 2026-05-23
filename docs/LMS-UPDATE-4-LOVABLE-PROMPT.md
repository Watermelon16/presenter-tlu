# Lovable prompt UPDATE 4 — Auto-join Presenter từ link LMS sau khi điểm danh

Paste vào Lovable.

---

## PROMPT

Hiện tại: sau khi SV scan QR LMS để điểm danh, nếu nhấn link "Vào phòng học tương tác" thì sang Presenter phải nhập lại mã sinh viên — rườm rà, ngược ý.

**Cần**: sau khi LMS verify checkin xong, link "Vào phòng" phải kèm sẵn MSV trong URL để Presenter tự động vào thẳng phòng, không phải nhập lại.

Presenter đã hỗ trợ URL format này — chỉ cần LMS pass param.

### URL format Presenter chấp nhận

```
https://presenter-tlu.vercel.app/room/<CODE>?sid=<MSV>
```

Tối giản nhất: chỉ cần `sid` (MSV). Presenter tự lookup họ tên + lớp từ roster đã sync.

Đầy đủ (vẫn ok, dùng khi LMS muốn tiết kiệm 1 DB lookup phía Presenter):
```
https://presenter-tlu.vercel.app/room/<CODE>?from_lms=1&sid=<MSV>&name=<encoded_name>&class=<class>
```

### Thay đổi cần làm

Trong trang/component sau khi SV scan QR điểm danh LMS thành công (file frontend xử lý checkin response):

**Trước đây** (hard-coded, ko pass sid):
```tsx
<a href={session.presenter_url}>Vào phòng học</a>
```

**Sửa thành**:
```tsx
{session.presenter_url && (
  <a
    href={`${session.presenter_url}?from_lms=1&sid=${encodeURIComponent(studentId)}`}
    target="_blank"
    rel="noopener noreferrer"
    className="..."
  >
    🎓 Vào phòng học tương tác (đã đăng nhập sẵn)
  </a>
)}
```

Trong đó `studentId` là MSV SV vừa nhập khi scan QR (đã có trong response của `attendance-qr/checkin` hoặc trong form state).

Nếu LMS có sẵn họ tên (từ `class_roster.student_name` lookup) thì gửi luôn cho speed:
```tsx
const url = new URL(session.presenter_url);
url.searchParams.set("from_lms", "1");
url.searchParams.set("sid", studentId);
if (studentName) url.searchParams.set("name", studentName);
if (className) url.searchParams.set("class", className);
```

### Test sau khi xong

1. SV scan QR LMS → nhập MSV 12345 → checkin thành công
2. Bấm link "Vào phòng học" → mở Presenter tab mới
3. Auto-join trong 1-2 giây → toast "✓ Chào [Họ tên] — đã vào phòng"
4. Không hiện form yêu cầu nhập lại MSV
5. URL sau load tự được clean (params bị remove khỏi history)

### Edge case

- SV chưa có trong roster Presenter cache → backend trả ConvexError "Mã sinh viên không có trong danh sách lớp" → Presenter toast lỗi đỏ. Trường hợp này hiếm vì roster đã sync khi LMS provision phòng. Nếu hay xảy ra → kiểm tra Lovable đã trigger sync-roster chưa (xem prompt UPDATE 2).

- SV mở link trên Safari iOS với app khác — URL param đôi khi bị cắt. Presenter đã có fallback `last_joined_code` từ localStorage. Không hỗ trợ thì SV sẽ thấy form join thủ công.
