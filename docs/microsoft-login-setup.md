# Setup đăng nhập Microsoft (@tlu.edu.vn) cho Presenter TLU

Để GV dùng email @tlu.edu.vn (Microsoft 365 của TLU) đăng nhập, cần đăng ký 1 app trên Microsoft Azure (Entra ID). Làm 1 lần, dùng mãi mãi.

## Bước 1 — Tạo App Registration trên Azure

1. Truy cập **https://portal.azure.com** → đăng nhập bằng tài khoản Microsoft bất kỳ (cá nhân hoặc @tlu.edu.vn đều được)
2. Search ở thanh trên: gõ **"App registrations"** → click vào kết quả
3. Click **"+ New registration"** (góc trên trái)
4. Điền form:
   - **Name**: `Presenter TLU`
   - **Supported account types**: chọn **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**
     - ⚠️ QUAN TRỌNG: chọn option này để accept tất cả @tlu.edu.vn lẫn @outlook.com cá nhân
   - **Redirect URI**:
     - Platform: **Web**
     - URI: `https://chatty-hornet-671.convex.site/api/auth/callback/microsoft-entra-id`
       - ⚠️ Sửa `chatty-hornet-671` thành deployment Convex thực tế (đã đúng cho production của bạn)
5. Click **Register** (góc dưới)

## Bước 2 — Lấy Application (client) ID

Sau khi register, bạn vào trang Overview của app vừa tạo.

- Copy giá trị **Application (client) ID** (UUID dạng `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- Lưu lại để gửi cho Claude / setup env

## Bước 3 — Tạo Client Secret

1. Sidebar trái → **Certificates & secrets**
2. Tab **Client secrets** → click **"+ New client secret"**
3. Description: `Presenter prod`
4. Expires: chọn **"24 months"** (tối đa, đỡ phải làm lại sớm)
5. Click **Add**
6. ⚠️ COPY NGAY giá trị **Value** của secret (dạng `xxxxx~xxxxxxxxxxxxxxx`) — Azure CHỈ HIỆN 1 LẦN, đóng trang là mất

## Bước 4 — Set permissions (mặc định đã có, chỉ verify)

Sidebar trái → **API permissions** → verify có:
- ✅ `Microsoft Graph > User.Read` (đã có sẵn — đủ rồi để lấy email + tên)

Nếu chưa có → Add a permission → Microsoft Graph → Delegated → search "User.Read" → tick → Add.

## Bước 5 — Gửi Claude 2 giá trị này

Claude sẽ set vào Convex env:

```
AUTH_MICROSOFT_ENTRA_ID_ID = <Application (client) ID từ Bước 2>
AUTH_MICROSOFT_ENTRA_ID_SECRET = <Value từ Bước 3>
```

## Bước 6 — Test login

1. Vào https://presenter-tlu.vercel.app/login
2. Click nút **"Đăng nhập với Microsoft (@tlu.edu.vn)"** (màu đen)
3. Microsoft login → chọn account @tlu.edu.vn → grant permission
4. Tự redirect về Presenter — tài khoản mới ở trạng thái **pending**
5. Admin (`phuonglh43@gmail.com`) vào trang **Admin** trên Presenter → approve account đó

## Sau khi setup xong

- ✅ Bất kỳ ai có email @tlu.edu.vn đều có thể login Presenter
- ✅ Cũng work cho @outlook.com, @hotmail.com, work account khác
- ✅ Admin phê duyệt từng người trước khi họ tạo phòng được
- ✅ Tự động liên kết với LMS qua `lmsEmail` (cùng email không cần map)

## Lưu ý bảo mật

- KHÔNG commit secret vào git
- Secret hết hạn sau 24 tháng → set calendar reminder để tạo lại
- Nếu nghi ngờ lộ secret → quay lại Bước 3, xóa secret cũ, tạo mới

## Troubleshooting

**Lỗi "redirect_uri_mismatch"**: kiểm tra Redirect URI ở Bước 1 chính xác từng ký tự, đặc biệt là phần `chatty-hornet-671.convex.site`. Sửa lại trong Authentication tab của app trên Azure.

**Lỗi "AADSTS50020: User account from identity provider does not exist in tenant"**: chọn sai supported account types. Quay lại Authentication → tick multitenant như Bước 1.

**Không thấy nút Microsoft trên Presenter**: env var chưa set. Báo Claude check `npx convex env list --prod`.
