# Minotara — Setup

## 1. Cài đặt

```bash
npm install
```

## 2. Build database cho app (một lần, trên máy bạn)

Từ `oxford.db` của forms-kit (đã có bảng `forms`, `form_type_label`):

```bash
node scripts/build-app-db.js ~/Desktop/PROJECT/EX/T/oxford-forms-kit/oxford.db
# → oxford-app.db (~vài trăm MB): entries + forms + search_index, đã VACUUM
```

## 3. Đưa db vào app (dev)

Cách dễ nhất — serve qua LAN, app tự tải ở màn đầu (SCR-00):

```bash
npx serve .   # thư mục chứa oxford-app.db, mặc định port 3000
```

Mở app → màn "Chuẩn bị từ điển" → sửa URL thành `http://<IP-máy-bạn>:3000/oxford-app.db` → Tải về. (IP máy: `ipconfig getifaddr en0` trên macOS / `ipconfig` trên Windows. Điện thoại và máy cùng Wi-Fi.)

## 4. Chạy

```bash
npx expo run:android   # hoặc run:ios — cần dev build vì dùng expo-sqlite
npm test               # 27 unit test cho lookup / import / SRS / vi-cache
```

Lưu ý: **không dùng được Expo Go** (expo-sqlite cần native build). `expo run:android` sẽ tự build dev client lần đầu.

## Cấu trúc

```
src/db/         open.ts (file DUY NHẤT chạm expo-sqlite) · user.ts (migrations) · types.ts (DbLike)
src/services/   lookup (4-case) · srs (Leitner+Anki) · import-parser/matcher · vi-meaning · audio
src/stores/     app.ts (zustand mirror của settings trong user.db)
src/app/        (tabs)/ tra cứu · từ của tôi · ôn tập · cài đặt  +  word/[q] · import · history · onboarding
scripts/        build-app-db.js
test/           services.test.ts — chạy trên Node bằng better-sqlite3 giả lập DbLike
```

## Đã có / chưa có

Đã chạy theo spec: tra từ + gợi ý form-of, màn chi tiết 4 case (banner, tab homograph, bảng biến thể, nghĩa Việt cache-first, YouGlish link-out), lưu từ, import dán text (nghĩa user, resolve form→lemma, cứu hộ match thấp), ôn tập flashcard (learning steps, trần 20 thẻ mới, fuzz, tự đọc lặp 3s), lịch sử, cài đặt.

Chưa làm (phase sau): import từ file .txt/.csv (hiện dán text — thêm `expo-document-picker` là xong), swipe-to-delete (đang dùng long-press), gói audio offline (§0.3 tier 1, cần ATTACH → chuyển op-sqlite), dark mode cho các màn từ điển, ts-fsrs.

## Đổi expo-sqlite → op-sqlite sau này

Toàn bộ services chỉ biết interface `DbLike`. Viết lại duy nhất `src/db/open.ts`.
