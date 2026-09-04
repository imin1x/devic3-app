# Devic3 cục bộ

## Chạy ứng dụng

1. Cài Node.js 18 hoặc mới hơn.
2. Mở PowerShell trong thư mục này.
3. Chạy `npm start`.
4. Mở `http://127.0.0.1:8765/D3vic3.html`.

Không mở trực tiếp file HTML nếu muốn dùng tính năng đọc OTP và không đưa server này lên Internet.

## Cấu hình Microsoft OAuth

1. Vào Microsoft Entra admin center → **App registrations** → **New registration**.
2. Chọn loại tài khoản có hỗ trợ tài khoản Microsoft cá nhân (Outlook/Hotmail).
3. Trong **Authentication**, bật luồng public client cho ứng dụng máy tính/cục bộ.
4. Trong **API permissions**, thêm quyền Microsoft Graph dạng **Delegated**: `Mail.Read`.
5. Thực hiện OAuth authorization-code flow với scope `offline_access https://graph.microsoft.com/Mail.Read` để nhận refresh token. Không dùng mật khẩu email hoặc cookie Hotmail.
6. Trong Devic3, sửa tài khoản Facebook và điền **Email**, **Refresh Token Mail**, **Client ID Mail**.
7. Mở chi tiết tài khoản rồi bấm **Đọc OTP** cạnh mã 2FA.

Refresh token và Client ID nằm trong kho dữ liệu đã mã hóa của Devic3. Backend chỉ trả mã OTP, người gửi, tiêu đề và thời gian; không trả nội dung thư.

## Kiểm thử

Chạy `npm test`. Kiểm thử dùng dữ liệu Microsoft giả, không cần token thật.
