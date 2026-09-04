# Devic3 — kho tài khoản mã hoá và đồng bộ nhiều thiết bị

Devic3 lưu dữ liệu trong trình duyệt bằng **IndexedDB** và mã hoá bằng **AES-256-GCM**. Dữ liệu `localStorage` từ bản cũ được tự động sao chép sang IndexedDB nhưng không bị xoá, nên nâng cấp không làm mất kho hiện có.

Google Drive chỉ nhận một file JSON đã mã hoá trong thư mục ẩn riêng của ứng dụng (`appDataFolder`). GitHub chỉ chứa source code; không chứa kho tài khoản, mật khẩu chính hay OAuth access token.

## Phương án chạy khuyến nghị

- Dùng **GitHub Pages** để mở cùng một địa chỉ HTTPS trên PC, iPhone và iPad.
- Dùng **Google Drive Sync** trong Devic3 để chuyển kho mã hoá giữa các thiết bị.
- Định kỳ bấm **Backup dữ liệu hiện tại** để có thêm file `.json` mã hoá dự phòng.
- Chỉ dùng server Node.js cục bộ trên PC khi cần đọc OTP Microsoft. Không đưa server cục bộ lên Internet.

## A. Đưa giao diện lên GitHub Pages

1. Tạo repository GitHub. Repository public chỉ được chứa source, tuyệt đối không commit file backup hoặc token.
2. Đưa các file source trong thư mục này lên repository.
3. Trên GitHub, mở **Settings → Pages**.
4. Trong **Build and deployment**, chọn **Deploy from a branch**.
5. Chọn nhánh đang dùng (thường là `main`) và thư mục `/ (root)`, rồi bấm **Save**.
6. Chờ địa chỉ dạng `https://TEN-CUA-BAN.github.io/TEN-REPO/D3vic3.html` hoạt động.
7. Luôn dùng đúng URL HTTPS này trên mọi thiết bị. Mỗi tên miền/origin có một kho IndexedDB riêng.

Nên thêm vào `.gitignore` nếu có lưu backup trong thư mục dự án:

```gitignore
devic3-vault-*.json
*.vault.json
.env
```

## B. Tạo Google OAuth Client ID

1. Mở [Google Cloud Console](https://console.cloud.google.com/) và tạo project riêng, ví dụ `Devic3 Sync`.
2. Vào **APIs & Services → Library**, tìm **Google Drive API** và bấm **Enable**.
3. Vào **Google Auth Platform / OAuth consent screen**:
   - Gmail cá nhân thường chọn **External**.
   - Điền tên ứng dụng và email hỗ trợ.
   - Nếu ứng dụng ở trạng thái **Testing**, thêm các tài khoản Google sẽ dùng vào **Test users**.
4. Vào **Clients → Create client → Web application**.
5. Trong **Authorized JavaScript origins**, thêm chính xác:

   ```text
   https://TEN-CUA-BAN.github.io
   ```

   Chỉ nhập origin, không thêm tên repository hoặc `/D3vic3.html`.
6. Nếu thử trên máy tính, thêm:

   ```text
   http://127.0.0.1:8765
   ```

7. Tạo client và sao chép **Client ID** có đuôi `.apps.googleusercontent.com`.
8. Không tạo hoặc chép **Client secret** vào Devic3. Ứng dụng web này không cần client secret.

Devic3 chỉ yêu cầu scope `https://www.googleapis.com/auth/drive.appdata`. Quyền này chỉ cho ứng dụng đọc/ghi thư mục ẩn riêng của chính nó, không đọc các file Drive thông thường.

## C. Thiết bị đầu tiên

1. Mở Devic3 từ GitHub Pages và mở kho bằng mật khẩu chính.
2. Bấm **Sao lưu / Khôi phục** trên thanh công cụ.
3. Tại **Đồng bộ nhiều thiết bị**, dán Google OAuth Client ID.
4. Bấm **Kết nối / Đồng bộ ngay**, đăng nhập đúng tài khoản Google và chấp nhận quyền.
5. Devic3 tạo `devic3-vault-sync.json` đã mã hoá trong `appDataFolder`.
6. Bấm **Backup dữ liệu hiện tại** và cất file `.json` ở nơi an toàn.

Trong phiên đang kết nối, mỗi thay đổi được tự đồng bộ sau khoảng 1,5 giây. Access token Google chỉ nằm trong RAM của tab; sau khi đóng hoặc tải lại trang, bấm **Kết nối / Đồng bộ ngay** để cấp lại phiên. Devic3 không lưu refresh token Google.

## D. iPhone hoặc iPad

1. Mở đúng URL GitHub Pages bằng Safari.
2. Chọn **Chia sẻ → Thêm vào Màn hình chính**.
3. Ở màn hình tạo kho, bấm **Khôi phục kho mã hoá từ Google Drive**.
4. Dán cùng Google OAuth Client ID, đăng nhập cùng tài khoản Google.
5. Nhập mật khẩu chính của kho sau khi tải xong.
6. Trước khi sửa trên thiết bị này, vào **Sao lưu / Khôi phục → Kết nối / Đồng bộ ngay** để lấy bản mới nhất.

Nếu Safari chặn cửa sổ đăng nhập, tạm tắt chặn popup/content blocker cho trang GitHub Pages rồi thử lại. Google yêu cầu đăng nhập bắt đầu từ một lần bấm của người dùng.

## E. Quy trình tránh xung đột

1. Mở thiết bị A → kết nối và đồng bộ.
2. Sửa dữ liệu trên A → chờ đồng bộ hoàn tất.
3. Trước khi dùng thiết bị B → kết nối và đồng bộ để nhận bản mới.
4. Tránh sửa đồng thời trên hai thiết bị đang ngoại tuyến.

Nếu cả hai bản đều thay đổi, Devic3 không tự ghi đè mà cho chọn:

- **Dùng bản trên Google Drive**: thay kho thiết bị bằng bản Drive.
- **Giữ bản trên thiết bị**: ghi bản thiết bị lên Drive.
- **Huỷ**: không thay đổi để có thể xuất backup trước khi quyết định.

Ứng dụng không tự trộn hai kho vì có thể làm sống lại tài khoản đã xoá hoặc mất chỉnh sửa.

## F. Chạy server cục bộ để đọc OTP Microsoft

GitHub Pages là dịch vụ tĩnh nên không chạy được endpoint Node.js đọc OTP. Trên PC:

1. Cài Node.js 18 hoặc mới hơn.
2. Mở PowerShell trong thư mục dự án.
3. Chạy `npm start`.
4. Mở `http://127.0.0.1:8765/D3vic3.html`.

Server chỉ lắng nghe tại `127.0.0.1`; iPhone/iPad không thể gọi server này qua GitHub Pages. Muốn đọc OTP trên mọi thiết bị cần một backend HTTPS riêng có đăng nhập và quản lý bí mật; không công khai server hiện tại.

### Microsoft OAuth cho OTP

1. Vào Microsoft Entra admin center → **App registrations → New registration**.
2. Chọn loại tài khoản hỗ trợ Outlook/Hotmail cá nhân.
3. Trong **Authentication**, bật public client cho ứng dụng cục bộ.
4. Thêm Microsoft Graph Delegated `Mail.Read`.
5. Lấy refresh token bằng OAuth authorization-code flow với scope `offline_access https://graph.microsoft.com/Mail.Read`.
6. Trong Devic3, điền **Email**, **Refresh Token Mail**, **Client ID Mail**.

Không dùng mật khẩu email/cookie Hotmail và không gửi token thật khi kiểm thử hoặc nhờ hỗ trợ.

## G. Kiểm thử

Chạy `npm test`. Kiểm thử dùng dữ liệu giả, không cần Google/Microsoft token thật.

## Lưu ý bảo mật

- File `.json` đã mã hoá vẫn cần được giữ kín; dùng mật khẩu chính mạnh và riêng biệt.
- Quên mật khẩu chính đồng nghĩa không thể giải mã bản local hoặc Drive.
- `appDataFolder` không phải bản sao lưu duy nhất. Luôn giữ thêm backup thủ công.
- Không commit backup, refresh token, access token hoặc dữ liệu tài khoản lên GitHub.
- Trên máy lạ, không bật **Giữ đăng nhập khi tải lại trang** và nhớ bấm **Khoá**.
