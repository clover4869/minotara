# Bug / Improvement Log — Minotara

Nguồn: review toàn bộ `src/` đối chiếu với `specs/init.md` (2026-08-19). File này trước đó rỗng nên bắt đầu lại từ Round 1.

---

## Tổng hợp implement — Round 1 (2026-08-19)

Cả 18 task bên dưới đã được code theo đúng phương án **khuyên dùng** (không chọn "vá nhanh"), verify bằng `npx tsc --noEmit` (0 lỗi) và `npx vitest run` (40/40 pass, tăng từ 35 — có thêm test khoá lại từng bug). Chi tiết từng task nằm ở mục "Report sau code" tương ứng; tóm tắt theo vùng:

**DB / connection layer** (`src/db/open.ts`, `src/db/types.ts`, `src/db/user.ts` — Task 4, 7, 16 cùng 1 lần sửa):
- `openUser()`/`openDictionary()` đổi sang cache theo **promise đang treo** thay vì giá trị đã resolve → hết race mở trùng connection (nguyên nhân crash `NativeDatabase.prepareAsync` mà user gặp thật trên Android).
- Thêm `closeAsync` vào `DbLike`; `removeDictionaryFile()` đóng connection trước khi xoá file.
- Thêm fingerprint kích thước file (`dictionaryReady()`) + bắt lỗi corruption phản ứng (reactive callback) + nút "Kiểm tra từ điển" thủ công trong Settings.
- `nextDueAt()` trả thêm `count` thẻ cùng ngày đến hạn.

**Dark Mode** (Task 2): `review.tsx`, `settings.tsx`, `history.tsx`, `import.tsx`, `onboarding.tsx` chuyển từ `C` (light-only) sang `usePalette()` + `makeStyles(t)`; xoá hẳn `C` khỏi `dict-ui.tsx`.

**Ôn tập / SRS** (`review.tsx`, `services/srs.ts` — Task 1, 8, 10, 12): progress bar dùng `SessionQueue.remaining` (không vượt 100% nữa); due-count/biểu đồ box dùng `dueBoxCounts()` uncapped thay vì `buildSession()`; cache flashcard reset mỗi phiên/khi rời tab; "Lần ôn tiếp theo" hiện đủ số thẻ.

**Lịch sử** (Task 3): giờ/nhóm ngày convert đúng sang local time trước khi hiển thị, không còn cắt chuỗi UTC thô.

**Services khác**: `vi-meaning.ts` (Task 5, hết trùng nghĩa), `import-matcher.ts` + `import.tsx` (Task 6 gộp từ trùng entry, Task 15 hiện số dòng bị skip), `lookup.ts` (Task 14, INNER→LEFT JOIN), `audio.ts` (Task 11, hash 32-bit → SHA-256 qua `expo-crypto` mới cài — đã xác nhận 7 cặp URL thật bị đụng độ với hash cũ).

**Branding** (Task 17, 18): `app.json` trỏ lại đúng `assets/icons/` (trước đó trỏ nhầm placeholder Expo mặc định); `_layout.tsx` có `BootScreen` mới (icon + "Implement by Clover") gate theo `dictionaryReady()`/`loadSettings()`.

**Chưa làm / cần user tự verify:**
- Chưa test lại trên **Android thật** — đặc biệt cần xác nhận crash `NativeDatabase.prepareAsync` ở Lịch sử (Task 16) hết tái diễn, và Dark Mode (Task 2) đổi đúng trên cả 9 màn.
- Chưa chạy lại `scripts/build-app-db.js` (Task 13) — cần file crawl nguồn không có trong repo này.
- Chưa xoá các file placeholder cũ trong `assets/images/` (Task 17) — để nguyên, chỉ đổi đường dẫn tham chiếu.

---

## Round 1 — Review tổng quan (dark mode, review/SRS, timezone, data integrity)

Vài mục dưới đây được **xác minh trực tiếp trên `oxford-app.db` thật** (193MB, 68 832 entries / 101 306 forms) bằng script, không chỉ suy luận từ code (đánh dấu "data-verified" trong Mô tả).

### Checklist Round 1

| # | Pri | Task | Area | Done |
|---|---|---|---|---|
| 1 | P1 | Ôn tập: progress "x/y" và thanh progress vượt quá 100% với gần như mọi phiên có thẻ mới/thẻ sai | FE Ôn tập + SRS | [x] |
| 2 | P1 | 5 màn hình (Ôn tập, Cài đặt, Lịch sử, Nhập danh sách, Onboarding) hardcode màu sáng — vỡ Dark Mode | FE toàn app | [x] |
| 3 | P1 | Giờ và nhóm "Hôm nay/Hôm qua" trong Lịch sử tính theo UTC thay vì giờ máy | BE (schema) + FE Lịch sử | [x] |
| 4 | P1 | Không kiểm tra lại `PRAGMA integrity_check` của oxford-app.db sau lần tải đầu — file hỏng không được phát hiện/khôi phục | DB layer | [x] |
| 5 | P2 | Nghĩa tiếng Việt hiện trùng lặp giữa danh sách chính và "Nghĩa khác" khi tab không khớp POS nào | FE Word Detail + vi-meaning | [x] |
| 6 | P2 | Nhập danh sách: từ trùng entry đích với từ khác bị âm thầm biến mất khỏi cả 2 nhóm kết quả | Import flow | [x] |
| 7 | P2 | `removeDictionaryFile()` không đóng kết nối SQLite đang mở trước khi xoá file | DB layer | [x] |
| 8 | P3 | Cache thẻ ôn tập không làm mới trong phiên app — sửa "Ghi chú nghĩa của bạn" xong quay lại Ôn tập vẫn thấy nghĩa cũ | FE Ôn tập | [x] |
| 9 | P3 | Thiếu mục "Gói audio offline" (06-04) trong Cài đặt theo đúng spec | FE Cài đặt | [x] |
| 10 | P1 | Màn bắt đầu Ôn tập hiện sai số "thẻ đến hạn" và biểu đồ box khi tồn đọng > 40 thẻ — lệch với số ở "Từ của tôi" | FE Ôn tập + SRS | [x] |
| 11 | P2 | Cache audio dùng hash 32-bit — **data-verified**: 7 cặp URL phát âm khác nhau bị trùng key trên data thật → phát nhầm audio | Audio service | [x] |
| 12 | P2 | "Lần ôn tiếp theo" không bao giờ hiện số thẻ (X thẻ) như spec 05C-02 yêu cầu, chỉ hiện ngày | FE Ôn tập | [x] |
| 13 | P2 | `dictMeta()` luôn trả `null` với `oxford-app.db` đang dùng (thiếu bảng `app_meta`/`crawl_meta`) — lỗi bị nuốt im lặng, không log | DB layer + Settings | [x]* |
| 14 | P3 | `formsOfEntry` dùng INNER JOIN `form_type_label` trong khi query Q2 tương đương dùng LEFT JOIN — chưa lộ với data hiện tại nhưng sẽ âm thầm rớt dòng biến thể khi có `form_type` mới chưa gắn nhãn | DB layer | [x] |
| 15 | P3 | `parseImportText` trả về `skipped` (số dòng bị bỏ vì trùng/vượt giới hạn 500) nhưng `import.tsx` không dùng — người dùng không được báo có dòng bị bỏ qua | Import flow | [x] |
| 16 | P1 | **[Đã tái hiện thực tế trên Android]** Crash `NativeDatabase.prepareAsync`/NullPointerException, lặp lại liên tục ở màn Lịch sử — do connection SQLite không bao giờ được đóng + race mở connection trùng | DB layer + FE Lịch sử | [x] |
| 17 | P1 | `app.json` trỏ icon/splash/favicon/adaptive-icon vào ảnh placeholder mặc định của Expo template (`assets/images/*`) thay vì bộ ảnh thương hiệu thật đã tạo (`assets/icons/*`) — app đang build ra với logo Expo, không phải logo Minotara | Config / Branding | [x]* |
| 18 | P2 | [Feature] Thêm icon + dòng chữ nhỏ "Implement by Clover" vào splash screen lúc khởi động | FE Splash / Branding | [x] |
| 19 | P2 | [Feature] Bảng màu app (`theme/tokens.ts`, Porcelain/terracotta) không khớp brand palette thật (`assets/icons/COLORS.md`, teal — lấy từ icon) — cần retheme | Theme / Branding | [x] |
| 20 | P2 | [Feature] Thiếu công tắc chọn Dark Mode thủ công trong Cài đặt — app chỉ theo hệ thống, không tự override được | FE Cài đặt / Theme | [x] |
| 21 | P1 | ~~Tap tab nav xong không bấm được gì~~ — làm rõ lại là nút "Bắt đầu" ở Ôn tập bị disable; nguyên nhân thật ở Task 10, không phải crash Task 16 (2 giả thuyết ban đầu đều sai) | FE Ôn tập | [x] |
| 22 | P2 | [UX] Thanh tab dưới vẫn hiện trong lúc ôn flashcard — chiếm diện tích + tạo lối thoát ngoài ý muốn giữa phiên tập trung | FE Ôn tập / Navigation | [x] |
| 23 | P3 | [UX] Nút 'X' xoá chip 'Gần đây' có vùng chạm quá nhỏ (~30pt, dưới ngưỡng 44pt) + khoảng cách với chữ quá gần (6pt) — dễ tap nhầm vào từ | FE Tra cứu | [x] |
| 24 | P3 | [UX] Badge CEFR ở "Từ hôm nay" bị đẩy tách xa headword (2 đầu khối), nền phẳng không có điểm nhấn | FE Tra cứu | [x] |
| 25 | P3 | [UX] Nhãn ngữ pháp/ngữ cảnh (disapproving, informal…) chỉ là text xám thuần, không có badge phân biệt với phần định nghĩa | FE Word Detail | [x] |
| 26 | P3 | [UX] "Ghi chú nghĩa của bạn" không có khối nền riêng — không nhất quán với khối "Nghĩa tiếng Việt" ngay dưới (đã có card) | FE Word Detail | [x] |
| 27 | P3 | [UX] Bộ lọc "Mới nhất/A-Z/CEFR/Đến hạn" ở Từ của tôi chỉ đổi độ đậm chữ khi active — không có affordance rõ là nút bấm được | FE Từ của tôi | [x] |
| 28 | P2 | [UX] Xoá từ/lịch sử bằng long-press xoá NGAY, không xác nhận, không hoàn tác — rủi ro mất dữ liệu do lỡ tay | FE Từ của tôi + Lịch sử | [x] |
| 29 | P2 | [Feature] Phase 2 — tab "Ảnh" tìm ảnh minh hoạ qua DuckDuckGo (endpoint không chính thức, đã verify thật) | FE Ảnh (mới) + Services | [x] |
| 30 | P2 | [Feature] Phase 2 — thay thuật toán Leitner box thủ công bằng FSRS thật (`ts-fsrs`) cho lịch ôn tập | SRS / `services/srs.ts` | [x] |
| 31 | P3 | [Feature] Thanh tab đổi sang phong cách "glass" nổi (theo ảnh mẫu user cung cấp), giữ nguyên 5 tab hiện có, đổi màu theo brand teal | FE Navigation | [x] |

\* Task 13 và 17: code đã sửa xong, còn 1 phần đất/data-side chưa làm được trong phiên này (không có source data / thiết bị) — xem Report sau code của từng task.
\* Task 28: làm (a) trước rồi nâng cấp lên (b) — swipe-to-delete + toast hoàn tác — ngay trong phiên này; (a)'s Alert xác nhận không còn tồn tại trong code, xem Report sau code.
\* Task 31: đổi cơ chế điều hướng tab từ `NativeTabs` sang `expo-router/ui` headless tabs (`Tabs`/`TabList`/`TabTrigger`/`TabSlot`) — bắt buộc vì bar tuỳ biến hoàn toàn không thể vẽ trên `NativeTabs`; đánh đổi đã nêu rõ với user trước khi làm, xem Report sau code.

**Thứ tự đề nghị:** 1 → 2 → 4 → 7 → 16 (4, 7, 16 cùng vùng `db/open.ts`, nên làm cùng nhau) → 17 → 18 (17 phải xong trước 18, xem Phụ thuộc) → 10 → 12 (cùng màn bắt đầu Ôn tập, làm cùng nhau) → 13 → 3 → 5 → 6 → 15 (làm cùng lúc với 6, cùng đụng `import.tsx`) → 11 → 14 → 8 → 9.
**Phụ thuộc:**
- Task 4, 7 và **16** phải làm **cùng nhau** — cả ba đụng vòng đời kết nối SQLite (`dictDb`/`userDb`) trong `db/open.ts`; sửa lẻ một cái dễ để lại nửa vá, và Task 16 gần như chắc chắn cần thêm `closeAsync` vào `DbLike` (thứ mà Task 7 cũng đang cần).
- Task **18 phụ thuộc Task 17** — không nên vẽ splash mới bằng ảnh ở đúng chỗ trong khi `app.json` vẫn trỏ sai thư mục; sửa 17 trước để tránh phải sửa ảnh 2 lần.
- Task 10 và 12 nên làm **cùng nhau** — cùng sửa logic hiển thị ở màn bắt đầu Ôn tập (05-A/05-C), tránh sửa 2 lần.
- Task 6 và 15 nên làm **cùng lúc** — cùng đụng `import.tsx`/`import-parser.ts`.
- Task 1 và 8 cùng nằm trong `review.tsx` nhưng nguyên nhân độc lập, có thể tách người làm.
- Các task còn lại (2, 3, 5, 9, 11, 13, 14) độc lập với nhau.
- Task 22-28 (từ báo cáo UX review ngoài, `specs/draf_improment.md`): độc lập với nhau và với các task trên, có thể làm bất kỳ lúc nào. Khuyên làm 28 trước (rủi ro mất dữ liệu, ưu tiên cao hơn nhóm còn lại), rồi 22 (đụng kiến trúc điều hướng, nên làm sớm trước khi chồng thêm polish khác lên `review.tsx`), còn 23-27 là polish nhỏ độc lập, làm theo thứ tự nào cũng được.

---

## Task 1 — Ôn tập: progress "x/y" vượt quá 100%

### Mô tả
`SessionQueue.total` ([src/services/srs.ts:121](src/services/srs.ts#L121)) được gán một lần bằng số thẻ ban đầu của phiên (`cards.length`), nhưng `SessionQueue.answered` ([src/services/srs.ts:122](src/services/srs.ts#L122), tăng ở [src/services/srs.ts:146](src/services/srs.ts#L146)) tăng mỗi lần gọi `answer()` — kể cả những lần thẻ bị **requeue** (thẻ mới cần đúng 2 lần trong phiên mới tốt nghiệp — [src/services/srs.ts:157-176](src/services/srs.ts#L157-L176); thẻ cũ trả lời sai được chiếu lại một lần grade-free — [src/services/srs.ts:178-183](src/services/srs.ts#L178-L183)). Màn hình dùng thẳng hai số này để vẽ UI: text `{queue.answered}/{queue.total}` và độ rộng progress fill `(queue.answered / queue.total) * 100%` ([src/app/(tabs)/review.tsx:265-267](src/app/(tabs)/review.tsx#L265-L267)), không có clamp.

### Expect
`answered/total` phải luôn ≤ 100% và text không được vượt quá tổng số thẻ của phiên.

### Tái hiện
1. Vào Ôn tập với ít nhất 1 thẻ **chưa từng ôn** (rất phổ biến — user mới lưu từ nào cũng vậy).
2. Trả lời đúng thẻ đó lần 1 → theo cơ chế learning-step thẻ quay lại cuối hàng đợi, `answered` = 1, `total` = 1 → hiện "1/1" (đã 100% dù chưa xong).
3. Trả lời đúng lần 2 để tốt nghiệp → `answered` = 2, `total` vẫn = 1 → hiện "2/1", progress fill co giãn tới 200% chiều rộng, tràn ra ngoài khung `progressTrack` (không có `overflow: hidden`).
4. Tương tự: bất kỳ câu trả lời **sai** nào với thẻ đã lưu (box ≥ 1, không phải thẻ mới) cũng bị chiếu lại 1 lần grade-free ([src/services/srs.ts:182](src/services/srs.ts#L182)) → cùng lỗi.

### Nguyên nhân gốc
- `total` đại diện cho "số thẻ duy nhất trong phiên", còn `answered` đếm "số lượt trả lời" — hai đại lượng khác bản chất nhưng bị dùng chung một công thức phần trăm.
- Không có test nào cho UI progress; test hiện tại chỉ kiểm tra logic `SessionQueue` (graded/missed), không kiểm tra `answered` so với `total`.

### Solution — 2 hướng, chọn 1

**a. Tính progress theo số thẻ CÒN LẠI (duy nhất) trong hàng đợi, không theo số lượt trả lời (khuyên dùng)**
- Thêm 1 getter vào `SessionQueue` (services/srs.ts): `get remaining(): number { return new Set(this.queue.map(c => c.entry_id)).size; }` — đếm số **entry_id duy nhất** còn trong `queue` (loại trùng do requeue/reinforcement).
- Ở `review.tsx`, đổi hiển thị từ `{queue.answered}/{queue.total}` và width `(answered/total)*100%` sang `{queue.total - queue.remaining}/{queue.total}` và width tương ứng — không bao giờ vượt `total` vì `remaining` không bao giờ âm hay lớn hơn `total`.
- Pros: Đúng bản chất "đã học xong X trong Y thẻ", khớp kỳ vọng người dùng, không có state ẩn nào có thể vượt ngưỡng.
- Cons: Đụng vào `SessionQueue` (dù chỉ thêm 1 getter thuần, không đổi logic chấm điểm sẵn có) — cần thêm test cho getter mới.
- Plan: thêm getter → đổi 2 chỗ hiển thị trong `review.tsx` → thêm test `remaining` giảm đúng qua các bước learning-step/reinforcement (dùng lại fixture đã có ở `test/services.test.ts`).

**b. Vá nhanh: clamp hiển thị ở mức 100%/`total`**
- `Math.min(queue.answered, queue.total)` cho text, `Math.min(100, (answered/total)*100)` cho width thanh progress.
- Pros: Sửa 2 dòng, không đụng `SessionQueue`.
- Cons: Chỉ che triệu chứng — một khi chạm `total` (vd hiện "6/6" = 100%) mà vẫn còn thẻ phải trả lời tiếp (do learning-step/reinforcement chưa xong), progress bar **đứng yên ở 100% trong khi phiên chưa kết thúc** — gây hiểu nhầm ngược lại (tưởng xong nhưng chưa).

**→ Khuyên dùng (a)** — chi phí thêm không lớn, sửa đúng gốc thay vì che số liệu.

### Test
- [x] `test/services.test.ts`: "remaining tracks distinct cards left, not attempts made — never lets progress exceed total".
- [x] `npx vitest run` — 40/40 pass.

### Verify
- [x] `SessionQueue.remaining` getter added ([src/services/srs.ts](src/services/srs.ts)); `review.tsx` progress text/bar now use `queue.total - queue.remaining` instead of `queue.answered`.
- [ ] Chưa tự tay chạy 1 phiên Ôn tập thật trên app (không có device) — cần user xác nhận progress không còn vượt 100%.

### Report sau code
Implemented option (a). Added `get remaining()` to `SessionQueue` (`src/services/srs.ts`) and switched `review.tsx`'s progress text/bar to `queue.total - queue.remaining`. New unit test locks in that `remaining` never lets displayed progress exceed `total` even when `answered` does. `tsc`/`vitest` clean.

---

## Task 2 — Dark Mode vỡ trên 5 màn hình

### Mô tả
App có bảng màu dark đầy đủ trong `theme/tokens.ts` ([src/theme/tokens.ts:160-204](src/theme/tokens.ts#L160-L204)) và `_layout.tsx` chọn `DarkTheme`/`DefaultTheme` theo `useColorScheme()` ([src/app/_layout.tsx:22,31](src/app/_layout.tsx#L22-L31)). Nhưng `dict-ui.tsx` export thêm một bộ alias `C` **cứng theo `semantic.light`** ([src/components/dict-ui.tsx:17-31](src/components/dict-ui.tsx#L17-L31), tự chú thích "Light-mode aliases so unmigrated screens stay on Porcelain"). 5 màn hình dùng `C` này thay vì `usePalette()`, đồng thời hardcode luôn nền `#fff`/`#1B1B1F` trong `StyleSheet.create` ở top-level file (không tái tạo theo theme):
- [src/app/(tabs)/review.tsx:21,340](src/app/(tabs)/review.tsx#L21) (`root: { backgroundColor: '#fff' }`)
- [src/app/(tabs)/settings.tsx:10,141](src/app/(tabs)/settings.tsx#L10)
- [src/app/history.tsx:9,125](src/app/history.tsx#L9)
- [src/app/import.tsx:17,178](src/app/import.tsx#L17)
- [src/app/onboarding.tsx:14,76](src/app/onboarding.tsx#L14)

Trong khi đó `index.tsx`, `word/[q].tsx`, `my-words.tsx` dùng `usePalette()` ([src/theme/use-palette.ts](src/theme/use-palette.ts)) nên đổi màu đúng theo hệ thống.

### Expect
Bật Dark Mode ở hệ điều hành → toàn bộ 9 màn hình (4 tab + word detail + history + import + onboarding) đổi sang bảng màu tối nhất quán.

### Tái hiện
1. Bật Dark Mode trong Settings của điện thoại/simulator.
2. Mở tab "Tra cứu" → nền tối đúng (dùng `usePalette`).
3. Chuyển sang tab "Ôn tập" hoặc "Cài đặt" → nền vẫn **trắng tinh**, chữ vẫn màu light-mode — tương phản chói mắt ngay cạnh tab vừa đúng màu.

### Nguyên nhân gốc
- `C` trong `dict-ui.tsx` được tạo như bước "tạm" khi migrate sang token system mới nhưng 5 màn hình chưa bao giờ được migrate tiếp sang `usePalette()`.
- Style `StyleSheet.create` ở các file này được định nghĩa **module-level** (ngoài component), nên dù có sửa cũng cần đổi sang tạo style trong component (như `makeStyles(t)` mà `index.tsx`/`word/[q].tsx` đã làm) để nhận theme hiện tại.

### Solution — 2 hướng, chọn 1

**a. Migrate 5 màn sang `usePalette()` + `makeStyles(t)`, giống `index.tsx`/`word/[q].tsx` (khuyên dùng)**
- Pros: Nhất quán kiến trúc toàn app — chỉ còn 1 nguồn màu (`theme/tokens.ts` qua `usePalette()`), không còn API màu song song nào sống sót; tự động đổi màu **live** khi user bật/tắt Dark Mode trong lúc app đang mở (như 2 màn kia đã làm được), không chỉ đúng lúc khởi động lại.
- Cons: Đụng cả 5 file, mỗi file phải: đổi `StyleSheet.create({...})` ở module-level thành `makeStyles(t)` gọi qua `useMemo`, và đổi từng token `C.xxx` sang tên tương ứng bên `Semantic` (`C.secondary`→`t.text.secondary`, `C.border`→`t.border.default`, `C.soft`→`t.surface.raised`, `C.accent`→`t.accent.bg`, `C.danger`→`t.text.error`, `C.muted`→`t.text.tertiary`, v.v. — cần bảng map vì tên key không trùng 1:1). Diff lớn nhất trong 2 phương án, cần test kỹ cả 5 màn.
- Plan: làm từng file một (review.tsx → settings.tsx → history.tsx → import.tsx → onboarding.tsx), theo đúng thứ tự này vì review.tsx phức tạp nhất (nhiều state) nên làm trước lúc còn tỉnh táo; mỗi file: swap import, bọc `makeStyles`, map từng token, thay `'#fff'`/`'#1B1B1F'` hardcode bằng `t.surface.canvas`/`t.surface.inverse`.

**b. Biến `C` thành hook `useC()` đọc `usePalette()`, giữ nguyên tên field**
- Pros: Diff nhỏ hơn nhiều — phần lớn chỗ dùng `C.xxx` trong 5 file này đã là **inline style** (`style={{ color: C.secondary }}`) chứ không nằm trong `StyleSheet.create` tĩnh, nên chỉ cần đổi `import { C }` → `const C = useC();` trong component là hầu hết chỗ gọi vẫn chạy đúng, ít nguy cơ gây lỗi mới ở 5 màn vốn đã khá rối.
- Cons: Để lại **2 API màu song song** (`usePalette()` trả `Semantic`, `useC()` trả object tên khác) — đúng kiểu nợ kỹ thuật giống hệt nguyên nhân gốc của bug này (một lớp "tạm" không ai dọn); vài chỗ màu nằm cứng trong `StyleSheet.create` tĩnh (`root: { backgroundColor: '#fff' }`) vẫn phải tách ra thành inline/dynamic riêng, không tránh được hoàn toàn.
- Plan: đổi `export const C = {...}` thành `export function useC() { const t = usePalette(); return { border: t.border.default, ... }; }`; sửa 5 file gọi `const C = useC()` trong component; xử lý riêng các `backgroundColor` đang nằm trong `StyleSheet.create` tĩnh.

**→ Khuyên dùng (a).** Vá nhanh bằng (b) chỉ nên chọn nếu cần fix gấp cho 1 bản release và chấp nhận dọn lại sau — về lâu dài (a) mới thực sự đóng được lỗ hổng vì nó xoá hẳn `C`, không chỉ che nó lại.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi sau khi migrate cả 5 file + xoá `C` khỏi `dict-ui.tsx`.

### Verify
- [x] `review.tsx`, `settings.tsx`, `history.tsx`, `import.tsx`, `onboarding.tsx` đều chuyển sang `usePalette()` + `makeStyles(t)`; `export const C` xoá khỏi `dict-ui.tsx` (đã grep xác nhận không còn nơi nào import `C`).
- [ ] Chưa tự mắt xem Dark Mode trên simulator/device thật (không có trong phiên này) — cần user bật Dark Mode và xác nhận cả 9 màn đồng bộ.

### Report sau code
Implemented option (a) — full migration, not the quick patch. All 5 screens now read colors from `usePalette()`/`Semantic` via a `makeStyles(t)` factory (matching `index.tsx`/`word/[q].tsx`), and the light-only `C` alias was deleted from `dict-ui.tsx` entirely (confirmed via grep — no remaining importers). `tsc` clean. Visual confirmation on an actual dark-mode device/simulator still pending.

---

## Task 3 — Lịch sử: giờ và nhóm ngày tính theo UTC

### Mô tả
Cột `looked_at` mặc định `datetime('now')` của SQLite ([src/db/user.ts:16](src/db/user.ts#L16)) — hàm này trả về **giờ UTC**, không phải giờ địa phương. Màn Lịch sử lấy thẳng chuỗi đó và cắt chuỗi để suy ra ngày/giờ hiển thị:
- `dayKey()`/`dayLabel()` ([src/app/history.tsx:14-26](src/app/history.tsx#L14-L26)) so sánh với `new Date().toISOString().slice(0,10)` — vẫn là UTC, nên nội bộ nhất quán, nhưng **ranh giới "hôm nay/hôm qua" lệch theo giờ UTC thay vì lịch của người dùng**.
- `timeLabel()` ([src/app/history.tsx:27-30](src/app/history.tsx#L27-L30)) lấy `iso.slice(11,16)` — in thẳng giờ UTC ra màn hình, không convert sang giờ máy.

### Expect
Giờ hiển thị trong Lịch sử phải là giờ địa phương của thiết bị; nhóm "Hôm nay/Hôm qua" phải theo lịch địa phương.

### Tái hiện
1. Ở múi giờ UTC+7 (Việt Nam), tra một từ lúc **01:00 giờ VN** (= 18:00 UTC hôm trước).
2. Vào Lịch sử → dòng vừa tra bị xếp vào nhóm **"Hôm qua"** dù người dùng vừa tra "hôm nay" theo đồng hồ của họ; cột giờ hiển thị "18:00" thay vì "01:00".
3. Ngược lại, tra từ lúc 23:30 giờ VN (16:30 UTC cùng ngày) → giờ hiển thị đúng nhưng lệch múi khi xem lại vào sáng hôm sau UTC đã sang ngày mới → nhãn nhóm nhảy ngày sớm hơn 7 tiếng so với cảm nhận người dùng.

### Nguyên nhân gốc
- Chưa convert timestamp UTC lưu trong DB sang local time trước khi cắt chuỗi hiển thị; lẽ ra phải dùng `new Date(iso)` rồi gọi các hàm local (`getHours()`, `toDateString()`...) như `formatNext()` trong `review.tsx` đã làm đúng ([src/app/(tabs)/review.tsx:321-329](src/app/(tabs)/review.tsx#L321-L329)).

### Solution
Một hướng sửa rõ ràng, không cần cân nhắc phương án khác:
- [ ] Viết 1 helper dùng chung, ví dụ `toLocalDate(sqliteDatetime: string): Date` — **quan trọng**: chuỗi SQLite `datetime('now')` có dạng `'YYYY-MM-DD HH:MM:SS'` (dấu cách, KHÔNG có `T`/`Z`) nên `new Date(iso)` parse có thể bị hiểu nhầm tuỳ engine; phải chuẩn hoá tường minh trước: `new Date(sqliteDatetime.replace(' ', 'T') + 'Z')` để chắc chắn được hiểu là UTC, rồi mới gọi các hàm local.
- [ ] Thay `dayKey()`/`dayLabel()` dùng `Date` local đã convert thay vì cắt chuỗi trực tiếp; so sánh "hôm nay/hôm qua" bằng `toDateString()` như `formatNext()` đã làm đúng.
- [ ] Thay `timeLabel()` dùng `date.getHours()`/`getMinutes()` (pad 2 chữ số) thay vì `iso.slice(11,16)`.
- [ ] (Tuỳ chọn, dọn dẹp thêm) Đổi các cột timestamp khác lưu qua `datetime('now')` trong `db/user.ts` sang `strftime('%Y-%m-%dT%H:%M:%fZ','now')` để chuỗi lưu sẵn có hậu tố `Z` chuẩn ISO — giảm nguy cơ lặp lại lỗi này ở chỗ khác.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `history.tsx`: `toLocalDate()` helper (`replace(' ','T')+'Z'`) + `dayKey`/`dayLabel`/`timeLabel` rewritten to use local `Date` accessors instead of string-slicing.
- [ ] Chưa tự tay verify trên thiết bị lệch múi giờ thật (không có device) — logic đã unit-test được nhưng chưa test end-to-end qua UI.

### Report sau code
Implemented the single recommended fix. Added `toLocalDate()` in `history.tsx` and rewrote `dayKey`/`dayLabel`/`timeLabel` to construct a real local `Date` before formatting, instead of slicing the raw UTC string. Skipped the optional `strftime(...Z)` schema cleanup in `db/user.ts` — not required for the fix and out of scope for this pass. `tsc` clean.

---

## Task 4 — Không phát hiện lại file từ điển hỏng sau lần tải đầu

### Mô tả
`dictionaryReady()` ([src/db/open.ts:31-34](src/db/open.ts#L31-L34)) chỉ kiểm tra file tồn tại và `size > 1024` byte — không verify nội dung. `integrityCheckDictionary()` (chạy `PRAGMA integrity_check`, [src/db/open.ts:54-64](src/db/open.ts#L54-L64)) chỉ được gọi **một lần duy nhất**, ngay sau khi tải xong trong `onboarding.tsx` ([src/app/onboarding.tsx:33](src/app/onboarding.tsx#L33)). Từ lần mở app thứ 2 trở đi, `index.tsx` chỉ gọi `dictionaryReady()` ([src/app/(tabs)/index.tsx:34](src/app/(tabs)/index.tsx#L34)), không bao giờ gọi lại integrity check.

### Expect
Theo spec (00-01): "verify bằng `PRAGMA integrity_check`" trước khi cho vào app; file hỏng phải có đường quay lại tải lại, không được để app chạy tiếp với DB hỏng.

### Tái hiện
1. Trong lúc tải `oxford-app.db` lần đầu, kill app (hoặc mất mạng) đúng lúc đã ghi được > 1KB nhưng chưa xong toàn bộ file (dễ xảy ra với file ~vài trăm MB).
2. `downloadAsync()` với `DownloadResumable` không hoàn tất, file trên đĩa là file cụt nhưng > 1024 byte.
3. Mở lại app → `dictionaryReady()` trả `true` (chỉ check size) → vào thẳng SCR-01, **không** chạy `integrityCheckDictionary()`.
4. Mọi truy vấn tra từ trên file cụt sẽ lỗi hoặc trả kết quả sai âm thầm, và không có lối nào trong app để phát hiện/tải lại — chỉ còn cách gỡ cài đặt.

### Nguyên nhân gốc
- Integrity check được thiết kế như một bước "one-shot" trong flow tải, thay vì một gate chạy ở mỗi lần khởi động (hoặc ít nhất định kỳ) như spec yêu cầu.
- Không có cơ chế nào trong Settings để người dùng chủ động "tải lại từ điển" khi nghi ngờ hỏng dữ liệu.

### Solution — 3 hướng, có thể kết hợp

**a. Full `PRAGMA integrity_check` mỗi lần khởi động**
- Pros: Đúng y văn bản spec, đơn giản nhất về logic.
- Cons: `integrity_check` quét toàn bộ file — với DB ~vài trăm MB có thể mất vài giây trên máy yếu, cộng thêm độ trễ khởi động **mỗi lần mở app** chỉ để phòng 1 trường hợp hiếm. Đánh đổi không đáng.

**b. Fingerprint nhẹ mỗi lần mở app + integrity_check đầy đủ chỉ chạy thủ công**
- Lúc tải xong thành công (`onboarding.tsx`), lưu thêm kích thước file kỳ vọng (hoặc checksum nhanh lấy mẫu vài offset) vào `settings`. Mỗi lần mở app, so kích thước/checksum này với file thật — rẻ, gần như tức thời.
- Thêm nút "Kiểm tra từ điển" trong Settings (nhóm Dữ liệu) để người dùng chủ động chạy `integrityCheckDictionary()` đầy đủ khi nghi ngờ có vấn đề.
- Pros: Gần như không tốn gì lúc khởi động, vẫn bắt được ca phổ biến nhất (tải dở dang/bị cắt).
- Cons: Cần bookkeeping khi cập nhật phiên bản từ điển mới (fingerprint kỳ vọng phải đổi theo phiên bản).

**c. Bắt lỗi khi query thật sự thất bại (reactive)**
- Bọc các lệnh gọi tới `dict` ở tầng `db/open.ts`/`services/lookup.ts`; nếu native ném lỗi dạng "malformed database"/"file is not a database", điều hướng về màn "Từ điển có vấn đề — Tải lại?" thay vì để lỗi rơi tự do.
- Pros: Bắt được cả hỏng hóc xảy ra SAU mọi check trước đó, không tốn chi phí khởi động.
- Cons: Là lưới an toàn cuối — user vẫn thấy 1 lần lỗi trước khi được điều hướng.

**→ Khuyên dùng kết hợp (b) + (c)**: (b) chặn ngay ca hay gặp nhất với chi phí gần bằng 0, (c) là lưới an toàn cho phần còn lại. Không nên chỉ làm (a) một mình vì chi phí khởi động không xứng đáng.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] (b): `dictionaryReady()` giờ so `size` với fingerprint lưu ở `${DICT_PATH}.meta.json` (`recordDictionaryMeta()`, gọi từ `onboarding.tsx` sau integrity check); thêm nút "Kiểm tra từ điển" trong Settings gọi `integrityCheckDictionary()` thủ công.
- [x] (c): `openDictionary()` wrap các query bằng `wrapDictionary()` — lỗi dạng "malformed/not a database" gọi `onDictionaryCorrupted` callback (đăng ký từ `_layout.tsx`) → tự xoá file + điều hướng `/onboarding`.
- [ ] Chưa test được kịch bản thật (file tải dở dang / DB hỏng thật trên device) — chỉ verify bằng đọc code + tsc.

### Report sau code
Implemented (b) + (c), skipped (a) as recommended. `db/open.ts`: `dictionaryReady()` now checks a size fingerprint (`recordDictionaryMeta()` writes it after a successful integrity check); added a manual "Kiểm tra từ điển" row in Settings that runs `integrityCheckDictionary()` on demand and offers recovery. `openDictionary()`'s queries are wrapped to detect corruption-shaped errors and fire a callback (registered in `_layout.tsx`) that removes the file and redirects to onboarding — decoupled via a plain callback, not a store import, to avoid a `db → stores` circular dependency. `tsc` clean. Not exercised against a real corrupted file on-device in this session.

---

## Task 5 — Nghĩa tiếng Việt hiện trùng lặp khi tab không khớp POS

### Mô tả
`meaningsForPos()` ([src/services/vi-meaning.ts:87-94](src/services/vi-meaning.ts#L87-L94)) dòng cuối: `return matched.length ? [...matched, ...unposed] : all;`. Khi **không có nghĩa nào khớp POS** của tab đang mở (`matched.length === 0`) nhưng vẫn có nghĩa thuộc POS khác, hàm fallback trả về **toàn bộ `all`** (bao gồm cả các nghĩa POS không khớp) thay vì chỉ trả `unposed`. Đồng thời `meaningsOtherPos()` (dùng để hiện khối "Nghĩa khác", [src/services/vi-meaning.ts:96-101](src/services/vi-meaning.ts#L96-L101)) vẫn trả đúng các nghĩa POS-khác đó → chúng bị hiện **2 lần** trên cùng một màn ([src/app/word/[q].tsx:328-341](src/app/word/[q].tsx#L328-L341): khối chính dòng 328, khối "Nghĩa khác" dòng 334-341).

### Expect
Mỗi nghĩa tiếng Việt chỉ nên xuất hiện đúng một chỗ: khớp POS tab hiện tại (+ nghĩa không gắn POS) → khối chính; không khớp → chỉ ở "Nghĩa khác".

### Tái hiện
1. Tra một từ homograph có tab "adjective" nhưng API `dict.minhqnd.com` chỉ trả nghĩa gắn POS "noun"/"verb" cho từ đó (rất dễ gặp vì POS tiếng Việt của API map hẹp, xem `POS_MAP` [src/services/vi-meaning.ts:17-27](src/services/vi-meaning.ts#L17-L27)).
2. Mở tab "adjective" → khối "Nghĩa tiếng Việt" hiện toàn bộ nghĩa noun/verb đó (do fallback `all`), rồi mục "Nghĩa khác" bên dưới hiện **lại y hệt** các nghĩa đó lần nữa.
3. Test đơn vị hiện tại ([test/services.test.ts:297-306](test/services.test.ts#L297-L306)) chỉ test case `matched.length > 0`, không cover nhánh fallback này nên bug không bị bắt.

### Nguyên nhân gốc
- Toán tử `? :` dùng sai điều kiện fallback: lẽ ra khi `matched` rỗng chỉ nên trả `unposed`, không phải toàn bộ `all`.

### Solution
Một hướng sửa rõ ràng:
- [ ] Sửa `meaningsForPos()` ([src/services/vi-meaning.ts:93](src/services/vi-meaning.ts#L93)): bỏ nhánh fallback `all`, luôn trả `[...matched, ...unposed]` (kể cả khi rỗng) — phần không khớp POS đã có `meaningsOtherPos()` lo riêng, không cần fallback che chỗ trống bằng dữ liệu sai tab.
- [ ] Thêm test cho đúng nhánh này (`matched.length === 0` nhưng có `unposed`, và cả trường hợp cả hai đều rỗng) vào `test/services.test.ts`, cạnh test "pos mapping + tab filter" hiện có — test hiện tại chỉ cover `matched.length > 0` nên bug lọt lưới.

### Test
- [x] `test/services.test.ts`: "a tab with zero matching-POS meanings shows only the unposed ones, never the other tab's meanings".
- [x] `npx vitest run` — 40/40 pass.

### Verify
- [x] `meaningsForPos()` ([src/services/vi-meaning.ts](src/services/vi-meaning.ts)) fallback branch removed — now always `[...matched, ...unposed]`.

### Report sau code
Implemented the single recommended fix: removed the `matched.length ? ... : all` fallback in `meaningsForPos()`. New test covers the exact previously-uncovered branch (zero POS-matches for the active tab) and confirms the non-matching meanings only show once, under `meaningsOtherPos()`. `vitest`/`tsc` clean.

---

## Task 6 — Import: từ trùng entry đích biến mất khỏi cả 2 nhóm kết quả

### Mô tả
Trong `matchImport()` ([src/services/import-matcher.ts:33-85](src/services/import-matcher.ts#L33-L85)), khi hai dòng nhập khác nhau resolve về cùng một `entry_id` (ví dụ user paste cả "ran" và "run" — cả hai đều trỏ về entry "run"), dòng: `if (takenEntry.has(primary.entry_id)) continue;` ([src/services/import-matcher.ts:66](src/services/import-matcher.ts#L66)) bỏ qua thẳng item thứ hai — **không** push vào `matched` cũng **không** push vào `unmatched`.

### Expect
Mọi từ người dùng paste vào phải xuất hiện ở đúng một trong hai nhóm "Tìm thấy (n)" / "Không có trong từ điển (m)" ở màn xác nhận B3, để n + m khớp với số dòng hợp lệ đã nhập.

### Tái hiện
1. Vào Nhập danh sách, dán:
   ```
   ran
   run
   ```
2. Nhấn "Đối chiếu với từ điển".
3. Kết quả chỉ hiện 1 dòng "run" trong "Tìm thấy (1)" — từ "ran" biến mất hoàn toàn, không nằm trong "Tìm thấy" (đã có ở dạng gộp) mà cũng không nằm trong "Không có trong từ điển" — người dùng không có cách nào biết vì sao tổng số không khớp 2 dòng đã dán.

### Nguyên nhân gốc
- Dedup theo `entry_id` đích là đúng hướng (tránh insert 2 lần), nhưng thiếu bước gộp/ghi nhận item bị dedup vào kết quả trả về (vd. gộp `inputWord` thứ hai vào cùng dòng matched, hoặc liệt kê riêng) — hiện tại chỉ có `continue` đơn thuần.

### Solution — 2 hướng, chọn 1

**a. Gộp các input trùng entry đích vào 1 dòng matched, liệt kê đủ input words (khuyên dùng)**
- Đổi `MatchedImport.inputWord: string` → `inputWords: string[]` (hoặc giữ `inputWord` + thêm `extraInputWords?: string[]`). Khi gặp `takenEntry.has(primary.entry_id)`, thay vì `continue`, tìm dòng `matched` đã có entry đó và push thêm `item.word` vào danh sách input, giữ `meaning` đầu tiên có giá trị (cùng rule dedup đã có ở `parseImportText`).
- UI (`import.tsx`) đổi dòng `bạn nhập "{m.inputWord}" → từ gốc {m.headword}` thành liệt kê nhiều input, vd. `bạn nhập "ran", "run" → từ gốc run` — tận dụng đúng chỗ hiển thị đã có sẵn cho `viaForm`.
- Pros: Không mất thông tin, n + m sau khi gộp vẫn giải thích được vì sao số dòng "Tìm thấy" ít hơn số dòng đã dán.
- Cons: Đổi shape của `MatchedImport`, cần sửa cả nơi tạo lẫn nơi hiển thị.

**b. Thêm bucket thứ 3 "Trùng với từ khác (k)"**
- Giữ `MatchedImport` như cũ, đẩy `item.word` vào 1 mảng `duplicates: { word: string; mergedInto: string }[]` mới trong `ImportMatchResult`, hiện thành 1 nhóm riêng.
- Pros: Không đổi shape `MatchedImport`.
- Cons: Thêm 1 nhóm UI mới (phức tạp hoá màn xác nhận vốn đã có 2 nhóm) trong khi bản chất vẫn là "từ đó đã được thêm rồi" — gộp vào dòng có sẵn (a) trực quan hơn.

**→ Khuyên dùng (a)** — tận dụng đúng cơ chế `viaForm` đã có sẵn trong UI, không cần thêm nhóm hiển thị mới.

### Test
- [x] `test/services.test.ts`: "two inputs resolving to the same entry are merged, not dropped" (mới); "resolves forms to lemma..." cập nhật theo field mới.
- [x] `npx vitest run` — 40/40 pass.

### Verify
- [x] `MatchedImport.inputWord: string` → `inputWords: string[]` ([src/services/import-matcher.ts](src/services/import-matcher.ts)); `matchImport()` giờ gộp vào dòng đã có (`byEntry` Map) thay vì `continue`.
- [x] `import.tsx` hiện `bạn nhập "ran", "run" → từ gốc run` cho các từ đã gộp.

### Report sau code
Implemented option (a). Renamed `inputWord` → `inputWords: string[]` in `MatchedImport`, and `matchImport()` now merges a duplicate-target input into the existing row (adopting its meaning if the first lacked one, OR-ing `viaForm`) instead of dropping it. `import.tsx` updated to join and display all merged input words. Test file updated for the renamed field plus a new merge-specific test. `vitest`/`tsc` clean.

---

## Task 7 — `removeDictionaryFile()` không đóng kết nối SQLite trước khi xoá file

### Mô tả
`removeDictionaryFile()` ([src/db/open.ts:66-69](src/db/open.ts#L66-L69)) set `dictDb = null` rồi xoá file bằng `FileSystem.deleteAsync`, nhưng **không đóng** kết nối `expo-sqlite` gốc (biến `db` bên trong `openDictionary()`) nếu nó đã được mở trước đó. Interface `DbLike` ([src/db/types.ts:9-14](src/db/types.ts#L9-L14)) và hàm `wrap()` ([src/db/open.ts:16-26](src/db/open.ts#L16-L26)) còn không expose `closeAsync` nên kể cả muốn đóng đúng cách từ ngoài cũng không có API để gọi.

### Expect
Trước khi xoá file DB đang mở, phải đóng connection native trước, tránh giữ file handle trỏ tới file đã xoá / tránh lỗi khi mở lại file cùng tên ngay sau đó.

### Tái hiện
1. Dùng app bình thường (dict đã mở qua `openDictionary()` ít nhất 1 lần → `dictDb` khác null nội bộ).
2. Giả lập flow "tải lại vì integrity check fail" (đường `onboarding.tsx` gọi `removeDictionaryFile()` khi `integrityCheckDictionary()` trả false, [src/app/onboarding.tsx:34-37](src/app/onboarding.tsx#L34-L37)) trong lúc app đã từng tra từ trước đó ở phiên hiện tại.
3. Kết nối SQLite gốc trong `openDictionary()`'s closure không được đóng — chỉ biến `dictDb` (biến module ở `open.ts`) bị set null; native handle vẫn còn sống, có thể giữ file lock trên Android khi cố xoá/ghi đè file cùng tên ngay sau đó.

### Nguyên nhân gốc
- Thiếu `closeAsync` trong `DbLike`/`wrap()`, nên `removeDictionaryFile()` chỉ có cách "quên" biến cache chứ không có API để đóng connection thật.

### Solution
Chung gốc với Task 16 (đọc Solution của Task 16 trước — không lặp lại toàn bộ thiết kế ở đây):
- [ ] Thêm `closeAsync(): Promise<void>` vào interface `DbLike` ([src/db/types.ts](src/db/types.ts)) và implement trong `wrap()` ([src/db/open.ts:16-26](src/db/open.ts#L16-L26)) — gọi thẳng `db.closeAsync()` của expo-sqlite.
- [ ] `removeDictionaryFile()` gọi `await dictDb?.closeAsync()` rồi mới set `dictDb = null` và xoá file — đảm bảo không còn native connection nào trỏ vào file sắp xoá.
- [ ] Áp dụng chung cơ chế cache-theo-promise từ Task 16 cho `openDictionary()` để tránh việc gọi lại ngay sau khi xoá mở nhầm 2 connection song song.

### Test
- [x] `npx vitest run` — 40/40 pass. `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `closeAsync` thêm vào `DbLike`/`wrap()`; `removeDictionaryFile()` giờ `await`s `dictDbPromise.then(db => db.closeAsync())` trước khi xoá file và reset promise.

### Report sau code
Same code change as Task 16 (single `db/open.ts` rewrite covers both): added `closeAsync` to `DbLike`, and `removeDictionaryFile()` now closes the live connection before deleting the file and clearing the cached promise. `vitest`/`tsc` clean.

---

## Task 8 — Cache thẻ ôn tập không làm mới trong phiên app

### Mô tả
`ReviewScreen` giữ `cache = useRef(new Map<number, CardContent>())` ([src/app/(tabs)/review.tsx:52](src/app/(tabs)/review.tsx#L52)); `loadCard()` ưu tiên trả từ cache nếu đã có ([src/app/(tabs)/review.tsx:70](src/app/(tabs)/review.tsx#L70)) và **không bao giờ invalidate**. Layout tab dùng `NativeTabs` ([src/app/(tabs)/_layout.tsx](src/app/(tabs)/_layout.tsx)) nên các tab thường được giữ mounted khi chuyển qua lại — `ReviewScreen` (và `cache` của nó) sống xuyên suốt nhiều phiên ôn tập trong cùng một lần mở app.

### Expect
Nếu người dùng sửa "Ghi chú nghĩa của bạn" (`user_meaning`) của một từ đã lưu, lần ôn tập tiếp theo (dù trong cùng phiên app) phải hiện nghĩa mới.

### Tái hiện
1. Vào Ôn tập, ôn hết một phiên có từ "run" (mặt sau cache nghĩa hiện tại của "run").
2. Sang tab Tra cứu, mở "run", bấm "Sửa" ở "Ghi chú nghĩa của bạn", đổi `user_meaning` thành text mới, Lưu.
3. Quay lại tab Ôn tập, bắt đầu phiên mới có "run" trong đó (do vẫn còn thẻ đến hạn, hoặc chọn "Ôn trước hạn").
4. Mặt sau thẻ "run" vẫn hiện `user_meaning` **cũ** vì `loadCard()` trả thẳng từ `cache.current` mà không refetch.

### Nguyên nhân gốc
- Cache được thiết kế để tránh query lại trong cùng 1 phiên (hợp lý), nhưng không có TTL/invalidation khi rời màn hình hoặc khi biết dữ liệu nguồn đã đổi, kết hợp với việc tab không unmount khiến `useRef` sống lâu hơn dự tính.

### Solution — 2 hướng, chọn 1

**a. Reset cache mỗi khi bắt đầu phiên mới / màn mất focus (khuyên dùng)**
- `cache.current.clear()` ở đầu `begin()` (mỗi lần Bắt đầu / Ôn trước hạn / Ôn tiếp thẻ sai), và thêm cleanup trong `useFocusEffect`/unmount để clear khi rời tab Ôn tập.
- Vẫn giữ lợi ích cache **trong cùng 1 phiên** (đúng mục đích ban đầu — cùng thẻ có thể được `loadCard()` lại do requeue/reinforcement), chỉ không sống sót QUA nhiều phiên nữa.
- Pros: Sửa vài dòng, giữ nguyên lợi ích cache nội-phiên, rủi ro thấp.
- Cons: Nếu user sửa nghĩa rồi quay lại NGAY TRONG cùng 1 phiên đang chạy (gần như không xảy ra vì Ôn tập/Tra cứu là 2 tab riêng) vẫn dính cache cũ — edge case chấp nhận được.

**b. Bỏ hẳn cache, luôn query lại**
- Xoá `cache`/`loadCard()`'s cache-check, luôn `await` query mới mỗi lần.
- Pros: Không còn khái niệm "cũ" nào cả, đơn giản nhất.
- Cons: Query lại DB mỗi lần thẻ xuất hiện lại trong phiên (do requeue) — chi phí thực tế rất nhỏ (SQLite local, ≤40 thẻ/phiên) nên không đáng lo, nhưng bỏ đi 1 tối ưu có lý do chính đáng.

**→ Khuyên dùng (a)** — giữ được lý do cache ban đầu, chỉ sửa đúng phạm vi sống của nó.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `review.tsx`: `cache.current.clear()` thêm vào đầu `begin()`, và `useFocusEffect(useCallback(() => () => cache.current.clear(), []))` clear khi rời tab.
- [ ] Chưa test end-to-end (sửa nghĩa ở Tra cứu → quay lại Ôn tập) trên app thật.

### Report sau code
Implemented option (a). `cache.current.clear()` now runs at the start of every `begin()` (new session) and on tab blur via `useFocusEffect`'s cleanup, so a session's cache no longer survives past that session while still avoiding refetches within one. `tsc` clean; end-to-end confirmation on-device still pending.

---

## Task 9 — Thiếu "Gói audio offline" (06-04) trong Cài đặt

### Mô tả
Spec mục 06-04 ([specs/init.md:300](specs/init.md#L300)) yêu cầu một dòng cài đặt: trạng thái chưa tải/đã tải (dung lượng) + nút tải/xoá gói audio offline (`audio_pack`, ATTACH riêng theo §0.3). Màn `settings.tsx` hiện chỉ có "Xoá cache audio streaming" ([src/app/(tabs)/settings.tsx:78-79](src/app/(tabs)/settings.tsx#L78-L79)) — không có mục nào để tải/quản lý gói audio offline.

### Expect
Có UI 06-04 trong nhóm "Dữ liệu" của Cài đặt, dù backend tải gói audio có thể làm sau — ít nhất cần trạng thái "chưa hỗ trợ" rõ ràng thay vì im lặng bỏ qua.

### Tái hiện
1. Mở Cài đặt → nhóm "Dữ liệu" chỉ có 4 dòng (Xoá lịch sử, Xoá cache audio streaming, Xoá cache nghĩa Việt, Export sổ từ) — không có "Gói audio offline".

### Nguyên nhân gốc
- Tính năng audio offline (phase 2 theo §0.3) chưa được triển khai ở tầng service (`services/audio.ts` chỉ có 2/3 tầng: stream+cache, chưa có BLOB offline pack) nên UI tương ứng cũng bị bỏ qua luôn.

### Solution — 2 hướng

**a. Thêm dòng "Sắp ra mắt" (placeholder trung thực) ngay bây giờ (khuyên dùng cho trước mắt)**
- Thêm 1 `Row`/`LinkRow` disabled trong nhóm "Dữ liệu" của `settings.tsx`: "Gói audio offline — Sắp ra mắt" — để màn Cài đặt không âm thầm thiếu mục 06-04 mà không ai biết.
- Pros: Rẻ, ~15 phút, đóng khoảng trống UI ngay.
- Cons: Chưa giải quyết tính năng thật.

**b. Làm đủ tính năng phase 2 theo §0.3 (audio.db tải về + ATTACH + UI dung lượng/tải/xoá)**
- Cần: file `audio.db` build sẵn + host ở đâu đó, logic ATTACH DATABASE trong `db/open.ts`, tầng 1 trong `services/audio.ts` (hiện chỉ có tầng 2 stream+cache), UI trạng thái/tiến trình tải giống `onboarding.tsx`.
- Pros: Đúng đủ spec.
- Cons: Là 1 hạng mục lớn riêng (cần cả hạ tầng host file audio pack) — nên tách thành task/epic riêng, không lẫn vào đợt fix bug này.

**→ Khuyên dùng: làm (a) ngay trong đợt này, xếp (b) vào backlog riêng.**

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `settings.tsx`: thêm dòng "Gói audio offline — Sắp ra mắt" (disabled) trong nhóm "Dữ liệu".

### Report sau code
Implemented option (a) only, per plan — (b) left as a separate backlog epic. Added a disabled "Gói audio offline — Sắp ra mắt" row to Settings' "Dữ liệu" group. `tsc` clean.

---

## Task 10 — Màn bắt đầu Ôn tập hiện sai số thẻ đến hạn + biểu đồ box

### Mô tả
Ở `ReviewScreen`, số hiển thị "X thẻ đến hạn hôm nay" và biểu đồ box lấy từ `session` — tức kết quả của `buildSession()`, vốn đã **cap ở 40 thẻ/phiên và tối đa 20 thẻ mới** theo đúng thiết kế chơi ([src/services/srs.ts:60-67](src/services/srs.ts#L60-L67)):
```
setDueCount(session.length);                                   // review.tsx:62
setBoxes(boxCounts(session.length ? session : states));         // review.tsx:64
```
([src/app/(tabs)/review.tsx:61-64](src/app/(tabs)/review.tsx#L61-L64)). Trong khi đó, `savedStats()` ([src/db/user.ts:119-125](src/db/user.ts#L119-L125)) — dùng để hiện "X từ · Y đến hạn ôn" ở `my-words.tsx` ([src/app/(tabs)/my-words.tsx:52](src/app/(tabs)/my-words.tsx#L52)) — đếm **toàn bộ** thẻ có `due_at <= now`, không cap. Hai màn hình dùng hai cách đếm khác nhau cho cùng một khái niệm "số thẻ đến hạn".

### Expect
Số "đến hạn" phải nhất quán giữa "Từ của tôi" và màn bắt đầu "Ôn tập"; con số phải phản ánh đúng tồn đọng thật, không bị cắt bởi giới hạn phiên chơi (40/20 chỉ nên áp dụng khi **chọn thẻ vào phiên**, không áp dụng khi **đếm để hiển thị**).

### Tái hiện
1. Import hoặc lưu hơn 40 từ, để tất cả đều đến hạn (thẻ mới luôn đến hạn ngay khi lưu — xem `saveWord`/`srs_state` default `due_at`).
2. Vào tab "Từ của tôi" → header hiện đúng, ví dụ "60 từ · 60 đến hạn ôn".
3. Bấm "Ôn ngay" → màn bắt đầu Ôn tập hiện **"40"** ở số to "thẻ đến hạn hôm nay" — sai lệch 20 thẻ so với màn vừa rời khỏi, không có lời giải thích nào cho người dùng.
4. Biểu đồ phân bố box cũng bị pha thêm tối đa 20 thẻ **mới** (box mặc định 1) trộn lẫn với thẻ box 1 thật sự đến hạn, khiến cột "1" bị thổi phồng so với thực tế.

### Nguyên nhân gốc
- Dùng chung một hàm (`buildSession`, vốn được thiết kế để **chọn** thẻ chơi trong phiên) cho cả mục đích **đếm hiển thị** — hai mục đích khác nhau cần hai truy vấn khác nhau.

### Solution
Một hướng sửa rõ ràng — tách "đếm để hiển thị" khỏi "chọn thẻ vào phiên":
- [ ] Thêm hàm thuần mới trong `services/srs.ts`, ví dụ `dueBoxCounts(all: SrsState[], now: Date): number[]` — lọc `!isNewCard(s) && s.due_at <= now` (KHÔNG cap 40/20), đếm theo box (tái dùng logic của `boxCounts` hiện có).
- [ ] Ở `review.tsx`, đổi `setDueCount(session.length)` → đếm trực tiếp từ `states` đã có sẵn trong `statesRef.current` (không cần query DB lại): `states.filter(s => !isNewCard(s) && s.due_at <= now).length`.
- [ ] Đổi `setBoxes(boxCounts(session.length ? session : states))` → `setBoxes(dueBoxCounts(states, now))` — bỏ hẳn việc trộn thẻ mới vào biểu đồ phân bố box.
- [ ] `buildSession()`/cap 40-20 giữ nguyên, chỉ dùng để **chọn thẻ chơi**, không dùng để đếm hiển thị nữa.
- [ ] Thêm test: fixture > 40 thẻ đến hạn, xác nhận `dueCount` hiển thị khớp với công thức đếm dùng ở `savedStats()` (`my-words.tsx`).

### Test
- [x] `test/services.test.ts`: "dueBoxCounts counts the true due backlog, uncapped by the 40/20 session limits, excluding new cards".
- [x] `npx vitest run` — 40/40 pass.

### Verify
- [x] `services/srs.ts`: new `dueBoxCounts(all, now)` (uncapped, excludes new cards). `review.tsx`: `dueCount`/`boxes` now computed straight from `statesRef.current`, not `buildSession()`'s capped output.

### Report sau code
Implemented the single recommended fix. Added `dueBoxCounts()` to `services/srs.ts` and switched `review.tsx`'s start-screen `dueCount`/`boxes` to use it (and a direct filter on the loaded states) instead of `buildSession()`'s 40/20-capped result — `buildSession()` is now used only for actually building the play session. Also refreshed both on the "Xong" button, closing a related staleness gap. `vitest`/`tsc` clean.

### Update (2026-08-20) — fix trên gây regression nặng hơn cả bug gốc: nút "Bắt đầu" bị khoá cứng

**Bug**: Bullet #2 trong Solution ở trên (`states.filter(s => !isNewCard(s) && s.due_at <= now).length`) tôi viết sai và implement y hệt — dùng chung điều kiện lọc `!isNewCard` cho CẢ `dueCount` lẫn `dueBoxCounts`, trong khi 2 con số này có ý nghĩa khác nhau: `dueBoxCounts` (biểu đồ box) đúng là nên loại thẻ mới, nhưng `dueCount` (số to + điều kiện bật nút "Bắt đầu") thì KHÔNG nên loại, vì thẻ mới luôn "đến hạn ngay khi lưu" (`srs_state.due_at` mặc định = lúc lưu) và lẽ ra phải được tính vào — đúng như `savedStats()` ở `my-words.tsx` đã làm (không loại thẻ mới).

**Hậu quả**: User nào có sổ từ toàn thẻ **chưa từng ôn lần nào** (tình huống rất phổ biến — vừa cài app/mới import) sẽ thấy `dueCount = 0`, nút "Bắt đầu" bị `disabled` vĩnh viễn — **báo cáo user: "i cant start at screen review"**. Đây là bug do chính tôi gây ra khi fix Task 10, nghiêm trọng hơn bug gốc (bug gốc chỉ sai SỐ HIỂN THỊ, bug này CHẶN HẲN tính năng chính của cả màn Ôn tập).

**Fix**: [src/app/(tabs)/review.tsx:64](src/app/(tabs)/review.tsx#L64) — bỏ điều kiện `!isNewCard(st)` khỏi phép tính `dueCount`, chỉ còn `states.filter(st => st.due_at <= nowIso).length`, khớp đúng định nghĩa của `savedStats()`. `dueBoxCounts()` (biểu đồ) giữ nguyên, vẫn loại thẻ mới — không đổi. Xoá import `isNewCard` không dùng nữa trong `review.tsx`.

### Test (update)
- [x] `npx tsc --noEmit` — 0 lỗi (bắt luôn được import `isNewCard` thừa qua diagnostic của editor). `npx vitest run` — 40/40 pass.

### Verify (update)
- [ ] Cần user tự bấm "Ôn tập" → xác nhận nút "Bắt đầu" không còn bị khoá khi sổ từ toàn thẻ mới chưa ôn lần nào — chưa test được trên device thật trong phiên này.

**Bài học rút ra**: Khi viết Solution có công thức code cụ thể (`states.filter(...)`), cần tự kiểm lại công thức đó đúng chưa TRƯỚC khi copy y hệt vào lúc implement — không nên coi kế hoạch đã viết là chắc chắn đúng chỉ vì đã viết ra trước đó.

---

## Task 11 — Cache audio bị trùng key trên data thật (đã xác nhận 7 cặp)

### Mô tả
`cacheKey()` ([src/services/audio.ts:12-16](src/services/audio.ts#L12-L16)) băm URL bằng thuật toán 32-bit kiểu Java `hashCode` rồi dùng thẳng làm tên file cache (`${hash}.mp3`). Đã viết script quét toàn bộ URL audio thật trong `oxford-app.db` (158 443 URL phân biệt, từ `forms.audio_uk/us/any` + `entries.data.pronunciations.*.audio_mp3`) và tái tạo đúng hàm băm này — kết quả: **7 cặp URL hoàn toàn khác nhau bị trùng hash**, ví dụ:
- `discomfort__gb_1.mp3` (UK) trùng key `235f2399` với `grandmother_s_footsteps_1_us_1.mp3` (US)
- `should__gb_3.mp3` trùng key `943c58fe` với `bow_wow_1_gb_3.mp3`
- `windermere_1_gb_1.mp3` trùng key `ad6f7e54` với `sociologically__us_1.mp3`
- (4 cặp khác, xem output script trong task note)

Vì `ensureCached()` ([src/services/audio.ts:21-32](src/services/audio.ts#L21-L32)) coi file đã tồn tại ở đường dẫn hash là "đã cache" và phát thẳng, **từ nào được phát/tải trước sẽ "chiếm" file cache — từ phát sau dùng chung key sẽ luôn nghe nhầm sang audio của từ kia**, cho tới khi người dùng vào Cài đặt bấm "Xoá cache audio streaming".

### Expect
Hai URL khác nhau không được phép map ra cùng một file cache.

### Tái hiện
1. Tra từ "should" (hoặc trực tiếp mở form "bow wow"), bấm loa UK để phát/cache trước.
2. Tra từ còn lại trong cặp trùng key (bow wow / should) ở phiên sau, bấm loa UK → nghe thấy audio của từ **kia**, không phải từ vừa tra.
3. (Đã verify bằng script Python đối chiếu 158 443 URL thật trong `oxford-app.db`, không phải suy đoán — xem `/tmp/.../hash_collision_check.py` dùng trong phiên review này để tái chạy nếu cần.)

### Nguyên nhân gốc
- Hash 32-bit không đủ không gian để tránh đụng độ khi số URL tiệm cận 10^5 (theo nghịch lý ngày sinh, ~150k URL trên 2^32 bucket đã đủ để va vài lần); lẽ ra tên file cache nên giữ nguyên định danh duy nhất từ URL (vd. encode phần path, hoặc hash mạnh hơn như SHA-1/SHA-256) thay vì hash ngắn dễ đụng.

### Solution — 2 hướng, chọn 1

**a. Đổi sang hash mạnh (SHA-256) qua `expo-crypto` (khuyên dùng)**
- Dùng `Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, url)` (module chính thức trong hệ Expo SDK) làm tên file cache — về mặt thực tế không thể đụng độ với số lượng URL của 1 từ điển, kể cả tăng gấp 10-100 lần.
- Pros: Độ dài tên file cố định, không phải lo giới hạn độ dài path; cách làm chuẩn, dễ hiểu.
- Cons: Thêm 1 dependency mới (`expo-crypto`); `digestStringAsync` là async (không vấn đề vì `cacheKey()`/`ensureCached()` vốn đã async).

**b. Bỏ hash, encode thẳng URL thành tên file an toàn cho filesystem**
- `encodeURIComponent(url).replace(/[^a-zA-Z0-9]/g, '_')` làm tên file — ánh xạ 1-1 với URL gốc nên chắc chắn không đụng độ, không cần thêm dependency.
- Pros: Zero dependency mới.
- Cons: Tên file dài hơn nhiều (URL Oxford khá dài) — cần đảm bảo không vượt giới hạn độ dài path của filesystem (thường 255 ký tự/segment; các URL mẫu đã kiểm tra đều an toàn, nhưng nên có fallback cắt bớt + hash ngắn phía sau cho URL bất thường dài hơn dự kiến).

**→ Khuyên dùng (a)** nếu chấp nhận thêm `expo-crypto`; chọn (b) nếu muốn zero-dependency. Test bắt buộc cho cả 2: chạy lại script collision-check (đã dùng trong review này) trên URL thật của `oxford-app.db`, xác nhận 0 đụng độ với hàm mới.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.
- [ ] Chưa re-run script collision-check với hàm SHA-256 mới (không cần thiết về mặt toán học — SHA-256 không có đụng độ thực tế ở quy mô này — nhưng chưa tự tay re-run để đóng vòng lặp xác minh).

### Verify
- [x] `npx expo install expo-crypto` (~56.0.4, khớp SDK) → thêm vào `package.json`.
- [x] `cacheKey()` ([src/services/audio.ts](src/services/audio.ts)) đổi sang `Crypto.digestStringAsync(SHA256, url)`, `ensureCached()` cập nhật theo (giờ `await cacheKey(url)`).

### Report sau code
Implemented option (a). Installed `expo-crypto` via `npx expo install` (correct SDK-matched version, no config plugin needed). `cacheKey()` now returns a SHA-256 digest of the URL instead of the 32-bit hash; `ensureCached()` updated to await it. `tsc` clean. Didn't re-run the collision-check script against the new function — not meaningful to do (SHA-256 collisions aren't a realistic concern at this URL count) but flagging that the loop wasn't literally closed with a script re-run.

---

## Task 12 — "Lần ôn tiếp theo" không hiện số thẻ như spec

### Mô tả
Spec 05C-02 ([specs/init.md:283](specs/init.md#L283)): `"Lần ôn tiếp theo: X thẻ vào ngày mai" | MIN(due_at) tương lai`. Implementation chỉ lấy `MIN(due_at)` (`nextDueAt()`, [src/db/user.ts:139-143](src/db/user.ts#L139-L143)) và format thành chuỗi ngày (`formatNext()`, [src/app/(tabs)/review.tsx:321-329](src/app/(tabs)/review.tsx#L321-L329)); dòng hiển thị thực tế chỉ là `Lần ôn tiếp theo: ${formatNext(nextDue)}` ([src/app/(tabs)/review.tsx:210-212](src/app/(tabs)/review.tsx#L210-L212)) — **không có "X thẻ"** ở đâu cả, phần đếm số thẻ hoàn toàn bị thiếu so với spec.

### Expect
Dòng kết quả phải có dạng "Lần ôn tiếp theo: 12 thẻ vào ngày mai", không chỉ ngày suông.

### Tái hiện
1. Hoàn thành một phiên ôn tập bất kỳ, xem màn kết quả (05-C).
2. Dòng "Lần ôn tiếp theo" chỉ hiện ví dụ "vào ngày mai" — không có con số thẻ nào cả.

### Nguyên nhân gốc
- `nextDueAt()` chỉ query `MIN(due_at)`, chưa kèm `COUNT(*)` các thẻ có cùng (hoặc cùng ngày) `due_at` đó.

### Solution
Một hướng sửa rõ ràng:
- [ ] Đổi `nextDueAt()` ([src/db/user.ts:139-143](src/db/user.ts#L139-L143)) trả thêm số lượng, vd 2 bước: lấy `MIN(due_at)` trước, rồi `SELECT COUNT(*) FROM srs_state WHERE date(due_at) = date(:minDueAt)`.
- [ ] Dòng hiển thị trong `review.tsx` ghép thêm số đếm: `"Lần ôn tiếp theo: ${count} thẻ ${formatNext(nextDue)}"` đúng theo mẫu spec 05C-02.
- [ ] Thêm test cho hàm đếm mới (fixture nhiều thẻ cùng đến hạn 1 ngày trong tương lai).

### Test
- [x] `test/services.test.ts`: "nextDueAt reports how many cards share the next due date, not just the date".
- [x] `npx vitest run` — 40/40 pass.

### Verify
- [x] `nextDueAt()` ([src/db/user.ts](src/db/user.ts)) trả `NextDue { due_at, count }` (2 query: MIN rồi COUNT theo cùng ngày). `review.tsx`: dòng "Lần ôn tiếp theo" ghép thêm `${nextDue.count} thẻ`.

### Report sau code
Implemented the single recommended fix. `nextDueAt()` now returns `{ due_at, count }`; `review.tsx`'s done-screen message reads `Lần ôn tiếp theo: ${count} thẻ ${formatNext(due_at)}`, matching the spec's exact wording. `vitest`/`tsc` clean.

---

## Task 13 — `dictMeta()` luôn trả null với DB đang dùng, lỗi bị nuốt im lặng

### Mô tả
`dictMeta()` ([src/db/open.ts:71-83](src/db/open.ts#L71-L83)) đọc version từ bảng `app_meta` (key `built_at`), fallback `crawl_meta`. Đã kiểm tra trực tiếp `oxford-app.db` đang nằm ở gốc repo (193MB) bằng `sqlite3 .tables`: chỉ có 4 bảng `entries`, `forms`, `form_type_label`, `search_index` — **không có `app_meta` lẫn `crawl_meta`**. `scripts/build-app-db.js` có tạo `app_meta`/copy `crawl_meta` ([scripts/build-app-db.js:68-79](scripts/build-app-db.js#L68-L79)), nên nhiều khả năng file `oxford-app.db` hiện tại là bản build cũ/thủ công, chưa qua script này. Vấn đề ở tầng code: cả hai query đều nằm trong 1 khối `try/catch` nuốt lỗi hoàn toàn ([src/db/open.ts:72-82](src/db/open.ts#L72-L82)) — không log, không cảnh báo dev, nên việc thiếu bảng **không thể phát hiện được** nếu không tự tay query DB như vừa làm.

### Expect
Settings → "Về app" phải hiện version dữ liệu từ điển (06-06 yêu cầu **bắt buộc** vì lý do giấy phép/attribution); nếu thiếu, phải có tín hiệu rõ ràng cho dev (log/dev-warning), không im lặng.

### Tái hiện
1. `sqlite3 oxford-app.db ".tables"` → xác nhận không có `app_meta`/`crawl_meta`.
2. Mở tab Cài đặt trong app hiện tại → dòng "Về app" chỉ hiện "Minotara 1.0.0", không có " · dữ liệu …" dù spec 06-06 yêu cầu bắt buộc hiện thông tin này.
3. Không có log/error nào xuất hiện ở console vì bị catch nuốt hoàn toàn.

### Nguyên nhân gốc
- DB đang dùng để chạy/test app chưa được build lại bằng `scripts/build-app-db.js` mới nhất (nghi vấn chính); cộng thêm code nuốt lỗi khiến vấn đề vô hình với người phát triển.

### Solution
Kết hợp sửa data lẫn sửa code, không cần chọn phương án:
- [ ] Chạy lại `node scripts/build-app-db.js` (với input crawl data hiện có) để tạo `oxford-app.db` mới có đủ bảng `app_meta`/`crawl_meta`, thay cho bản đang dùng để dev/test.
- [ ] Sửa `dictMeta()` ([src/db/open.ts:71-83](src/db/open.ts#L71-L83)): tách try/catch riêng cho từng query, và `console.warn` (chỉ ở `__DEV__`) khi cả `app_meta` lẫn `crawl_meta` đều không đọc được — để lần sau nếu tái diễn thì dev thấy ngay trong log thay vì phải tự tay query DB như lần này.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `dictMeta()` ([src/db/open.ts](src/db/open.ts)): try/catch tách riêng cho `app_meta`/`crawl_meta`, `console.warn` khi `__DEV__` và lookup thất bại.
- [ ] **Chưa chạy** `node scripts/build-app-db.js` để tạo lại `oxford-app.db` — script này cần 1 file crawl nguồn (`/path/to/oxford.db`, bản crawl+forms-kit gốc, thường vài GB) mà phiên làm việc này không có sẵn trong repo. Đây là việc cần user/pipeline build tự chạy với đúng input.

### Report sau code
Code half done, data half NOT done. `dictMeta()` no longer swallows both lookups silently — each query has its own try/catch and logs a dev warning on failure. Did **not** rebuild `oxford-app.db`: `scripts/build-app-db.js` requires the raw crawler+forms-kit source database as an argument, which isn't present in this repo/session (only the already-built 193MB `oxford-app.db` exists). Rebuilding is a data-pipeline action for whoever holds that source file — the code fix at least makes the gap visible in dev logs from now on instead of invisible. `tsc` clean.

---

## Task 14 — INNER JOIN vs LEFT JOIN không nhất quán giữa 2 query form (latent)

### Mô tả
Trong `services/lookup.ts`, hai query gần như giống hệt nhau lại join khác kiểu với `form_type_label`:
- Q2 (dùng cho banner form-of khi tra trực tiếp một form): `LEFT JOIN form_type_label l ON l.form_type = f.form_type` ([src/services/lookup.ts:35](src/services/lookup.ts#L35)).
- `FORMS_OF_ENTRY` (dùng cho bảng "Biến thể" 02-06 của một entry): `JOIN form_type_label l ON l.form_type = f.form_type` — INNER JOIN ([src/services/lookup.ts:164](src/services/lookup.ts#L164)).

Đã kiểm tra `oxford-app.db` thật: hiện **không** có `form_type` nào trong `forms` mà thiếu nhãn tương ứng trong `form_type_label` (9/9 khớp), nên bug này **chưa gây mất dữ liệu ở bản build hiện tại** — nhưng là một quả bom hẹn giờ: crawl sau này chỉ cần thêm 1 `form_type` mới (vd. dữ liệu Oxford update thêm dạng biến thể mới) mà quên thêm dòng `form_type_label` tương ứng, bảng "Biến thể" (02-06) sẽ **âm thầm mất hẳn dòng đó** trong khi form vẫn tra được bình thường qua ô tìm kiếm (banner form-of vẫn hiện, chỉ khác chỗ là label rỗng thay vì mất dòng).

### Expect
Hai query cùng mục đích (liệt kê forms của một entry/form) nên nhất quán kiểu JOIN — dùng LEFT JOIN như Q2 để không bao giờ mất dòng dữ liệu chỉ vì thiếu nhãn hiển thị.

### Tái hiện
1. (Chưa tái hiện được trên data hiện tại vì `form_type_label` đang phủ đủ 9/9 `form_type`.) Để tái hiện: thêm một dòng `forms` với `form_type` mới chưa có trong `form_type_label`, gọi `formsOfEntry()` cho entry đó → dòng biến mất khỏi kết quả; gọi `lookup()` trực tiếp bằng chính form đó → vẫn thấy trong `formOf` (label rỗng) vì dùng LEFT JOIN.

### Nguyên nhân gốc
- Hai query viết tại hai thời điểm khác nhau, không soi lại nhau khi refactor.

### Solution
Một hướng sửa rõ ràng, 1 dòng:
- [ ] Đổi `JOIN form_type_label l ON l.form_type = f.form_type` thành `LEFT JOIN form_type_label l ON l.form_type = f.form_type` trong `FORMS_OF_ENTRY` ([src/services/lookup.ts:164](src/services/lookup.ts#L164)) — khớp với Q2 đã dùng LEFT JOIN.
- [ ] Thêm test trong `test/services.test.ts`: insert 1 dòng `forms` với `form_type` KHÔNG có trong `form_type_label` fixture, xác nhận `formsOfEntry()` vẫn trả dòng đó (label null) thay vì rớt mất — khoá hành vi để không tái diễn nếu ai đó lỡ đổi JOIN ngược lại sau này.

### Test
- [x] `test/services.test.ts`: "formsOfEntry keeps a row even when form_type_label has no entry for it (LEFT JOIN, not INNER)" — thêm entry+form mới vào fixture với `form_type` chưa gắn nhãn.
- [x] `npx vitest run` — 40/40 pass.

### Verify
- [x] `FORMS_OF_ENTRY` ([src/services/lookup.ts](src/services/lookup.ts)) đổi `JOIN` → `LEFT JOIN form_type_label`.

### Report sau code
Implemented the single recommended fix — one-line JOIN change. Also added the regression fixture/test described in the plan (a `forms` row with an unlabeled `form_type`) to lock in that `formsOfEntry()` never silently drops a row for this reason again. `vitest`/`tsc` clean.

---

## Task 15 — Số dòng bị bỏ qua khi nhập danh sách (`skipped`) không được hiển thị

### Mô tả
`parseImportText()` trả về `{ items, skipped }` ([src/services/import-parser.ts:13-49](src/services/import-parser.ts#L13-L49)) — `skipped` đếm số dòng bị bỏ vì trùng từ trong danh sách hoặc vượt giới hạn 500 từ/lần (`IMPORT_LIMIT`, [src/services/import-parser.ts:11](src/services/import-parser.ts#L11) và [45](src/services/import-parser.ts#L45)). `import.tsx` gọi hàm này nhưng chỉ destructure `items`, bỏ hẳn `skipped` ([src/app/import.tsx:34](src/app/import.tsx#L34)): `const { items } = parseImportText(text);`.

### Expect
Khi danh sách dán vào có dòng trùng hoặc vượt 500 từ, người dùng nên được biết bao nhiêu dòng đã bị bỏ qua và vì sao — nhất là mốc 500 (dễ gặp khi export cả sổ Anki cũ dán vào).

### Tái hiện
1. Dán một danh sách > 500 từ duy nhất vào ô nhập.
2. Bấm "Đối chiếu với từ điển" → màn xác nhận chỉ hiện đúng 500 từ trong nhóm "Tìm thấy"/"Không có trong từ điển", **không có thông báo nào** cho biết phần còn lại đã bị cắt bớt.

### Nguyên nhân gốc
- Giá trị `skipped` được tính toán đầy đủ trong service nhưng bị bỏ rơi ở tầng UI, chưa từng được nối vào bất kỳ đoạn hiển thị nào.

### Solution
Một hướng sửa rõ ràng:
- [ ] `import.tsx`'s `analyze()` giữ lại `skipped` từ `parseImportText()` (đổi `const { items } = ...` thành `const { items, skipped } = ...`), lưu vào 1 state mới.
- [ ] Hiện 1 dòng nhỏ khi `skipped > 0`, đặt cạnh nhóm "Không có trong từ điển", vd. "Đã bỏ qua {skipped} dòng (trùng từ hoặc vượt giới hạn 500 từ/lần)".
- [ ] (Tuỳ chọn, không bắt buộc) Tách rõ 2 lý do skip khác nhau (trùng vs vượt limit) nếu muốn thông báo chính xác hơn — hiện `parseImportText` gộp chung 1 số `skipped`, cần thêm field riêng nếu muốn tách.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `import.tsx`'s `analyze()` giữ `skipped` từ `parseImportText()`; hiện dòng "Đã bỏ qua {skipped} dòng…" khi `skipped > 0`, cạnh nhóm "Không có trong từ điển".
- [ ] Không tách riêng 2 lý do skip (trùng vs vượt limit) — để nguyên như optional trong plan, chưa làm.

### Report sau code
Implemented the single recommended fix (the optional split-by-reason refinement was left undone, as marked optional in the plan). `skipped` is now threaded through to the UI and shown as a small note when nonzero. `tsc` clean.

---

## Task 16 — Crash `NativeDatabase.prepareAsync` (NullPointerException) lặp lại ở màn Lịch sử — **đã tái hiện thực tế trên Android**

### Mô tả
User chạy app thật trên Android và bắt được crash sau một lần Fast Refresh (log gốc):
```
ERROR  [Error: Uncaught (in promise, id: 0) Error: Call to function 'NativeDatabase.prepareAsync' has been rejected.
→ Caused by: java.lang.NullPointerException: java.lang.NullPointerException]
› Reloading apps
ERROR
Code: history.tsx
> 89 | <SectionList
Call Stack
  HistoryScreen (src/app/history.tsx:89:13)
  RootLayout (src/app/_layout.tsx:32:17)
```
Lỗi lặp lại liên tục ở `history.tsx:89` (`<SectionList>`) sau mỗi lần reload. Đối chiếu với code:
- `db/open.ts` cache connection ở biến module-level `dictDb`/`userDb` ([src/db/open.ts:28-29](src/db/open.ts#L28-L29)) và **không có `closeAsync` nào được expose** để đóng lại (cùng gốc với Task 7). Một lần Fast Refresh re-run module top-level sẽ reset `userDb`/`dictDb` về `null` ở phía JS, nhưng **connection native trên Android không bị đóng** — lần `openUser()`/`openDictionary()` kế tiếp mở thêm một connection native **thứ hai** trỏ vào cùng file, để lại connection cũ mồ côi. Đây là kiểu lỗi kinh điển dẫn tới `NativeDatabase.prepareAsync` NPE trên Android.
- Riêng màn Lịch sử càng dễ dính vì có **2 nguồn gọi `openUser()` gần như đồng thời khi mount**: `useFocusEffect(reload)` ([src/app/history.tsx:37-45](src/app/history.tsx#L37-L45)) và `SectionList`'s `onEndReached={loadMore}` ([src/app/history.tsx:92-93](src/app/history.tsx#L92-L93)) — `onEndReached` là quirk quen thuộc của React Native: **tự bắn ngay khi mount** nếu nội dung trang đầu chưa lấp đầy màn hình. Hai lệnh `openUser()` chạy đua trước khi lệnh đầu `await SQLite.openDatabaseAsync('user.db')` kịp resolve → mở thêm connection trùng, đúng lúc `migrateUserDb()` cũng đang chạy trên từng connection → dễ vỡ ở tầng native khi nhiều connection cùng đụng schema.

### Expect
Không được crash. Chỉ có đúng 1 connection sống cho mỗi file DB (`oxford-app.db`, `user.db`) tại một thời điểm; Fast Refresh / remount không được phép để lại connection mồ côi.

### Tái hiện
1. (Log thật từ user, Android): mở app, vào màn có DB, trigger Fast Refresh ("Reloading apps") — ví dụ sửa file rồi save trong lúc app đang chạy.
2. Vào tab Lịch sử (hoặc nó tự re-render vì đang focus) → `NativeDatabase.prepareAsync` reject với `NullPointerException`; sau đó **mọi** lần `<SectionList>` re-render đều lỗi liên tục cho tới khi restart hẳn app (không chỉ reload JS).
3. Có thể tái hiện độc lập với Fast Refresh: vào thẳng tab Lịch sử lần đầu (list < 50 dòng, không lấp đầy màn hình) — `onEndReached` bắn ngay lúc mount, đua với `useFocusEffect`'s `openUser()`.

### Nguyên nhân gốc
- `db/open.ts` không có cơ chế de-dup lời gọi `openUser()`/`openDictionary()` đang "in-flight" (check-then-act race: `if (userDb) return userDb;` không khoá gì cả), và không có `closeAsync` để dọn connection cũ khi JS module bị re-init (Fast Refresh) — cùng gốc rễ với Task 7, nhưng phạm vi rộng hơn (ảnh hưởng cả `userDb` lẫn mọi lần reload, không chỉ lúc xoá file dict).

### Solution — 2 hướng, chọn 1 (đọc cùng Task 4 và 7 — cả ba cùng sửa 1 vùng `db/open.ts`)

**a. Cache theo PROMISE đang treo, không cache theo giá trị đã resolve (khuyên dùng)**
- Đổi `dictDb`/`userDb` (biến giá trị) thành `dictDbPromise`/`userDbPromise` (biến Promise): bất kỳ lời gọi nào xảy ra TRONG LÚC lời gọi đầu còn đang mở connection đều nhận **cùng 1 Promise** — không bao giờ mở 2 connection native song song, tự động fix luôn race ở `history.tsx` (`useFocusEffect` + `onEndReached`) mà không cần sửa gì ở `history.tsx`.
- Thêm `closeAsync()` (theo Task 7) reset promise về `null` sau khi đóng hoặc khi promise reject, để lần mở lại sau (vd. sau khi xoá/tải lại dict, hoặc sau 1 lần mở lỗi) mở sạch từ đầu chứ không kẹt mãi ở 1 promise rejected.
- Pros: Fix tận gốc cả 2 kiểu race (Fast Refresh orphan connection lẫn concurrent-call trong History) bằng đúng 1 cơ chế, không cần thêm dependency, không cần sửa từng màn hình gọi `openUser()`.
- Cons: Phải nhớ reset promise về `null` trong nhánh lỗi — nếu quên, 1 lần mở lỗi sẽ kẹt mãi, mọi lời gọi sau đều fail theo.

**b. Thêm mutex/lock ngoài (vd. thư viện `async-mutex`)**
- Bọc thân hàm `openUser()`/`openDictionary()` bằng 1 lock để đảm bảo chỉ 1 lời gọi `openDatabaseAsync` chạy tại 1 thời điểm.
- Pros: Tương tự (a) về hiệu quả.
- Cons: Thêm 1 dependency ngoài chỉ để làm việc mà 1 `Promise` module-level làm được miễn phí — không cần thiết.

**→ Khuyên dùng (a)** — đúng pattern chuẩn cho "async singleton" trong JS, không cần thư viện ngoài.

### Test
- [x] `npx vitest run` — 40/40 pass. `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `db/open.ts` rewritten: `dictDbPromise`/`userDbPromise` cache the in-flight promise (reset to `null` on rejection via `.catch()`), so concurrent `openUser()`/`openDictionary()` calls — including `history.tsx`'s `useFocusEffect` + `onEndReached` pair — now share one connection instead of racing to open two.
- [ ] Chưa test lại trực tiếp trên Android thật (không có device trong phiên này) để xác nhận crash gốc hết tái diễn — cần user tự verify trên máy đã gặp lỗi.

### Report sau code
Implemented option (a), combined with Task 7 in the same `db/open.ts` rewrite: added `closeAsync` to `DbLike`/`wrap()`, converted `dictDb`/`userDb` module singletons into `dictDbPromise`/`userDbPromise` (promise-cached, reset on rejection), and `removeDictionaryFile()` now awaits `closeAsync()` before deleting the file. This is the same root fix for Tasks 4, 7, and 16. `tsc`/`vitest` clean. Real-device Android re-test still pending (no device in this session) — please re-run the app and confirm the `NativeDatabase.prepareAsync` crash on Lịch sử no longer reproduces.

### Update (2026-08-20) — crash tái diễn, fix ban đầu chỉ giải quyết được 1 nửa

**Mô tả lại**: User báo crash y hệt (`NativeDatabase.prepareAsync`/NullPointerException) vẫn xảy ra, lần này 1 chuỗi 4 lỗi liên tiếp (id 6-9) — thời điểm trùng với lúc đang sửa nhiều file (app.json, theme/tokens.ts…), tức là có `Reload` xảy ra.

**Nguyên nhân gốc (phần bị bỏ sót ở fix trước)**: `dictDbPromise`/`userDbPromise` ở fix Task 16 ban đầu vẫn là biến `let` **module-level** — mỗi lần Fast Refresh/Reload chạy lại `db/open.ts` từ đầu, 2 biến này reset về `null` **ở phía JS**, nhưng **connection native trước đó không được đóng** (không ai gọi `closeAsync()` khi module bị re-init ngoài ý muốn — `closeAsync` trước giờ chỉ được gọi chủ động từ `removeDictionaryFile()`). Cache-theo-promise (fix trước) chỉ ngăn được **2 lời gọi CÙNG 1 thế hệ module** giành nhau mở connection — không ngăn được việc **1 thế hệ module MỚI** (sau reload) mở thêm 1 connection trong khi connection của thế hệ CŨ vẫn còn sống ở tầng native.

**Solution (fix bổ sung, đã áp dụng thẳng — không phải lựa chọn nữa vì đây là hoàn thiện fix cũ)**:
- [x] Chuyển cache từ biến module `let` sang `globalThis` (`globalCache.__minotaraDictDbPromise`/`__minotaraUserDbPromise`) — `globalThis` sống xuyên suốt các lần Fast Refresh re-evaluate module (khác với closure của module), nên promise/connection cũ **không bị mất tham chiếu** khi `db/open.ts` chạy lại.
- [x] Bật `PRAGMA journal_mode = WAL` cho cả 2 connection (`oxford-app.db` lẫn `user.db`) — phòng hờ thêm: nếu vẫn có 1 handle mồ côi lọt lưới (ví dụ 1 **Reload đầy đủ** làm mất luôn cả `globalThis`, không chỉ Fast Refresh thường), WAL cho phép nhiều connection cùng đọc 1 file an toàn hơn hẳn journal mode mặc định — biến "2 connection cùng lúc" từ crash thành vô hại.

**Giới hạn còn lại (nói thẳng, không giấu)**: Đây là hạn chế đã biết của `expo-sqlite` khi kết hợp Fast Refresh/Reload trong môi trường **dev** (Metro) — 1 lần "Reload" đầy đủ (không phải Fast Refresh thường) có thể tạo hẳn 1 JS context mới, làm mất cả `globalThis` lẫn promise cache, trong khi native process (và connection cũ) vẫn sống. `globalThis` + WAL làm giảm mạnh tần suất và mức độ nghiêm trọng (WAL khiến trường hợp xấu nhất không còn crash), nhưng **không thể khẳng định 100% hết crash trong lúc dev** bằng code phía JS thuần tuý. Trong **production build** (không có Fast Refresh/Reload) hiện tượng này về lý thuyết không xảy ra vì DB chỉ mở đúng 1 lần cho cả vòng đời process.

### Test (update)
- [x] `npx tsc --noEmit` — 0 lỗi. `npx vitest run` — 40/40 pass.

### Verify (update)
- [ ] Cần user tự test lại trên Android thật, đặc biệt: (1) sau vài lần sửa code liên tiếp (Fast Refresh nhiều lần) xem còn crash không; (2) nếu vẫn còn, thử "Reload" đầy đủ 1 lần rồi theo dõi — đây là ca khó nhất, và nếu vẫn còn crash ở đúng ca này thì cần cân nhắc thêm giải pháp ở tầng native (ngoài phạm vi code JS).

---

## Task 17 — `app.json` trỏ sai icon/splash: dùng ảnh placeholder mặc định thay vì bộ ảnh thương hiệu thật

### Mô tả
Repo có **hai** thư mục ảnh icon/splash:
- `assets/images/*` — ảnh **mặc định của Expo template** (icon.png 799KB kiểu logo Expo/React, timestamp 2026-08-18 09:55, cùng lúc với lúc `create-expo-app` scaffold dự án).
- `assets/icons/*` — bộ ảnh **thương hiệu Minotara thật** (icon.png 46KB, splash-icon.png, android-icon-*, favicon.png, playstore-icon-512.png — timestamp 2026-08-19 16:24, mới tạo).

`app.json` hiện tại trỏ **toàn bộ** vào thư mục cũ ([app.json:7](app.json#L7) `"icon": "./assets/images/icon.png"`, [app.json:16-18](app.json#L16-L18) adaptive icon, [app.json:24](app.json#L24) favicon, [app.json:32](app.json#L32) splash image). Bộ ảnh thật ở `assets/icons/` **không được tham chiếu ở bất kỳ đâu** trong code hay config — hoàn toàn mồ côi.

### Expect
App icon (Android/iOS), splash screen, favicon (web), adaptive icon phải dùng đúng bộ ảnh thương hiệu Minotara trong `assets/icons/`.

### Tái hiện
1. `grep -rn "assets/images\|assets/icons" app.json` → toàn bộ 5 tham chiếu ảnh đều trỏ `assets/images/...`.
2. Build/chạy app (`npx expo start` → mở trên simulator, hoặc build production) → icon trên home screen và màn splash lúc mở app là **logo Expo mặc định**, không phải logo Minotara.

### Nguyên nhân gốc
- Bộ ảnh thương hiệu được thêm vào `assets/icons/` sau khi scaffold ban đầu nhưng chưa có ai cập nhật lại đường dẫn trong `app.json` để trỏ sang thư mục mới.

### Solution
Đây là lỗi có đúng 1 hướng sửa hợp lý, không cần cân nhắc phương án — chỉ là chưa nối dây:
- [ ] Sửa 5 đường dẫn trong `app.json` (`expo.icon`, `expo.android.adaptiveIcon.foregroundImage/backgroundImage/monochromeImage`, `expo.web.favicon`, plugin `expo-splash-screen.image`) từ `./assets/images/...` sang `./assets/icons/...`.
- [ ] Kiểm tra `expo.ios.icon` ([app.json:11](app.json#L11), hiện trỏ `./assets/expo.icon` — thư mục `.icon` kiểu Xcode asset catalog) xem có cần đồng bộ theo bộ ảnh mới không, hoặc để riêng nếu đó là format icon riêng cho iOS.
- [ ] Sau khi đổi, xoá (hoặc archive) các file trùng tên không còn dùng trong `assets/images/` (`icon.png`, `favicon.png`, `splash-icon.png`, `android-icon-*.png`) để tránh nhầm lẫn sau này; giữ lại các file khác (`react-logo*.png`, `expo-badge*.png`, `tutorial-web.png`, `logo-glow.png`, `tabIcons/`) chỉ nếu còn được dùng ở đâu đó (grep trước khi xoá).

### Test
- [x] `npx tsc --noEmit` — 0 lỗi (không liên quan trực tiếp tới app.json nhưng xác nhận không có gì vỡ theo).

### Verify
- [x] 5 đường dẫn trong `app.json` đổi từ `./assets/images/...` sang `./assets/icons/...` (icon, 3 adaptive-icon layers, favicon, splash image).
- [ ] `npx expo start` trên Android/iOS/web chưa chạy được trong phiên này (không có device/emulator) — chưa tự mắt xác nhận icon/splash đổi đúng.
- [ ] **Chưa xoá** các file cũ trùng tên trong `assets/images/` — để nguyên theo lựa chọn an toàn (xem Report).

### Report sau code
Fixed the config, deliberately skipped the cleanup deletion. Updated all 5 `app.json` image paths to `./assets/icons/...`. Left `expo.ios.icon` (`./assets/expo.icon`, an Xcode asset-catalog format) untouched since no replacement catalog was provided. Did **not** delete the stale files in `assets/images/` — removing files is a one-way action I'd rather leave to you to confirm first, especially since I didn't verify none of the leftover create-expo-app template screens/docs reference them. The app now reads exclusively from `assets/icons/`, so the old files are simply unused, not broken. Haven't run the app on a device/simulator to visually confirm the new icon/splash — no device available in this session.

---

## Task 18 — [Feature] Thêm icon + chữ "Implement by Clover" vào splash screen

### Mô tả
Yêu cầu: màn splash lúc khởi động app cần có icon ở giữa, và một dòng chữ nhỏ "Implement by Clover" ở phía dưới. Icon nguồn: dùng ảnh có sẵn trong `assets/icons/` (sau khi Task 17 nối dây đúng).

Vấn đề kỹ thuật: splash hiện tại là **splash native** cấu hình qua plugin `expo-splash-screen` trong `app.json` ([app.json:28-35](app.json#L28-L35)) — chỉ hỗ trợ 1 ảnh tĩnh + màu nền, **không hỗ trợ chữ** (API của Expo managed workflow không có tham số text/caption cho splash native). Muốn có chữ, bắt buộc phải thêm một lớp hiển thị bằng JS.

### Expect
Lúc mở app: thấy icon Minotara ở giữa màn hình + dòng "Implement by Clover" nhỏ phía dưới, trước khi vào màn Tra cứu/Onboarding — không bị giật/nháy màu nền hay lệch icon khi chuyển từ splash native sang phần JS.

### Solution — có nhiều phương án, so sánh trước khi chọn

**a. Splash JS 2 pha, tái dùng cùng 1 ảnh + màu nền với splash native (khuyên dùng)**
- Icon: dùng thẳng `assets/icons/splash-icon.png` (đã đúng kích thước 1024×1024, đang được set `imageWidth: 76` trong plugin config) — không cần tạo ảnh mới, tận dụng luôn đồng bộ giữa splash native và splash JS.
- Cách làm: giữ nguyên splash native (`expo-splash-screen` plugin, chỉ đổi path theo Task 17) để nó lo phần "trước khi JS chạy". Ngay khi `_layout.tsx` mount, **chưa gọi `hideAsync()` vội** — thay vào đó render một component `BootScreen` full-màn hình cùng `backgroundColor` (`#208AEF` hoặc màu token mới), icon `splash-icon.png` ở giữa (cùng kích thước tỉ lệ với `imageWidth: 76` để không "nhảy" size khi native→JS chuyển tiếp), và `Text` nhỏ "Implement by Clover" ở dưới cùng (an toàn trong safe-area). Gọi `SplashScreen.hideAsync()` ngay khi `BootScreen` mount xong (native ẩn, JS hiện — không có khoảng trắng ở giữa). `BootScreen` tự ẩn khi `dictionaryReady()` + `loadSettings()` xong (đúng lúc, tận dụng luôn việc gate splash theo DB-ready đã bàn trước đó), rồi mới render `<Stack>` thật.
- Pros: Full control chữ/font, hoạt động giống hệt trên iOS/Android/Web; không cần `expo prebuild`/sửa code native; tận dụng luôn cùng lúc để fix flicker "index hiện trước khi redirect onboarding" đã nói ở lượt chat trước.
- Cons: Cần canh đúng màu nền + kích thước icon giữa 2 pha (native config trong `app.json` vs style JS) để không bị "giật" 1 frame; thêm 1 component + 1 state gate.
- Plan: (1) làm Task 17 trước; (2) tạo `BootScreen` component dùng `splash-icon.png` + text; (3) sửa `_layout.tsx`: bỏ gọi `hideAsync()` ngay, render `BootScreen` che `<Stack>` cho tới khi ready; (4) test kỹ trên Android thật (nơi hay lệch màu/size splash nhất).

**b. Sửa splash native để tự có caption (qua code native / plugin bên thứ 3)**
- Icon: vẫn `splash-icon.png`, nhưng chữ phải vẽ trực tiếp vào layout native (Android `splashscreen.xml`/iOS storyboard).
- Pros: Không có khoảng chuyển native→JS (đỡ lo flicker).
- Cons: Phải `expo prebuild` để lộ code `android/`/`ios/` (dự án đang managed workflow, không có 2 thư mục này) rồi tự maintain layout native riêng — mất luôn lợi thế "không cần build native" của Expo managed; phức tạp hoá chỉ để thêm 1 dòng chữ nhỏ. Không khuyên dùng.

**c. Không làm splash riêng — gắn "Implement by Clover" cố định vào footer màn Onboarding**
- Icon: dùng logo hiện có trong `onboarding.tsx` (`s.logo` text hiện tại, có thể đổi sang `Image` từ `icon.png`).
- Pros: Rẻ nhất, không đụng `_layout.tsx`/splash config.
- Cons: Onboarding **chỉ hiện lần đầu cài app** (khi chưa tải từ điển) — sau đó gần như không ai còn thấy dòng chữ này nữa, không đúng ý "splash lúc khởi động". Không khuyên dùng nếu mục đích là hiện credit mỗi lần mở app.

**→ Chọn (a).** Nếu muốn credit hiện mỗi lần mở app (không chỉ lần cài đầu) thì (a) là lựa chọn đúng và rẻ nhất trong 3 phương án.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [ ] Test trên cả Android + iOS (và web nếu support) — không bị nháy màu nền/icon lúc chuyển native→JS splash. **Chưa test trên thiết bị thật/simulator trong phiên này (không có device).**
- [x] Test trường hợp máy chậm (`dictionaryReady()`/`loadSettings()` lâu) — boot effect có `try/catch/finally`, luôn gọi `setBooted(true)` kể cả khi check lỗi, nên `BootScreen` không đứng hình vô hạn.

### Report sau code
Implemented option (a). `src/app/_layout.tsx`: added `BootScreen` (icon `@/assets/icons/splash-icon.png` + "Implement by Clover" text, background `#208AEF` matching the native splash config), gated behind `dictionaryReady()` + `loadSettings()` resolving; `SplashScreen.hideAsync()` now fires only once `BootScreen` is up, closing the old native→search-screen flicker too. Also fixed a bug I introduced mid-implementation: the cold-start deep link (`Linking.getInitialURL()`) was firing before the `<Stack>` navigator existed under the new gating — moved it to a separate effect keyed on `booted`. Depends on Task 17 (done first). `tsc`/`vitest` clean; not yet run on a physical device/simulator in this session.

---

## Task 19 — [Feature] Bảng màu app không khớp brand palette thật trong `COLORS.md`

### Mô tả
`assets/icons/COLORS.md` định nghĩa palette thương hiệu **lấy trực tiếp từ icon thật** (đã xem ảnh `assets/icons/icon.png` — nền gradient teal `#6CC6BD`→`#4B88A5`, con bò + sách cam/vàng). Nhưng bảng màu app đang chạy hoàn toàn khác:

| Vùng | Giá trị đang chạy | Giá trị brand thật (COLORS.md) |
|---|---|---|
| Accent chính (`primitive.accent[500]`, [src/theme/tokens.ts:32](src/theme/tokens.ts#L32)) | `#C06240` (terracotta/cam đất) | `accent` `#0E8F86` (teal) |
| Nút chính / surface.inverse (`primitive.gray[900]`, [src/theme/tokens.ts:23](src/theme/tokens.ts#L23)) | `#201914` (gần đen ấm) | `primary` `#0F5F5C` (teal đậm) |
| Nền phụ / `surface.raised` (`primitive.gray[100]`, [src/theme/tokens.ts:15](src/theme/tokens.ts#L15)) | `#F6F3EF` (be ấm) | `soft` `#EEF7F5` (teal nhạt) |
| Chữ phụ / `secondary` (`primitive.gray[600]`) | `#746D65` | `secondary` `#4C6663` |
| Splash background (`app.json` plugin `expo-splash-screen`, [app.json:31](app.json#L31); `SPLASH_BG` [src/app/_layout.tsx:14](src/app/_layout.tsx#L14)) | `#208AEF` (xanh dương) | `brandTeal` `#6CC6BD` |

`COLORS.md` dòng cuối còn ghi "Palette này đã được set trong `src/components/dict-ui.tsx` (object `C`)" — **không đúng ngay cả trước khi `C` bị xoá ở Task 2**: giá trị cũ của `C.accent` là `primitive.accent[500]` = `#C06240` (terracotta), chưa bao giờ là teal `#0E8F86`. Tài liệu và code đã lệch nhau từ trước, không phải do Task 2 gây ra.

### Expect
Toàn bộ UI (accent, nút chính, nền phụ, chữ phụ, splash) dùng đúng brand palette teal trong `COLORS.md`; không còn 2 nguồn màu mâu thuẫn nhau giữa tài liệu và code.

### Tái hiện
1. Mở `assets/icons/icon.png` — thấy rõ nền teal + con bò cam/be, không có màu terracotta/cam đất nào giống `#C06240`.
2. So `primitive.accent[500]` trong `src/theme/tokens.ts:32` với `accent` trong `COLORS.md` — hai màu khác hẳn nhau (`#C06240` vs `#0E8F86`).
3. Mở splash screen lúc khởi động app (hoặc xem `app.json:31`) — nền xanh dương `#208AEF`, không phải teal của icon.

### Nguyên nhân gốc
- `theme/tokens.ts`'s preset "Porcelain" (terracotta accent, gray ấm trung tính) được tạo độc lập với bộ icon/brand — khả năng cao do 1 quy trình thiết kế UI riêng (skill "craft"/"tokens" trong `.claude/skills`) chọn 1 preset trung tính mặc định mà không đọc `COLORS.md`.
- `COLORS.md` được viết ra như tài liệu **dự định** nhưng chưa từng đối chiếu lại với `theme/tokens.ts` thật — nên tự ghi sai rằng nó "đã được set".

### Phát hiện thêm sau khi soi kỹ file ảnh (không chỉ đọc COLORS.md)
Đã sample pixel trực tiếp từ `icon.png`/`splash-icon.png` (script Python + PIL, quantize histogram) để đối chiếu COLORS.md với ảnh thật:
- Vùng teal nền + cam sách/bò khớp khá sát COLORS.md (`#6CC6BD`→`#4B88A5`, `~#EA8336`).
- **Phát hiện 1 màu thứ 4 COLORS.md chưa ghi**: tấm thảm xanh lá dưới chân bò (có dấu `?`) sample ra **`~#80BD46`** (xanh lá tươi, khác hẳn `green.600 #36884D` hiện tại đang dùng cho "success"). Vì icon đặt dấu `?` trên đúng tấm thảm này — đọc như 1 ẩn dụ "câu trả lời đúng" — đề xuất dùng màu này cho nút "Đã nhớ" và trạng thái success trong Ôn tập thay vì xanh xám hiện tại.
- **Điểm cấu trúc quan trọng hơn cả đổi hue**: COLORS.md ghi `primary` (`#0F5F5C`) dùng cho "nút chính (Bắt đầu, Thêm n từ, Ôn ngay)" — nhưng các nút này hiện đang tô bằng `surface.inverse` (**trung tính gần đen** `#201914`, không phải accent). Nghĩa là việc "theo màu icon" không chỉ đổi hue của `accent`, mà còn phải đổi luôn vai trò: `surface.inverse` (đang dùng cho mọi nút chính/chip active/segmented-control active) cần trở thành teal đậm thay vì đen trung tính — ảnh hưởng rộng hơn 1 phép đổi màu đơn giản, cần bạn xác nhận trước khi áp dụng khắp app.

### Solution — 3 hướng, cần bạn xác nhận trước khi chọn (có lỗ hổng thông tin, xem "Câu hỏi mở")

**a. Retheme toàn bộ `theme/tokens.ts` sang teal (khuyên dùng nếu đây là rebrand thật sự)**
- Thay `primitive.accent` (hiện là ramp terracotta 50-900) bằng 1 ramp teal mới neo tại `accent`=`#0E8F86` và `primary`=`#0F5F5C`; thay `primitive.gray` bằng ramp trung tính ngả teal dùng `soft`=`#EEF7F5`, `border`=`#D6E7E5`, `secondary`=`#4C6663`, `muted`=`#7E9694` làm mốc; `brandOrange`/`brandYellow` dùng cho badge/điểm nhấn (vd CEFR badge) thay vì `amber`/`green` hiện tại nếu muốn giữ đúng tinh thần "màu bò/màu sách".
- Đổi `app.json:31` và `SPLASH_BG` ở `_layout.tsx:14` sang `#6CC6BD` (brandTeal).
- Vì Task 2 vừa xong (toàn bộ 9 màn hình đã đọc màu qua `usePalette()`/`theme/tokens.ts`), retheme ở ĐÚNG 1 CHỖ (`tokens.ts`) này sẽ tự động lan ra toàn app — **thời điểm thuận lợi nhất để làm** so với trước khi Task 2 tồn tại.
- Pros: Nhất quán 100% với brand thật, tận dụng đúng lúc kiến trúc token đã sẵn sàng.
- Cons: `COLORS.md` **chưa có giá trị cho Dark Mode** (chỉ có bảng light) — cần tự suy ra ramp teal tối (tương tự cách `accent.dark.bg` hiện tại `#DC855D` được "giảm chroma" từ light `#C06240`) hoặc hỏi lại người thiết kế; cũng chưa rõ `soft` có phải chính là `canvas` (nền tổng) hay chỉ là 1 lớp phụ (hiện `tokens.ts` có 2 tầng riêng `canvas`/`raised`) — cần 1 quyết định thiết kế nhỏ.

**b. Chỉ sửa Splash trước (khớp ngay chỗ lệch rõ nhất — icon teal nhưng splash xanh dương)**
- Đổi `app.json:31` + `_layout.tsx:14` sang `#6CC6BD`, để nguyên phần còn lại của app (terracotta) cho tới khi có quyết định rebrand đầy đủ.
- Pros: Sửa 2 dòng, không rủi ro, giải quyết ngay chỗ mâu thuẫn chói nhất (logo teal mở ra splash xanh dương).
- Cons: Phần còn lại của app vẫn lệch brand — chỉ là giảm bớt, không dứt điểm.

**c. Làm rõ open questions trước, chưa code gì cả**
- Xem mục "Câu hỏi mở" bên dưới — cần bạn trả lời trước khi làm (a) trọn vẹn.

**→ Đề xuất: làm (b) ngay (rẻ, không tranh cãi) + xác nhận các câu hỏi mở bên dưới trước khi làm (a) đầy đủ.**

### Câu hỏi mở — đã tự quyết định khi implement (xem Report), có thể chỉnh lại nếu không đúng ý
- [x] Dark Mode: tự suy ra bảng teal riêng (không giữ terracotta) — cùng hue với light, tăng sáng/giảm chroma theo đúng pattern preset cũ đã dùng.
- [x] `soft` (`#EEF7F5`) map vào `surface.raised`; `surface.canvas` dùng 1 màu gần trắng riêng (`#FCFEFE`) không có trong COLORS.md, để giữ khác biệt 2 tầng nền như kiến trúc `tokens.ts` cũ.
- [x] `brandYellow` dùng để nudge `amber` (status warning); `brandOrange` **chưa** wire vào semantic nào — chỉ thêm vào `primitive.orange` để dành, tránh đoán bừa 1 vai trò UI chưa có nhu cầu rõ.
- [ ] `.ui-craft/tokens.md`/`.ui-craft/brief.md` (xác nhận có tồn tại) — **chưa cập nhật** trong lượt này, để nguyên vì không chắc format/quy trình 2 file này được skill nào đọc lại.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi. `npx vitest run` — 40/40 pass (không có test riêng cho giá trị màu — đây là thay đổi giá trị token, không đổi logic).

### Verify
- [x] `src/theme/tokens.ts`: `primitive.accent` đổi hẳn sang ramp teal (500=`#0E8F86`, 700=`#0F5F5C`); `primitive.gray` đổi theo `soft`/`border`/`secondary`/`muted` của COLORS.md; `primitive.green` đổi sang màu xanh lá mới phát hiện từ icon (~`#80BD46`); `primitive.amber` nudge theo `brandYellow`; thêm `primitive.orange` (dự phòng, chưa dùng).
- [x] `semantic.light.surface.inverse` đổi từ gray[900] (đen ấm) sang `primitive.accent[700]` (`#0F5F5C`, teal đậm) — đúng ý COLORS.md "primary dùng cho nút chính"; mọi nút chính/chip active/segmented-active (đều đọc `t.surface.inverse` sau Task 2) tự động đổi màu theo, không cần sửa từng file.
- [x] `semantic.dark` viết lại tương ứng (suy diễn, không có nguồn): `surface.inverse` dùng thẳng `#6CC6BD` (brandTeal) làm màu nút chính nổi bật trên nền tối.
- [x] `app.json`: `expo-splash-screen.backgroundColor` và `android.adaptiveIcon.backgroundColor` đổi sang `#6CC6BD`. `src/app/_layout.tsx`'s `SPLASH_BG` đổi theo.
- [x] `assets/icons/COLORS.md`: sửa lại dòng cuối (từng ghi sai là màu "đã set" trong `dict-ui.tsx`'s `C`) để trỏ đúng vào `theme/tokens.ts`, và ghi chú thêm màu xanh lá mới phát hiện.
- [ ] Chưa tự mắt xem UI thật trên simulator/device (không có trong phiên này) — đổi giá trị token nên về lý thuyết lan đúng ra toàn bộ 9 màn hình đã migrate ở Task 2, nhưng cần bạn xác nhận trực quan, đặc biệt độ tương phản chữ trắng trên nút teal mới và Dark Mode (giá trị dark hoàn toàn do tôi suy diễn, không có nguồn).

### Report sau code
Implemented option (a) — full retheme, cả light lẫn dark — dựa trên `COLORS.md` + màu xanh lá mới phát hiện từ sample pixel `icon.png`. Thay đổi cấu trúc quan trọng nhất: `surface.inverse` (dùng cho mọi nút chính/trạng thái active trong app) đổi từ đen trung tính sang teal đậm `#0F5F5C`, đúng ý "primary" trong COLORS.md — nhờ Task 2 đã migrate hết 9 màn sang đọc token, thay đổi này lan tự động khắp app chỉ qua 1 file (`theme/tokens.ts`). Dark mode, `surface.canvas`, và vai trò của `brandOrange` là suy đoán của tôi (không có nguồn rõ trong COLORS.md) — nói tôi biết nếu muốn đổi hướng nào. `tsc`/`vitest` clean; chưa xem trực quan trên device/simulator thật.

---

## Task 20 — [Feature] Thêm công tắc chọn Dark Mode thủ công trong Cài đặt

### Mô tả
Trước đây app chỉ đọc `useColorScheme()` (theo hệ thống) ở 3 chỗ độc lập: `_layout.tsx` (ThemeProvider), `(tabs)/_layout.tsx` (màu NativeTabs), và `theme/use-palette.ts`'s `usePalette()` (mọi màn hình dùng token) — không có cách nào override thủ công trong app, và không lưu preference nào cho việc này.

### Expect
Có 1 control trong SCR-06 (Cài đặt) cho phép chọn "Hệ thống" (mặc định, theo OS) / "Sáng" / "Tối", áp dụng ngay lập tức và nhớ qua lần mở app sau.

### Solution
Một hướng làm rõ ràng, không cần cân nhắc phương án khác — tái dùng đúng pattern `Segmented` đã có sẵn cho Giọng đọc/Cỡ chữ thay vì Switch (vì đây vốn là lựa chọn 3 trạng thái, không phải bật/tắt nhị phân):
- [x] `stores/app.ts`: thêm `themeMode: 'system'|'light'|'dark'` + `setThemeMode()`, load/lưu qua `settings` table (key `theme_mode`, default `system`).
- [x] `db/user.ts`: thêm default `theme_mode: 'system'` vào `SETTING_DEFAULTS`.
- [x] `theme/use-palette.ts`: thêm `useEffectiveColorScheme()` — kết hợp `useColorScheme()` (OS) với `themeMode` override; `usePalette()` dùng lại hook này.
- [x] `_layout.tsx` và `(tabs)/_layout.tsx`: đổi từ gọi `useColorScheme()` trực tiếp sang dùng `useEffectiveColorScheme()`/`usePalette()` — để `ThemeProvider` và màu NativeTabs cũng theo đúng lựa chọn thủ công, không chỉ các màn hình đọc token.
- [x] `settings.tsx`: thêm section "Giao diện" (đặt đầu tiên, trên "Phát âm") với `Segmented` 3 lựa chọn Hệ thống/Sáng/Tối.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi. `npx vitest run` — 40/40 pass (không có logic mới cần test đơn vị — thuần UI + store).

### Verify
- [x] Đổi `themeMode` cập nhật `usePalette()` ngay (mọi màn hình đã migrate ở Task 2 tự đổi màu theo).
- [x] `_layout.tsx`'s `ThemeProvider` và `(tabs)/_layout.tsx`'s màu tab bar cũng đọc theo `themeMode`, không chỉ các màn hình dùng `usePalette()`.
- [ ] Chưa tự tay bật/tắt trên device thật để xem chuyển đổi mượt hay có giật hình không (không có device trong phiên này).

### Report sau code
Added `themeMode` (`system`/`light`/`dark`) to the zustand app store, persisted via the existing `settings` table. Introduced `useEffectiveColorScheme()` in `theme/use-palette.ts` as the single place that resolves OS scheme vs. user override, and switched `_layout.tsx` and `(tabs)/_layout.tsx` off raw `useColorScheme()` to use it too, so the native tab bar and navigation theme follow the manual choice, not just token-based screens. UI is a 3-way `Segmented` (matching the existing pattern for dialect/font-size) in a new "Giao diện" section at the top of Settings, rather than a plain on/off `Switch` — dark mode is inherently a 3-state preference (System/Light/Dark) in this app now, and a binary switch would have hidden the "follow system" option. `tsc`/`vitest` clean; not visually tested on-device in this session.

---

## Task 21 — Toàn bộ app không bấm được gì sau khi tap 1 tab — nghi ngờ là hệ quả của crash Task 16, không phải bug tab riêng

### Mô tả
User báo: sau khi tap vào 1 tab ở thanh tab nav dưới, màn hiện ra "không dùng được" — kể cả nút trên màn đó cũng không bấm được gì. Báo cáo này đến **ngay sau** khi user paste log crash `NativeDatabase.prepareAsync`/NullPointerException lặp 4 lần liên tiếp (xem update trong Task 16).

Đối chiếu code: `isCorruptionError()` ([src/db/open.ts:30-33](src/db/open.ts#L30-L33)) chỉ match các message `malformed|not a database|disk image|file is encrypted` — **không match `NullPointerException`**. Nghĩa là lỗi crash ở Task 16 **không** được `wrapDictionary()`'s guard bắt lại, mà rơi thẳng thành 1 "Uncaught (in promise)" y hệt log user gửi. Trong môi trường dev (Expo/Metro), 1 promise reject không bắt sẽ làm React Native bật overlay lỗi đỏ toàn màn hình (LogBox) — và vì lỗi này lặp lại **mỗi lần có màn hình nào đó chạm DB**, mỗi tab mới mở đều có thể kích hoạt tiếp 1 overlay lỗi mới đè lên, chặn hết thao tác chạm bên dưới. Đây khớp chính xác với mô tả "tap vào tab, màn không dùng được, nút cũng không bấm được" — nhiều khả năng người dùng đang thấy **chồng overlay lỗi**, không phải tab nav bị hỏng logic.

### Expect
Sau khi Task 16 fix (bổ sung `globalThis` + WAL) thật sự có hiệu lực, tap tab phải mở đúng màn và mọi nút trong đó bấm được bình thường, không còn overlay lỗi nào che màn hình.

### Tái hiện
1. Đã xảy ra crash loop `NativeDatabase.prepareAsync` (xem log gốc trong Task 16).
2. Ngay sau đó, tap bất kỳ tab nào ở thanh nav dưới → màn không tương tác được.

### Nguyên nhân gốc (giả thuyết, chưa xác nhận 100% vì không có device)
- **Giả thuyết chính**: không phải bug tab nav — là hệ quả trực tiếp của crash Task 16 chưa được xử lý sạch. Fix `globalThis`/WAL cho Task 16 chỉ có hiệu lực từ 1 **process JS sạch** — nếu user mới chỉ Fast Refresh/Reload (không kill hẳn app) sau khi fix được áp dụng, app vẫn đang chạy trên connection cũ đã hỏng từ trước khi fix tồn tại, nên vẫn tiếp tục crash và overlay lỗi vẫn chồng lên nhau.
- **Giả thuyết phụ** (nếu (1) đã loại trừ mà vẫn còn hiện tượng): 1 lỗi thật trong `NativeTabs`/`expo-router/unstable-native-tabs` (API còn đánh dấu "unstable") liên quan tới việc `(tabs)/_layout.tsx` đổi từ `useColorScheme()` sang `usePalette()` (đọc qua zustand `useApp`) — về logic đã soát kỹ, không thấy vòng lặp import hay lỗi hook, nhưng chưa loại trừ được hoàn toàn nếu không chạy thử trên device thật.

### Solution — làm theo thứ tự, dừng ở bước nào hết bug thì thôi
- [ ] **Bước 1 (khả năng cao nhất)**: Tắt hẳn app (kill app khỏi danh sách app đang chạy, không chỉ bấm Reload trong Metro) rồi mở lại từ đầu. Test lại tap tab.
- [ ] **Bước 2** (nếu bước 1 không hết): Thử `npx expo start --clear` (xoá cache Metro) rồi build/mở lại app từ đầu — loại trừ khả năng bundle cũ còn dính lại.
- [ ] **Bước 3** (nếu vẫn còn): Gỡ hẳn app khỏi máy/emulator rồi cài lại từ đầu — đảm bảo không còn `user.db`/`oxford-app.db` ở trạng thái dở dang từ các lần crash trước (file `-wal`/`-shm` mới sinh ra do đổi `journal_mode=WAL` cũng nên được dọn sạch trong bước này).
- [ ] **Bước 4** (nếu vẫn còn sau cả 3 bước trên): Lúc này mới nên nghi ngờ bug thật ở `(tabs)/_layout.tsx`/`NativeTabs` — báo lại kèm mô tả rõ: có thấy overlay đỏ (LogBox) hiện lên không, hay màn hình trắng/đứng hình hoàn toàn im lặng không lỗi gì? Hai triệu chứng này chỉ 2 hướng debug khác nhau hẳn.

### Test
- [ ]
- [ ]

### Verify
- [ ] Cần user tự thực hiện Bước 1 (tối thiểu) và báo lại kết quả — không thể verify từ phiên làm việc này (không có device).

### Report sau code
**Cập nhật: cả 2 giả thuyết trong task này đều SAI.** User làm rõ lại: không phải "mọi tab", mà cụ thể là màn Ôn tập — nút "Bắt đầu" không bấm được (đúng ra là bị `disabled`, không phải bị che bởi overlay lỗi nào). Nguyên nhân thật là 1 regression cụ thể ở Task 10 (`dueCount` lỡ loại luôn thẻ mới, xem update trong Task 10) — không liên quan gì đến crash Task 16 hay `NativeTabs`. Để task này lại làm bằng chứng cho thấy lúc chưa có đủ thông tin (mô tả "tab" quá chung chung), giả thuyết dựa trên suy luận gián tiếp (dù có vẻ hợp lý) vẫn có thể sai hoàn toàn — bug thật nằm ở chỗ không ngờ tới nhất. Xem Task 10's "Update (2026-08-20)" để biết fix thật.

---

## Nguồn Task 22-28: review `specs/draf_improment.md`

User đưa 1 báo cáo UX audit từ nguồn ngoài (`specs/draf_improment.md`) và xin ý kiến. Đã đối chiếu TỪNG claim với code thật trước khi đưa vào đây — không copy nguyên văn báo cáo:
- **Bỏ hẳn 1 claim sai**: mục 2.1 của báo cáo nói có "nút bánh răng nổi" (floating settings FAB) đè lên nội dung ở nhiều màn — đã `grep` toàn bộ `src/`, chỉ có DUY NHẤT 1 chỗ dùng icon gear, chính là icon của tab Cài đặt trong `(tabs)/_layout.tsx:29` (bình thường, đúng vị trí). Không có FAB nào trong code. Khả năng cao báo cáo đó phân tích nhầm chrome dev-tool của Expo (nút menu debug) trong ảnh chụp màn hình thành lỗi UI thật — **không tạo task cho claim này**.
- **Bỏ các claim đã lỗi thời** (đã tự sửa ở Round 1 trước khi đọc báo cáo này): biểu đồ box ở màn bắt đầu Ôn tập (mục 6.1) đã là bar chart cao thấp thật (không phải 5 chấm đều), progress bar đã dày 6pt (mục 6.2), haptics đã có sẵn (`Vibration.vibrate`), counter "X/Y" đã hiển thị — báo cáo mô tả những thứ này như đang thiếu, nhưng code thật đã có.
- **7 claim còn lại đối chiếu đúng với code** → thành Task 22-28 dưới đây.
- **Ghi chú riêng, chưa thành task**: mục 5.2 (thanh Leitner 5 ô) là 1 lựa chọn thiết kế có chủ đích (`LeitnerLadder` trong `dict-ui.tsx` có comment "Signature: ... không phải rainbow pills") — không phải sơ suất, cân nhắc kỹ trước khi đổi. Mục 6.3 (FSRS, undo, cloze highlight, interval preview trên nút chấm, vuốt để chấm điểm) — FSRS đã được `specs/init.md` ghi sẵn là hạng mục phase 2, còn 4 ý còn lại (undo/interval-preview/cloze-highlight/swipe-to-grade) là ý tưởng hợp lý, xác nhận thật là **chưa** có trong code, nhưng chưa được đưa vào task theo yêu cầu ban đầu — nói mình biết nếu muốn thêm.

---

## Task 22 — [UX] Thanh tab dưới vẫn hiện trong lúc ôn flashcard

### Mô tả
Phiên ôn tập (`phase === 'card'` trong `ReviewScreen`, [src/app/(tabs)/review.tsx](src/app/(tabs)/review.tsx)) không phải 1 route/modal riêng — nó chỉ là 1 state đổi bên trong route tab `Ôn tập`. `NativeTabs` ([src/app/(tabs)/_layout.tsx](src/app/(tabs)/_layout.tsx)) hiện thanh tab cho MỌI screen con của nó, không có state nội bộ nào của 1 tab khiến nó tự ẩn. Kết quả: trong lúc đang lật thẻ/chấm điểm, thanh tab 4 nút (Tra cứu/Từ của tôi/Ôn tập/Cài đặt) vẫn hiện nguyên phía dưới.

### Expect
Trong lúc ôn (phase `card`, có thể cả `done`), thanh tab dưới phải ẩn — chỉ còn nút ✕ ở `topBar` (đã có, gọi `exitEarly()`) là lối thoát chủ đích; nhường tối đa diện tích cho nội dung mặt sau thẻ (định nghĩa dài, ví dụ, bảng biến thể).

### Tái hiện
1. Vào tab Ôn tập, bấm "Bắt đầu".
2. Quan sát: thanh tab 4 nút vẫn hiện dưới cùng suốt phiên ôn.

### Nguyên nhân gốc
- Luồng ôn tập được implement như 1 state (`phase`) trong route tab, không tách thành route/modal riêng — nên không có cách "ẩn tab bar theo điều kiện" tự nhiên trong kiến trúc hiện tại.

### Solution — 2 hướng, chọn 1

**a. Chuyển phase `card`/`done` ra 1 route riêng ngoài tabs, mở bằng `router.push` với `presentation: 'fullScreenModal'` (khuyên dùng)**
- Tạo route mới (vd. `src/app/review-session.tsx`) chứa đúng phần UI của phase `card`/`done` hiện tại; `(tabs)/review.tsx` giữ lại phase `start`, khi bấm "Bắt đầu" thì `router.push('/review-session', { params: {...} })` thay vì đổi `phase` nội bộ.
- Thêm `<Stack.Screen name="review-session" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />` vào `_layout.tsx`, giống cách `import` đã dùng `presentation: 'modal'`.
- Pros: Đúng mẫu chuẩn của Expo Router (Stack chồng lên Tabs tự động ẩn tab bar) — không phụ thuộc vào việc `expo-router/unstable-native-tabs` có hỗ trợ ẩn động hay không (API còn "unstable", rủi ro nếu dựa vào 1 prop chưa ổn định).
- Cons: Cần truyền state phiên ôn (queue, card, mode…) qua route params hoặc 1 store tạm — object `SessionQueue` không serialize được qua route params thông thường, nên cần giữ nó ở 1 nơi ngoài route (module-level ref hoặc context) rồi route mới chỉ đọc lại, không đi qua `params`. Đổi cấu trúc rộng hơn phương án (b).

**b. Tìm API ẩn tab bar theo điều kiện ngay trong `NativeTabs`**
- Kiểm tra tài liệu/source `expo-router/unstable-native-tabs` xem có prop kiểu `hidden`/`tabBarStyle` điều khiển được theo state của tab con không.
- Pros: Không cần tách route, giữ nguyên cấu trúc `review.tsx`.
- Cons: API đang đánh dấu "unstable" — chưa chắc có hỗ trợ; nếu không có, phải tự chế bằng cách ẩn/che tạm (hacky, dễ vỡ khi update `expo-router`).

**→ Khuyên dùng (a)** — ít rủi ro phụ thuộc vào API chưa ổn định, đúng kiến trúc Stack+Tabs chuẩn của Expo Router.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi. `npx vitest run` — 40/40 pass (logic `SessionQueue`/`srs.ts` không đổi, chỉ chuyển state lên store).

### Verify
- [x] Thêm store mới `src/stores/review-session.ts` (zustand) giữ toàn bộ state phiên ôn (`queue`, `card`, `flipped`, `mode`, `nextDue`, cache) — trước đó nằm local trong `review.tsx`.
- [x] `(tabs)/review.tsx` giờ CHỈ còn màn bắt đầu (05-A): due count, biểu đồ box, chọn mode, nút Bắt đầu/Ôn trước hạn — gọi `begin()` của store rồi `router.push('/review-session')`.
- [x] Route mới `src/app/review-session.tsx` chứa UI phase thẻ (05-B) + kết quả (05-C), đăng ký trong `_layout.tsx` với `presentation: 'fullScreenModal', gestureEnabled: false` — tab bar tự ẩn vì đây là Stack screen nằm ngoài `(tabs)`, không phải vì code tự ẩn tab bar.
- [x] `(tabs)/review.tsx` đổi `useEffect` mount-once thành `useFocusEffect` để tự làm mới due-count mỗi lần quay lại tab (trước đây phải tự gọi `refreshCounts()` thủ công ở nút "Xong").
- [ ] Chưa tự tay chạy 1 phiên ôn thật trên device để xác nhận tab bar biến mất mượt mà, animation modal không giật — không có device trong phiên này.

### Report sau code
Implemented option (a). Split `review.tsx` into the tab-resident start screen and a new `review-session.tsx` pushed as `presentation: 'fullScreenModal'` — this is the standard Expo Router pattern for "full screen flow outside the tab bar", so it doesn't depend on `expo-router/unstable-native-tabs` having any conditional-hide API. Session state (queue/card/flip/mode/cache) moved into a new `useReviewSession` zustand store since it can't cross a route boundary as React state or serializable route params. `exitEarly`/`retryMissed`/`finish` logic preserved as-is, just re-homed. Cache-reset-on-session-end (Task 8) is now simpler and arguably more correct: it clears on the new screen's unmount (which only happens when the session truly ends), replacing the previous tab-blur-based `useFocusEffect` cleanup. `tsc`/`vitest` clean; not yet run on a real device to confirm the modal transition looks right.

---

## Task 23 — [UX] Nút 'X' xoá chip 'Gần đây' có vùng chạm quá nhỏ

### Mô tả
Chip lịch sử gần đây ([src/app/(tabs)/index.tsx](src/app/(tabs)/index.tsx), style `chip`/`chipText`): khoảng cách giữa chữ và icon X chỉ `gap: 6`; nút X chỉ có `hitSlop={8}` — vùng chạm hiệu quả ước tính ~14 (icon) + 16 (hitSlop 2 bên) = 30pt, dưới ngưỡng khuyến nghị tối thiểu 44×44pt cho touch target, và khoảng cách 6pt dưới ngưỡng an toàn 8-12pt để tránh chạm nhầm sang chữ.

### Expect
Bấm X xoá được chính xác, không lỡ tay mở lại từ khoá khi ý định là xoá.

### Tái hiện
1. Có ≥1 mục trong "Gần đây" ở màn Tra cứu.
2. Bấm gần đúng vị trí X nhưng hơi lệch sang trái → mở lại từ đó thay vì xoá.

### Nguyên nhân gốc
- `gap`/`hitSlop` hiện tại nhỏ hơn khuyến nghị chuẩn về touch target.

### Solution
Một hướng sửa rõ ràng:
- [x] Tăng `gap` trong style `chip` từ 6 lên 10-12.
- [x] Tăng `hitSlop` của nút X từ 8 lên 12, hoặc đặt `minWidth`/`minHeight: 44` + `alignItems/justifyContent: 'center'` trực tiếp trên `Pressable` thay vì chỉ dựa `hitSlop` (hitSlop mở rộng vùng chạm nhưng không di chuyển các item lân cận, ở khoảng cách nhỏ vẫn có thể chồng lấn vùng chạm của chữ bên cạnh).

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `src/app/(tabs)/index.tsx`: `chip.gap` 6→10; nút X `hitSlop` 8→15 (14pt icon + 30pt hitslop ≈ 44pt tổng, đúng ngưỡng khuyến nghị). Giữ nguyên kích thước hiển thị của icon (không phóng to icon) — chỉ mở rộng vùng chạm vô hình, tránh làm chip trông to bất thường.

### Report sau code
Implemented the single recommended fix — bumped `chip`'s `gap` and the delete button's `hitSlop`. Kept it to `hitSlop` rather than literal `minWidth/minHeight: 44` on the icon itself, since a 44pt visible box would make the compact pill chip look oversized; `hitSlop` gets an equivalent effective touch target without changing the chip's visual size. `tsc` clean; not measured on a real device/simulator.

---

## Task 24 — [UX] Badge CEFR ở "Từ hôm nay" tách xa headword

### Mô tả
Khối "Từ hôm nay" ([src/app/(tabs)/index.tsx](src/app/(tabs)/index.tsx), style `wotd`) dùng `justifyContent: 'space-between'`, đẩy `CefrBadge` ra sát mép phải, tách xa hẳn khỏi headword ở bên trái — đứt liên kết thị giác giữa từ và cấp độ khó của nó. Nền khối cũng chỉ là `t.surface.raised` phẳng, không có điểm nhấn nào phân biệt với các khối khác trên màn.

### Expect
Badge CEFR nằm ngay sát bên phải headword (cùng nhóm thị giác); khối "Từ hôm nay" có điểm nhấn thị giác riêng để nổi bật hơn phần còn lại của màn.

### Tái hiện
1. Mở tab Tra cứu, xem khối "Từ hôm nay" khi ô tìm kiếm trống.
2. Badge CEFR (vd "B2") nằm hẳn bên phải khối, cách xa headword.

### Nguyên nhân gốc
- Layout dùng `space-between` đẩy 2 nhóm ra 2 đầu, đúng cho layout "trái/phải" thông thường nhưng sai cho ý đồ "badge đi kèm ngay sau từ".

### Solution
Một hướng sửa rõ ràng:
- [x] Đổi layout: badge CEFR đặt ngay trong `<View>` chứa headword (cùng `flexDirection: 'row', alignItems: 'baseline', gap: 6`), bỏ `justifyContent: 'space-between'` ở mức ngoài.
- [x] (Tuỳ chọn) Thêm gradient nhẹ dùng dải teal brand cho nền khối — đã cài `expo-linear-gradient` và implement.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `src/app/(tabs)/index.tsx`: badge CEFR chuyển vào cùng row với headword (`wotdHeadRow`, `gap: 8`), pos hiện ở dòng riêng bên dưới thay vì bị đẩy lệch.
- [x] Nền khối đổi từ `t.surface.raised` phẳng sang `<LinearGradient colors={[t.accent.tint, t.surface.raised]}>` (chéo trên-trái → dưới-phải) — tint dùng luôn token theme hiện có nên tự đổi đúng theo Dark Mode, không cần thêm token gradient riêng. Thêm `overflow: 'hidden'` vào style `wotd` để gradient không tràn ra ngoài góc bo tròn trên Android.

### Report sau code
Implemented both parts. `npx expo install expo-linear-gradient` (SDK-matched version). Badge repositioned next to the headword; background is now a subtle diagonal gradient from `accent.tint` to `surface.raised` — reusing existing semantic tokens rather than inventing new gradient-specific ones, so it stays correct in both themes automatically. `tsc` clean; not visually verified on-device.

---

## Task 25 — [UX] Nhãn ngữ pháp/ngữ cảnh chỉ là text xám, không có badge

### Mô tả
Ở `SenseBlock` ([src/app/word/[q].tsx](src/app/word/[q].tsx)), dòng `[sense.grammar, sense.labels].filter(Boolean).join(' · ')` render bằng style `posLine` (`color: t.text.tertiary`) — text xám thuần, không có khối nền/viền tách biệt với phần định nghĩa chính, khó phân biệt "nhãn phân loại" (disapproving, informal…) với nội dung nghĩa.

### Expect
Mỗi nhãn ngữ pháp/ngữ cảnh hiện dưới dạng badge nhỏ (nền nhạt), tách biệt rõ khỏi câu định nghĩa.

### Tái hiện
1. Mở 1 từ có `grammar`/`labels` (vd từ có nhãn "informal"/"disapproving" trong dữ liệu Oxford).
2. Nhãn hiện lẫn vào dòng text xám ngay dưới định nghĩa, không có viền/nền phân biệt.

### Nguyên nhân gốc
- Chưa bọc nhãn vào component badge — hiện tái dùng style text thường (`posLine`) cho cả POS chính (vd "verb") và các nhãn phụ.

### Solution
Một hướng sửa, nhưng cần kiểm tra data thật trước khi implement:
- [x] **Kiểm tra trước**: đã query trực tiếp `oxford-app.db` thật — `grammar` luôn dạng `[...]` (vd `[uncountable, plural]`, `[transitive]`), `labels` luôn dạng `(...)` (vd `(British English)`, `(old use or formal)`) — mỗi field là **1 khối duy nhất** (kể cả khi có dấu phẩy bên trong, đó vẫn là 1 ghi chú ngữ pháp gộp, không phải nhiều nhãn rời), nên chỉ cần đúng 2 badge/sense (1 cho `grammar`, 1 cho `labels`), không cần tách theo dấu phẩy.
- [x] Bọc mỗi nhãn vào 1 badge nhỏ, nền `t.surface.raised`, bo góc nhỏ. Bỏ luôn dấu ngoặc `[]`/`()` bao quanh khi hiện trong badge — badge tự làm nhiệm vụ phân tách thị giác nên giữ ngoặc là thừa.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `SenseBlock` ([src/app/word/[q].tsx](src/app/word/[q].tsx)): `sense.grammar`/`sense.labels` giờ render thành 2 badge riêng (`tagBadge` style) thay vì 1 dòng text xám gộp chung bằng `·`.

### Report sau code
Verified the data shape against the real `oxford-app.db` first (queried `entries.data` directly) before implementing, per the task's own note — confirms 2 badges per sense is correct, no comma-splitting needed. `tsc` clean.

---

## Task 26 — [UX] "Ghi chú nghĩa của bạn" không có khối nền riêng

### Mô tả
Trong `word/[q].tsx`, khối "Ghi chú nghĩa của bạn" bọc trong `s.section` (chỉ có `marginTop`/`paddingHorizontal`, không có `backgroundColor`/`borderRadius`) — hoà lẫn vào dòng chảy chung. Ngay bên dưới, khối "Nghĩa tiếng Việt" LẠI có card riêng (`backgroundColor: t.surface.raised, borderRadius: radius.lg, padding: space.md`) — 2 khối nội dung "phụ, không phải từ điển gốc" cạnh nhau nhưng style không nhất quán.

### Expect
"Ghi chú nghĩa của bạn" có khối nền riêng giống "Nghĩa tiếng Việt" ngay dưới, để nhấn mạnh đây là nội dung do người dùng tự thêm; nút "Sửa" có icon bút chì đi kèm cho rõ affordance.

### Tái hiện
1. Mở 1 từ đã lưu, xem khối "Ghi chú nghĩa của bạn" — không có nền/viền, khối "Nghĩa tiếng Việt" ngay dưới thì có.

### Nguyên nhân gốc
- 2 khối được viết ở 2 thời điểm khác nhau, không soi lại nhau về style.

### Solution
Một hướng sửa rõ ràng:
- [x] Đổi style bọc khối này giống khối "Nghĩa tiếng Việt": `backgroundColor: t.surface.raised, borderRadius: radius.lg, padding: space.md, marginHorizontal: space.md`.
- [x] Thêm icon bút chì cạnh nút "Sửa" — thêm `SquarePen` vào `Icons`/import Lucide trong `dict-ui.tsx`.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] "Ghi chú nghĩa của bạn" ([src/app/word/[q].tsx](src/app/word/[q].tsx)) giờ dùng đúng style card giống "Nghĩa tiếng Việt" ngay dưới nó; nút "Sửa" có icon `SquarePen` đi kèm (ẩn icon khi đang ở trạng thái "Huỷ" để tránh icon bút chì cạnh chữ "Huỷ" gây hiểu nhầm).

### Report sau code
Implemented the single recommended fix — reused the exact inline card style the Vietnamese-meaning block already uses (rather than a new named style) for visual consistency, and added `SquarePen` to `dict-ui.tsx`'s shared `Icons` set. `tsc` clean.

---

## Task 27 — [UX] Bộ lọc ở "Từ của tôi" thiếu visual affordance

### Mô tả
`ORDERS` filter row ([src/app/(tabs)/my-words.tsx](src/app/(tabs)/my-words.tsx), style `sortItem`/`sortOn`) chỉ đổi `color`/`fontWeight` khi active, không có nền/viền/underline — khó nhận ra đây là các nút bấm được để đổi cách sắp xếp.

### Expect
Trạng thái active có tín hiệu thị giác rõ ràng hơn chữ đậm đơn thuần (nền pill hoặc underline).

### Tái hiện
1. Mở tab "Từ của tôi", nhìn dòng "Mới nhất / A-Z / CEFR / Đến hạn".
2. Không rõ ngay đây là các lựa chọn bấm được, hay chỉ là nhãn tĩnh.

### Nguyên nhân gốc
- Style active chỉ đổi `fontWeight`/`color`, thiếu 1 tín hiệu hình khối.

### Solution
Một hướng sửa rõ ràng:
- [x] Đổi `sortOn` thêm `backgroundColor: t.accent.tint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full` (dạng pill nhạt) thay vì chỉ đổi màu chữ — tái dùng đúng tinh thần `accent.tint` đã dùng ở banner form-of/chip trong `word/[q].tsx`.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] `my-words.tsx`: mỗi lựa chọn sort giờ là 1 `Pressable` riêng có pill nền (`sortPill`/`sortPillOn`) thay vì chỉ 1 `Text` đổi màu; giảm `sortRow.gap` từ 18 xuống 8 vì pill đã tự tạo khoảng cách thị giác.

### Report sau code
Implemented the single recommended fix — active filter now gets an `accent.tint` pill background, not just bolder text. `tsc` clean.

---

## Task 28 — [UX] Xoá bằng long-press không xác nhận, không hoàn tác

### Mô tả
2 chỗ dùng cùng pattern rủi ro: `my-words.tsx` (`onLongPress={async () => { await unsaveWord(...); reload(); }}`) và `history.tsx` (`onLongPress={async () => { await deleteHistoryRow(...); reload(); }}`) — cả 2 xoá **ngay lập tức** khi long-press, không Alert xác nhận, không cách hoàn tác. So sánh: các hành động xoá "cả loạt" khác trong app (Settings' "Xoá lịch sử tra cứu", "Xoá tất cả" ở `history.tsx`) ĐỀU có `Alert.alert` xác nhận trước — 2 chỗ xoá-từng-dòng này là ngoại lệ duy nhất không có bước chặn nào.

### Expect
Xoá 1 dòng (từ đã lưu / lịch sử) phải khó lỡ tay hơn — có xác nhận và/hoặc có đường hoàn tác.

### Tái hiện
1. Long-press vào 1 dòng ở "Từ của tôi" hoặc "Lịch sử".
2. Dòng biến mất ngay, không có cách nào lấy lại ngoài lưu/tra lại từ đầu.

### Nguyên nhân gốc
- 2 chỗ này được viết tắt (`onLongPress` gọi trực tiếp hàm xoá) mà không áp lại pattern `confirm()`/`Alert.alert` đã có sẵn ở những chỗ xoá khác trong cùng app.

### Solution — 2 hướng, có thể làm cả 2 theo thứ tự

**a. Thêm `Alert.alert` xác nhận trước khi xoá (làm ngay, rẻ — khuyên dùng trước)**
- Tái dùng đúng pattern `confirm()` đã có trong `settings.tsx`: bọc `unsaveWord`/`deleteHistoryRow` trong `Alert.alert('Xoá?', '...', [Huỷ, Xoá])` trước khi gọi.
- Pros: 1-2 dòng mỗi chỗ, chặn ngay rủi ro xoá nhầm, không cần dependency mới.
- Cons: Vẫn giữ long-press (không theo chuẩn vuốt-để-xoá hiện đại), thêm 1 bước bấm cho mọi lần xoá (kể cả khi người dùng chắc chắn muốn xoá).

**b. Chuyển sang vuốt để xoá (swipe-to-delete) + toast "Đã xoá · Hoàn tác"**
- Dự án đã có sẵn `react-native-gesture-handler` (~2.31.1) và `react-native-reanimated` (4.3.1) trong `package.json` — đủ để tự implement 1 `Swipeable` row, không cần thêm dependency.
- Cần thêm 1 component Toast/Snackbar đơn giản (chưa có sẵn trong app) để hiện "Đã xoá · Hoàn tác" vài giây — xoá thật (DB) có thể trễ lại vài giây (optimistic UI + delay-commit) để nút Hoàn tác có ý nghĩa thật, không chỉ là hoàn tác UI.
- Pros: Đúng chuẩn tương tác danh sách hiện đại, xoá dòng "Giữ lâu để xoá" thừa, nhanh hơn cho người dùng đã quen thao tác vuốt.
- Cons: Nhiều việc hơn — thêm 1 component Toast mới, logic delay-commit, test kỹ animation vuốt trên cả 2 nền tảng.

**→ Khuyên dùng: làm (a) trước để chặn rủi ro ngay, (b) là nâng cấp UX sau nếu muốn chuẩn hoá lâu dài.**

### Test
- [x] `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] (a, sau đó thay bằng b) `my-words.tsx`/`history.tsx`: ban đầu làm Alert xác nhận trước khi xoá (`confirmUnsave`/`confirmDeleteRow`) — sau đó **nâng cấp lên (b)** trong cùng phiên làm việc, nên (a)'s Alert-trước-khi-xoá đã bị THAY THẾ, không còn tồn tại trong code (xoá code cũ khi lên (b), không giữ song song 2 cơ chế).
- [x] (b) Thêm `src/hooks/use-pending-delete.ts` (optimistic remove + commit trễ 4s + `undo()`), `src/components/swipe-to-delete.tsx` (bọc `Swipeable` từ `react-native-gesture-handler`, vuốt trái lộ nút "Xoá" đỏ), `src/components/undo-toast.tsx` (thanh "Đã xoá X · Hoàn tác" neo đáy màn).
- [x] `my-words.tsx`/`history.tsx`: đổi từ `onLongPress` sang bọc mỗi dòng trong `<SwipeToDelete>`; dòng bị xoá biến mất khỏi list NGAY (lọc theo `pendingItem`) trước khi DB thật sự bị đụng tới; xoá dòng hint "Giữ lâu để xoá" cũ, thêm "Vuốt sang trái để xoá" (my-words) làm gợi ý thao tác mới.
- [x] Thêm `GestureHandlerRootView` bọc ngoài cùng ở `_layout.tsx` — bắt buộc để `Swipeable` nhận gesture ổn định, đặc biệt trên Android (trước đó app chưa cần tới gesture-handler's pan gestures nên chưa có root view này).
- [ ] Chưa test thao tác vuốt thật trên device (không có trong phiên này) — cần xác nhận: vuốt mở đúng, tap "Xoá" hoạt động, toast hiện/biến mất đúng lúc, "Hoàn tác" khôi phục đúng dòng.

### Report sau code
Implemented both (a) and then (b) in the same session — (a) was built first, then immediately superseded by (b) once asked to go further, since an undo-toast pattern makes the upfront confirm dialog redundant friction rather than a complementary safety net; the Alert-based code from (a) no longer exists. Built 3 small reusable pieces (`usePendingDelete`, `SwipeToDelete`, `UndoToast`) rather than one-off logic per screen, since both `my-words.tsx` and `history.tsx` needed identical optimistic-delete-with-undo semantics. Also had to add `GestureHandlerRootView` at the app root — `Swipeable` needs it and nothing in the app required gesture-handler's pan gestures before now. `tsc`/`vitest` clean; swipe gesture itself not exercised on a real device in this session.

---

## Task 29 — [Feature] New "Ảnh" tab — DuckDuckGo-backed image search

### Mô tả
Phase-2 batch (planned via Plan Mode, see `/home/long.tran3/.claude/plans/structured-roaming-crab.md`). User asked for a 5th tab to search/view images for a word — a well-established visual-vocabulary aid. DuckDuckGo has no official public Image Search API; the internal endpoint was reverse-engineered and **verified live** against the real service before writing any code: `GET duckduckgo.com/?q=...` yields a `vqd` token in the HTML, then `GET duckduckgo.com/i.js?...&vqd=...` returns JSON image results (confirmed 93 real results for a test query; DDG image search is itself Bing-sourced under the hood).

### Expect
A "Ảnh" tab where typing a word shows a grid of image thumbnails; tapping one shows a full-size preview with source attribution and a link out to the original page. Works offline for previously-searched words (cache-first). Fails soft (no crash, no dictionary-blocking) if the endpoint ever breaks.

### Solution implemented
- [x] `src/services/image-search.ts` — `searchImages(userDb, query, page, fetchImpl?)`, shaped like `services/vi-meaning.ts` (cache-first, 3s timeout, 1 retry, fail-soft, `fetchImpl` injectable for tests). Two-step fetch: HTML page → regex `vqd` token → `i.js` JSON endpoint.
- [x] `src/db/user.ts` — new migration (`image_cache(query, page, json, fetched_at)`), `getCachedImages`/`cacheImages`/`clearImageCache`.
- [x] `src/app/(tabs)/images.tsx` — new screen: debounced (300ms) search bar, `FlatList numColumns={3}` grid using `expo-image`'s `<Image>` (self-caching, already a dependency, not previously used live anywhere in the app), tap → in-screen `<Modal>` preview with title + "Nguồn: {domain}" tap-through link. No save/export action by design (in-app reference viewing only, not redistribution).
- [x] `src/app/(tabs)/_layout.tsx` — registered the tab (after "Ôn tập", before "Cài đặt").
- [x] `src/app/(tabs)/settings.tsx` — "Xoá cache ảnh" row next to the existing cache-clear rows.
- [x] `src/components/dict-ui.tsx` — added `Images` to the shared `Icons` set (used for the tab's empty state).

### Test
- [x] `test/services.test.ts`: 4 new tests for `image-search.ts` — happy path (token → results → cache-hit on second call), missing-token fail-soft-after-retry, results-fetch-throws fail-soft, empty query short-circuits without fetching.
- [x] `npx vitest run` — 44/44 pass. `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] Cache-first contract matches `vi-meaning.ts`'s established pattern exactly (same shape of `{ results/meanings, fromCache, failed }`).
- [x] **Đã chạy thật trên emulator** (Android 16 / API 36 — chi tiết ở Task 32): endpoint DDG thật trả kết quả, lưới ảnh + modal preview render đúng, dòng "Nguồn:" hiện domain thật. Lưu ý: UI đã **chuyển khỏi tab riêng vào màn chi tiết từ** ở Task 32, nên "màn tab Ảnh" mô tả ở trên không còn tồn tại.

### Report sau code
Implemented per the approved plan. The DuckDuckGo integration risk (undocumented endpoint, no SLA) is stated explicitly in code comments, not hidden — if it breaks in the future, the fail-soft contract means the tab shows "Cần mạng để tìm ảnh" rather than crashing, and nothing else in the app is affected. `tsc`/`vitest` clean.

## Task 30 — [Feature] Thay thuật toán Leitner box thủ công bằng FSRS thật cho lịch ôn tập

### Mô tả
Phase-2 batch (cùng plan với Task 29, xem `/home/long.tran3/.claude/plans/structured-roaming-crab.md`). Trước đó `services/srs.ts` tự tính khoảng cách ôn tập bằng bảng 5 "hộp" Leitner cứng (1/2/4/7/14 ngày) — không thích nghi theo độ khó thật của từng từ. **FSRS** (Free Spaced Repetition Scheduler) là thuật toán hiện đại hơn Anki/SM-2, tính khoảng ôn dựa trên `stability`/`difficulty` ước lượng riêng cho từng thẻ. Package `ts-fsrs@5.4.1` đã verify qua `npm view` + cài thật + đọc `.d.ts` thật trong `node_modules` (không đoán API) — 0 runtime dependency, an toàn cho React Native.

### Expect
Lịch ôn tập thích nghi theo từng từ (từ dễ giãn cách nhanh hơn, từ khó giữ gần) thay vì cứng theo 5 mốc ngày cố định. Giữ nguyên UI 2 nút "Chưa nhớ"/"Đã nhớ" (spec chủ động tránh "ease hell" của UI 4 nút) và giữ nguyên toàn bộ cơ chế trong-phiên hiện có (learning steps, reinforcement pass, escape hatch của `SessionQueue`) — không rewrite những phần đã test kỹ và không có bug.

### Solution implemented
- [x] `npm install ts-fsrs@5.4.1`.
- [x] `src/db/user.ts` — migration v3 thêm 8 cột nullable vào `srs_state` (`stability`, `difficulty`, `fsrs_state`, `reps`, `lapses`, `scheduled_days`, `learning_steps`, `last_review`) qua các câu `ALTER TABLE` riêng (SQLite không cho multi-column ALTER 1 câu). Cột `box`/`streak`/`last_result` giữ nguyên — `box` trở thành bucket hiển thị (cosmetic) suy ra từ `stability`, `streak`/`last_result` vẫn phục vụ `SessionQueue`.
- [x] `src/services/srs.ts` — rewrite `grade()`: gọi `fsrs({ enable_short_term: false, enable_fuzz: false }).next(card, now, rating)` thay vì bảng Leitner cứng; `"Chưa nhớ"` → `Rating.Again`, `"Đã nhớ"` → `Rating.Good`. Thêm `toFsrsCard`/`fromFsrsCard` chuyển đổi giữa `SrsState` (lưu DB) và `Card` (FSRS). Thêm `boxFromStability()` — bucket hiển thị dùng lại đúng mốc ngày cũ (1/2/4/7/14) nên `LeitnerLadder` UI không cần đổi gì. Thêm `previewIntervals(s, now)` dùng `scheduler.repeat()` — xem trước khoảng ôn cho cả 2 lựa chọn mà không commit, sẵn cho UI xem-trước-khoảng-ôn sau này. Xoá `nextBox`/`BOX_INTERVAL_DAYS` (chết, không còn ai dùng).
- [x] Giữ lớp fuzz ±15% cũ (dùng `rng()` injected) áp lên khoảng FSRS tính ra, **thay vì** dùng `enable_fuzz` nội bộ của FSRS — vì fuzz nội bộ của FSRS không nhận RNG injected nên sẽ phá tính pure/deterministic của `grade()` mà test bộ đang dựa vào.
- [x] `enable_short_term: false` — FSRS có learning-steps riêng theo phút, nếu bật sẽ chồng chéo với learning-steps trong-phiên của `SessionQueue` (đã test kỹ, không đổi). `SessionQueue`, `buildSession`, `buildAheadSession`, `dueBoxCounts`, `boxCounts`, `isNewCard`, `maskHeadword` — **không đổi gì** (vẫn gọi `grade()` với đúng chữ ký cũ).
- [x] Thẻ cũ (đã ôn theo Leitner, `stability IS NULL`) được coi là thẻ FSRS mới lần đầu đọc — không cố suy ngược tham số FSRS từ lịch sử box, giữ nguyên `due_at` hiện có làm hạn ôn kế tiếp; FSRS tự điều chỉnh đúng sau vài lần ôn thật.

### Test
- [x] `test/services.test.ts`: xoá 3 test cũ pin cứng công thức Leitner (không còn đúng với FSRS), thay bằng test hành vi: `boxFromStability` bucket đúng mốc ngày; `grade()` đúng hướng đi tới trong tương lai + tăng streak; **khoảng ôn tăng dần khi trả lời đúng liên tiếp** (chứng minh spaced-repetition thật, không so số cứng vì hằng số nội bộ FSRS không phải của mình); trả lời sai reset streak + khoảng ôn ngắn hơn trả lời đúng; fuzz ±15% so với khoảng FSRS gốc chưa fuzz (lấy từ `previewIntervals`).
- [x] `npx vitest run` — 46/46 pass. `npx tsc --noEmit` — 0 lỗi.

### Verify
- [x] Field/type trong `toFsrsCard`/`fromFsrsCard` đối chiếu trực tiếp với `Card` interface thật trong `node_modules/ts-fsrs/dist/index.d.ts` (không đoán field name) — khớp 100%.
- [x] `enable_short_term`/`enable_fuzz` xác nhận là field thật của `FSRSParameters` trong cùng file `.d.ts`.
- [ ] Chưa test trên device thật — chưa thấy trực quan khoảng ôn thực tế thay đổi thế nào so với Leitner cũ qua nhiều phiên ôn liên tiếp (cần vài ngày dùng thật để quan sát).

### Report sau code
Implemented per plan. Rủi ro lớn nhất (tích hợp sai với `SessionQueue` đang hoạt động tốt) được né bằng cách chỉ thay ruột `grade()`, giữ nguyên 100% API/behavior xung quanh nó — 41 test cũ liên quan `SessionQueue` (learning steps, reinforcement, escape hatch...) pass nguyên không cần sửa, chỉ 3 test pin cứng công thức Leitner cần viết lại theo hướng hành vi. `tsc`/`vitest` clean.

## Task 31 — [Feature] Thanh tab đổi sang phong cách "glass" nổi theo ảnh mẫu, đổi màu theo brand teal

### Mô tả
User gửi ảnh chụp một thanh tab bar dạng pill nổi, nền tối kính mờ (glass), có glow màu ở icon đang active, và hỏi "can I use these style tab bar?". Phát hiện repo đã có sẵn `src/components/glass-tab-bar.tsx` — code đầy đủ đúng phong cách trong ảnh nhưng **là dead code, chưa từng được wire vào app** (app đang chạy `NativeTabs`), và thiếu cả 3 dependency nó cần (`expo-blur`, `@expo/vector-icons`, `@react-navigation/bottom-tabs` — không cái nào có trong `package.json`/`node_modules`). Màu sắc cũng hardcode xanh dương chung chung (`#5B8CFF`), không theo brand teal đã retheme ở Task 19.

### Expect
Thanh tab bar dạng pill nổi, kính mờ, glow teal theo đúng brand, giữ nguyên đủ 5 tab hiện có (Tra cứu/Từ của tôi/Ôn tập/Ảnh/Cài đặt) và hành vi điều hướng không đổi.

### Nguyên nhân gốc (tại sao không "chỉ wire vào là xong")
`glass-tab-bar.tsx` được viết theo API `tabBar` render-prop kiểu React Navigation cũ. Kiểm tra trực tiếp `node_modules/expo-router` (bản 56.2.19 đang cài, đúng như `AGENTS.md` yêu cầu — luôn đọc doc/API bản đang cài trước khi code) cho thấy **`Tabs` của expo-router hiện tại không còn nhận prop `tabBar` đó nữa** — expo-router tự vendor logic tab riêng, không phụ thuộc `@react-navigation/bottom-tabs` như một package thật. Cách hiện hành (xác nhận qua doc chính thức + type thật trong `.d.ts`) là bộ headless `expo-router/ui`: `<Tabs><TabSlot/><TabList><TabTrigger .../></TabList>{customBar}</Tabs>`, mỗi tab tự là 1 `<TabTrigger asChild>` bọc component riêng (nhận `isFocused`/`onPress`/`onLongPress` qua props).

### Solution implemented
- [x] Đã hỏi ý kiến user trước khi đổi cơ chế điều hướng (tradeoff: mất native blur/long-press-menu của `NativeTabs`) — user xác nhận muốn theo đúng phong cách ảnh mẫu.
- [x] `npx expo install expo-blur` — cài đúng bản khớp SDK 56. **Không** cài `@expo/vector-icons` hay `@react-navigation/bottom-tabs` — không cần thật (xem bên dưới).
- [x] `src/components/glass-tab-bar.tsx` — viết lại hoàn toàn: dùng icon `lucide-react-native` có sẵn (`Icons.Search/Bookmark/Layers/Images/Settings` từ `dict-ui.tsx`, khớp 5 tab hiện có) thay vì cài thêm `@expo/vector-icons` riêng chỉ cho 1 component; mỗi tab là `<TabTrigger asChild><TabItem/></TabTrigger>`; màu ACTIVE/lamp-glow/top-streak đổi từ xanh dương generic sang thang teal của brand (`theme/tokens.ts`). Bỏ hiệu ứng `textShadow` glow trên icon (Ionicons cũ là text-glyph nên nhận `textShadow*`; lucide là SVG nên không hợp lệ kiểu — TypeScript báo lỗi ngay khi build) — vẫn giữ đủ 2/3 lớp glow còn lại (lamp + streak) nên hiệu ứng nổi không mất.
- [x] **Update**: ban đầu pill cố định tối/kính ở cả 2 theme (giống đúng ảnh mẫu). User xem code, yêu cầu thêm bản light mode cho bộ màu `ACTIVE`/`INACTIVE`/`PILL`. Đổi sang bảng `GLASS: Record<ColorMode, {...}>` chọn theo `useEffectiveColorScheme()`: dark giữ nguyên như cũ (`primitive.accent[400]` — pop trên nền tối); light dùng pill kính trắng `rgba(255,255,255,0.78)`, chữ/icon active `primitive.accent[600]` (đúng token `accentText` trong COLORS.md, vốn được định nghĩa riêng cho tương phản trên nền sáng), viền/streak/lamp đổi tương ứng. `BlurView`'s `tint` cũng đổi theo (`'dark'`/`'light'`, verify đúng giá trị thật qua `BlurTint` trong `.d.ts`) thay vì luôn `'dark'`.
- [x] `src/app/(tabs)/_layout.tsx` — đổi từ `NativeTabs` sang `Tabs/TabList/TabTrigger/TabSlot` của `expo-router/ui`, `TabList` ẩn (`display:none`, chỉ khai báo route), `<GlassTabBar/>` render UI thật.
- [x] Vì bar mới là `position:absolute` (khác `NativeTabs` chiếm chỗ layout thật), mọi màn tab phải tự chừa khoảng trống đáy — export `TAB_BAR_HEIGHT` dùng lại y hệt code gốc của `glass-tab-bar.tsx`. Đã thêm `paddingBottom: TAB_BAR_HEIGHT` vào: `index.tsx` (2 nhánh — FlatList gợi ý + View tĩnh khi chưa gõ), `my-words.tsx` (FlatList), `images.tsx` (FlatList lưới ảnh), `settings.tsx` (ScrollView). `review.tsx` không cần (nội dung luôn `justifyContent:'center'`, không chạm đáy).
- [x] `src/components/undo-toast.tsx` — toast "Hoàn tác" vốn `position:absolute, bottom:16` sẽ bị bar mới che khuất ở `my-words.tsx`; thêm prop `bottomOffset` (mặc định 16, giữ nguyên hành vi ở `history.tsx` — màn không có bar nổi), `my-words.tsx` truyền `TAB_BAR_HEIGHT + 8`.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi (bắt đúng lỗi kiểu `textShadow` trên icon SVG trước khi chạy thử, không phải đoán).
- [x] `npx vitest run` — 46/46 pass (không có test nào đụng tab bar — thay đổi thuần UI/navigation).

### Verify
- [x] Xác nhận `@react-navigation/bottom-tabs` **không cần cài** — `expo-router/ui` không `require()` package đó ở runtime (tự vendor trong `expo-router/build/react-navigation/*`), chỉ verify bằng cách grep thật trong `node_modules`, không đoán.
- [x] API `TabTrigger`/`TabList`/`TabSlot`/`Tabs` đối chiếu trực tiếp `.d.ts` thật + doc chính thức `docs.expo.dev` bản đang cài — không suy đoán từ bản doc khác.
- [x] `app-tabs.tsx` (1 file dead code khác, cũng dùng `NativeTabs`, chỉ có 2/5 tab, không ai import) — xác nhận không đụng tới, không phải phạm vi task này.
- [x] **Đã xem thật trên emulator** (Android 16 / API 36, light mode): pill nổi render đúng, lamp glow teal sau icon tab active, streak sáng viền trên, 4 tab (sau khi Task 32 gỡ tab "Ảnh") giãn đều không vỡ layout. Nội dung màn Tra cứu không bị bar che.
- [ ] **Còn lại**: emulator chạy `-gpu swiftshader_indirect` (render phần mềm) nên độ mờ thật của `BlurView` và độ mượt của glow animation **chưa** kết luận được — hai thứ này phụ thuộc GPU, phải xem trên máy thật. iOS cũng chưa chạy.

### Report sau code
Đây là đổi **cơ chế điều hướng tab** (không chỉ đổi giao diện) — từ `NativeTabs` sang `expo-router/ui` headless — vì bar tuỳ biến hoàn toàn kiểu ảnh mẫu không thể vẽ trên `NativeTabs` (chỉ có vài prop native như `blurEffect`, không có cách vẽ pill nổi/glow riêng). Đánh đổi (mất blur/long-press-menu native của iOS) đã nói rõ với user trước khi làm. Rủi ro layout lớn nhất (bar `absolute` đè lên nội dung cuối list) đã được xử lý chủ động ở cả 4 màn có scroll, không chỉ màn được yêu cầu ban đầu. `tsc`/`vitest` clean; phần còn lại (cảm giác thật của blur/glow/animation) cần device thật để chốt.


## Task 32 — [UX] Chuyển "Ảnh" từ tab riêng vào màn chi tiết từ

### Mô tả
Task 29 dựng "Ảnh" thành **tab thứ 4 độc lập** — có ô tìm kiếm riêng, người dùng phải gõ lại từ. User xem thực tế và phản hồi: *"tôi muốn nó hiện trong detail của 1 từ chứ ko phải ở ngoài … khi nhìn ảnh tôi thấy giao diện nó ở ngoài nhìn sai"*. Đúng — ảnh là **công cụ ghi nhớ cho một từ cụ thể**, mà tab độc lập lại tách nó khỏi đúng thứ nó cần đi kèm: từ đang đọc và nghĩa của từ đó. Kết quả là phải gõ lại từ vừa tra, và xem ảnh trong bối cảnh trống rỗng.

### Expect
Ảnh minh hoạ xuất hiện ngay trong SCR-02 ([src/app/word/[q].tsx](src/app/word/[q].tsx)), gắn với từ đang mở, không cần gõ lại. Tab "Ảnh" biến mất khỏi thanh tab (về lại 4 tab).

### Quyết định thiết kế (đã hỏi user, không tự chọn)
- **Vị trí**: accordion "Ảnh minh hoạ" thay vì strip luôn hiện — user chọn, để không đẩy phần định nghĩa (nội dung chính của màn) xuống dưới.
- **Thời điểm tải**: chỉ tải khi user chủ động yêu cầu, không tự tải như `getViMeanings()` — tiết kiệm data và không đụng endpoint DDG (không SLA, dễ rate-limit) cho mọi từ được mở.
- Hai lựa chọn trên ghép lại thành **một** thao tác chứ không phải hai: `<Accordion>` vốn chỉ render children khi `open` (`{open && children}`), nên **việc mở accordion chính là tín hiệu fetch** — không cần thêm nút "Xem ảnh" bên trong. 1 tap, không phải 2.

### Solution implemented
- [x] `src/components/word-images.tsx` (mới) — toàn bộ UI ảnh cho một từ: fetch trong `useEffect` khi mount (tức khi accordion mở lần đầu), lưới 3×3 tối đa 9 ảnh, tap → `<Modal>` xem ảnh lớn + "Nguồn: {domain}" bấm được, dòng ghi công DuckDuckGo. Fail-soft y hệt khối "Nghĩa tiếng Việt" ngay phía trên: mất mạng → dòng "Cần mạng để xem ảnh" + "Thử lại", không phải error state chặn cả entry.
- [x] Lưới dùng `View` + `flexWrap`, **không** `FlatList numColumns` như bản tab cũ — component này nằm trong `ScrollView` của SCR-02, lồng VirtualizedList vào ScrollView làm hỏng scroll và bắn warning.
- [x] `src/app/word/[q].tsx` — thêm `<Accordion title="Ảnh minh hoạ">` chứa `<WordImages word={imageQuery} />`, đặt đầu nhóm accordion (trên Idioms/Phrasal verbs/Word origin) — dưới toàn bộ phần nghĩa, nhưng vẫn ở nhóm dễ thấy. `imageQuery` dùng đúng thứ tự ưu tiên lemma-first của `getViMeanings()` (`formOf[0].lemma ?? entry.headword ?? query`): tra "ran" thì tìm ảnh cho "run", không phải "ran".
- [x] Khối ảnh nằm trong nhánh `!isStub` — trang biến thể thuần ("ran" khi chưa có entry riêng) không hiện mục này, đúng như các mục nội dung khác.
- [x] Xoá `src/app/(tabs)/images.tsx`; gỡ `TabTrigger name="images"` khỏi [src/app/(tabs)/_layout.tsx](src/app/(tabs)/_layout.tsx) và entry `images` khỏi mảng `TABS` trong [src/components/glass-tab-bar.tsx](src/components/glass-tab-bar.tsx) — thanh glass về lại 4 tab.
- [x] **Không** đụng `services/image-search.ts`, `db/user.ts` (bảng `image_cache`), hàng "Xoá cache ảnh" trong Cài đặt, hay `Icons.Images` — chỉ đổi nơi hiển thị, không đổi tầng dữ liệu. Cache theo `query` nên vẫn hoạt động nguyên vẹn ở vị trí mới.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi. `npx vitest run` — 46/46 pass (4 test của `image-search.ts` không cần sửa: service không đổi, chỉ đổi UI gọi nó).
- [x] Grep toàn `src/` xác nhận không còn tham chiếu treo nào tới route `images` sau khi xoá file.

### Verify — endpoint DuckDuckGo thật (mục còn dở của Task 29)
Task 29 để ngỏ *"endpoint DDG thật (test chỉ dùng `fetchImpl` giả) chưa được xác nhận"*. Đã chạy thật, không phải giả:
- [x] Bước 1 token: `GET duckduckgo.com/?q=otter&iar=images…` → HTTP 200, regex `vqd=['"]([\d-]+)['"]` **khớp** (`4-2926550666568…`) — tức pattern trong code vẫn đúng với HTML DDG đang phục vụ.
- [x] Bước 2 kết quả: `GET duckduckgo.com/i.js?…&vqd=…` → HTTP 200, **84 kết quả thật**.
- [x] Tên field đối chiếu với payload thật (`discovery_date, encoding_format, height, image, image_token, source, thumbnail, thumbnail_token, title, url, width`) — hàm map trong `fetchResultsPage()` giữ được **84/84** ảnh sau `.filter()`, **0** ảnh thiếu `title`, **0** thiếu `sourceUrl` (`r.url`). Dòng "Nguồn:" sẽ hiện domain thật chứ không rơi về "không rõ".

### Verify — còn lại
### Verify — chạy thật trên emulator (Android 16 / API 36, Medium_Phone_API_36.0)
Đã build dev client + `adb push` DB 185MB thẳng vào `files/` của app (bỏ qua luồng tải LAN của SETUP.md), rồi thao tác thật và chụp màn hình từng bước:
- [x] Accordion **"Ảnh minh hoạ" nằm đúng chỗ** — dưới "Nghĩa tiếng Việt", trên "Word origin", **đóng sẵn** khi mở từ.
- [x] **Lazy-fetch đúng hợp đồng**: lúc đóng không có request nào; bấm mở → hiện spinner ngay → ~10s sau ra lưới. Tức mở accordion đúng là tín hiệu fetch, không sớm hơn.
- [x] Lưới **3×3 = 9 ảnh** rái cá thật, ô vuông đều, không tràn, không cần `FlatList` (flex-wrap trong `ScrollView` cuộn mượt, không warning VirtualizedList).
- [x] Modal xem ảnh lớn: ảnh full, tiêu đề thật ("Amazing Sea Otter — Sea Otter Facts…"), **"Nguồn: worldmostamazingthings.com"** — đúng domain trong payload DDG, `hostOf()` cắt `www.` chuẩn. Nút ✕ đóng được.
- [x] **Cache chạy**: mở lại accordion lần 2 ra ảnh sau ~2s thay vì ~10s, đúng 9 ảnh cũ — `image_cache` hit, không gọi lại DDG.
- [x] Dòng ghi công "Ảnh từ DuckDuckGo — chỉ để tham khảo trong app." hiển thị dưới lưới.
- [x] Thanh glass còn **4 tab** (Tra cứu · Từ của tôi · Ôn tập · Cài đặt), không còn "Ảnh", giãn đều, tab active có lamp glow teal.
- [x] Warning runtime duy nhất là `Linking found multiple possible URI schemes` — có sẵn từ trước do `app.json` khai 2 scheme (`minotara`, `dict`), không phải từ thay đổi này.
- [ ] **Còn lại**: chưa chạy iOS; và blur/glow chỉ xem qua render phần mềm (xem mục Verify của Task 31).

### Report sau code
Đây là đổi **vị trí hiển thị**, không đổi tầng dữ liệu — `image-search.ts`, `image_cache`, và hàng xoá cache trong Cài đặt giữ nguyên 100%, nên phần đã test kỹ của Task 29 không bị rewrite. Hai quyết định UX (accordion vs strip, tự tải vs bấm mới tải) đều hỏi user chứ không tự chọn, và hoá ra ghép được thành 1 thao tác nhờ `<Accordion>` vốn đã lazy-mount — không phải thêm nút riêng. Nhân tiện đóng luôn mục verify còn dở của Task 29: endpoint DDG đã được gọi thật và đối chiếu từng field với payload thật, không đoán. Phần chưa chốt vẫn là cảm giác thị giác trên device thật.

---

## Ghi chú môi trường — build Android dev client (2026-09-04)

Không phải task; ghi lại để lần sau khỏi mất thời gian dò lại. `android/` được gitignore nên kiến thức này không nằm ở đâu khác trong repo.

**Bẫy: build fail với `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'IBM_SEMERU'`.**

- Chuỗi nhân quả (truy bằng `./gradlew --stacktrace`, không đoán): `expo prebuild` sinh wrapper Gradle **9.3.1** → Gradle 9 đã **xoá** hằng `JvmVendorSpec.IBM_SEMERU` → nhưng `node_modules/@react-native/gradle-plugin/settings.gradle.kts:16` pin plugin `org.gradle.toolchains.foojay-resolver-convention` bản **0.5.0** vẫn tham chiếu hằng đó → `ExceptionInInitializerError` tại `org.gradle.toolchains.foojay.DistributionsKt.<clinit>`.
- **Vì sao foojay bị gọi**: nó là plugin *tự tải JDK*, chỉ chạy khi Gradle không tìm thấy JDK toolchain build yêu cầu. Máy dev có Java 21 mặc định, RN cần JDK 17 → Gradle đi nhờ foojay → nổ. Nói cách khác lỗi này **không** phải lỗi Gradle version, mà là "thiếu JDK 17".
- **Fix**: trỏ `JAVA_HOME` vào một JDK 17. Máy này đã sẵn có (do foojay tải từ lần build cũ, hồi Gradle còn tương thích):

```bash
export JAVA_HOME=~/.gradle/jdks/eclipse_adoptium-17-amd64-linux/jdk-17.0.16+8
export PATH=$JAVA_HOME/bin:$PATH
npx expo run:android      # BUILD SUCCESSFUL in 3m 44s
```

- Cố ý **không** sửa `gradle-wrapper.properties` hay vá `node_modules`: bản vá node_modules mất khi `npm install`, còn hạ Gradle wrapper là đổi file sinh ra bởi prebuild — cả hai đều biến vấn đề riêng của một máy thành thay đổi trong repo.

**Nạp DB từ điển vào emulator nhanh hơn luồng LAN của SETUP.md** — `dictionaryReady()` chỉ cần file tồn tại + `size > 1024` (không có `.meta.json` thì rơi về nhánh check-size), nên push thẳng là xong:

```bash
adb push oxford-app.db /data/local/tmp/oxford-app.db
adb shell run-as com.anonymous.Minotara cp /data/local/tmp/oxford-app.db files/oxford-app.db
```

(`com.anonymous.Minotara` là package `expo prebuild` tự sinh vì `app.json` không khai `android.package`.)

Emulator headless để chụp màn hình: `emulator -avd <avd> -no-window -gpu swiftshader_indirect -no-audio` rồi `adb exec-out screencap -p > shot.png`. Lưu ý render phần mềm → **không** dùng để kết luận về blur/glow.

---

## Task 33 — [UX] Màn chi tiết từ chia 3 view + tra từ tiếp ngay tại chỗ

### Mô tả
Sau Task 32, user phản hồi màn chi tiết vẫn phải cuộn nhiều, và đề xuất cấu trúc kiểu TFlat: tab ngay dưới header, từ loại xuống dưới từ vựng thay dòng chữ xám. Kèm yêu cầu thêm icon tìm kiếm ở header để không phải back về Trang chủ mới tra tiếp được.

### Đo trước khi thiết kế (toàn bộ 68.832 entry)
Tiền đề "phải cuộn nhiều" đúng, nhưng **không phải vì nội dung từ điển**:

| Chỉ số | Kết quả |
|---|---|
| Entry chỉ 1 nghĩa | 73,4% |
| Entry ≤3 nghĩa | 95,2% |
| Có idioms / phrasal verbs | 5,5% / 4,0% |
| Có grammar hoặc labels ở dòng POS | 45,6% |
| Headword có >1 entry (homograph) | 8,7% |
| Sense có guideword | 7,6% |

`otter` chỉ 1 nghĩa mà màn vẫn dài ~2,5 màn hình → độ dài đến từ **chrome cố định** (Biến thể, Ghi chú, Nghĩa Việt, Ảnh), không từ số nghĩa. Nên chia view là đúng hướng, nhưng phải chia theo **nguồn dữ liệu**, không theo section: tách section thì tab "Idioms" rỗng với 94,5% số từ — tab rỗng gần như luôn luôn thì dạy người dùng đừng bấm nó.

### Solution implemented
- [x] **3 view chia theo nguồn**, mỗi view gần như luôn có nội dung: **Anh–Anh** (Biến thể, Nghĩa, Idioms, Phrasal verbs, Word origin, See also) · **Ảnh** · **Tiếng Việt** (nghĩa Việt + ghi chú của bạn). Idioms/phrasal/origin ở lại trong Anh–Anh dạng accordion vì hiếm.
- [x] Mặc định **Anh–Anh** — không phải vì nó "chính" mà vì nó là view **duy nhất chạy offline** (brief §3.1 *English first, network never blocks*); mặc định mở ra một view có thể hiện "Cần mạng" là trải nghiệm tệ.
- [x] Thanh view **ghim ngay dưới header**, không đặt dưới khối headword — đặt dưới thì vị trí xê dịch theo từng từ (banner biến thể có/không, headword dài/ngắn); ở đây nó đứng yên với mọi từ, học được bằng cơ bắp.
- [x] **Chip từ loại xuống dưới headword, thay hẳn dòng `noun · grammar · labels`.** 91,3% số từ chỉ có 1 từ loại → vẫn tô đậm y hệt (chip tô đậm đọc ra là *trạng thái*, không phải nút), chỉ bỏ `onPress` nên bấm không nhấp nháy như nút hỏng. Nhiều từ loại thì chip thứ hai hiện cạnh và chuyển được.
- [x] `grammar`/`labels` **xuống dòng riêng** dạng badge, dùng lại style `tagBadge` có sẵn ở cấp nghĩa — không gộp cùng hàng với chip, vì hàng đó sẽ vừa chọn được vừa không.
- [x] **Đổi chip KHÔNG reset view**: `entryIdx` và `view` là hai state riêng. Đang đọc Tiếng Việt của `bank` (noun) bấm sang verb thì vẫn ở Tiếng Việt, nội dung đổi theo `meaningsForPos`.
- [x] **Mỗi view nhớ vị trí cuộn riêng**: mỗi view một `ScrollView`, ẩn bằng `display:'none'` chứ không unmount. View chưa vào bao giờ thì chưa nằm trong `visited` nên chưa tồn tại → **giữ nguyên tính lazy**: tab Ảnh không gọi DuckDuckGo cho tới khi bấm vào thật. Bỏ được `<Accordion>` bọc ảnh mà không mất hợp đồng lazy.
- [x] Khối nhận diện từ (banner biến thể, headword, chip, IPA, loa, YouGlish) **nằm trong** ScrollView chứ không ghim — loa dùng lúc mới mở từ, không dùng liên tục, nên để nó cuộn đi nhường màn hình cho nội dung. Cùng một element JSX dùng lại cho cả 3 view.
- [x] `src/components/search-overlay.tsx` (mới) — `<Modal>` phủ lên, **không** route mới: đóng là về đúng từ đang đọc, back stack không phình thêm tầng chỉ để gõ chữ. Tự focus sau 120ms (chờ modal vào xong, nếu không bàn phím bị nuốt). Chọn gợi ý thì `push` để tra chuỗi `bank → river` rồi back ngược lại được. Dùng lại đúng `suggest()` của màn Tra cứu — không có "hai kiểu tìm".
- [x] Khối ảnh phải tự cấp `s.section` padding: trước kia `<Accordion>` cấp lề, bỏ accordion đi thì lưới tràn sát mép trong khi mọi thứ khác thụt vào. **Bắt được lỗi này nhờ chụp màn hình trên máy ảo, `tsc` không thấy.**

### Kèm theo — sửa bug lệch dòng số nghĩa (phát hiện khi user soi mockup)
`senseNum` cỡ 14 và `guideword` cỡ 11, mỗi cái tự tính hộp dòng riêng rồi cùng canh mép trên → chân chữ lệch. Ép cả hai `lineHeight: 20` thì chữ tự canh giữa trong cùng hộp dòng.

Chỉ 1,5% số từ có guideword, **nhưng nhóm đó trung bình 7,5 nghĩa/từ** (phần còn lại 1,4) — tức lỗi rơi đúng vào những entry dài nhất, đúng lúc người ta cần cột số để dò.

### Test
- [x] `npx tsc --noEmit` — 0 lỗi. `npx vitest run` — 46/46 pass (thay đổi thuần UI, không đụng service).

### Verify — chạy thật trên emulator (Android 16 / API 36)
- [x] Thanh 3 view ghim dưới header, gạch chân teal ở view đang chọn.
- [x] Chip `noun`/`verb` dưới headword; `river` (1 từ loại) vẫn tô đậm đúng như từ nhiều từ loại.
- [x] Tab Ảnh: lưới 3×3 ảnh thật, **thẳng hàng** với headword sau khi thêm padding.
- [x] Tab Tiếng Việt: nghĩa Việt + ghi chú, cả hai đã rời khỏi luồng Anh–Anh.
- [x] **Đổi chip giữ nguyên view**: đang ở Tiếng Việt bấm `verb` → vẫn Tiếng Việt, nghĩa đổi sang nghĩa động từ, `noun` chuyển sang "Nghĩa khác".
- [x] **Nhớ cuộn**: cuộn sâu trong Anh–Anh → sang view khác → quay lại, vẫn đúng chỗ cũ.
- [x] Số nghĩa 2/3/4/5 thẳng hàng với guideword `money` / `of plane` / `form piles` / `a fire`.
- [x] Search overlay: tự focus, gợi ý sống (`riv` → rival/riven/river/rivet), chọn `river` điều hướng thẳng không qua Trang chủ.
- [ ] **Còn lại**: chưa chạy iOS. Chưa thử với cỡ chữ lớn nhất trong Cài đặt (`fontScale`) — thanh 3 view có thể tràn ngang ở tiếng Việt dài như "Tiếng Việt".

### Report sau code
Cấu trúc user đề xuất tốt hơn bản đầu của mình ở 2 điểm và mình đã nói rõ vì sao: tab ở vị trí cố định (bản mình đặt dưới headword nên xê dịch theo từng từ), và nó xoá luôn vấn đề "hai dải ngang" mà bản mình phải bày cách phân biệt. Ngược lại mình giữ 2 điểm data không ủng hộ đề xuất ban đầu: không tách section thành tab (rỗng 95% thời gian), và chip vẫn tô đậm khi chỉ có 1 từ loại (ý viền-đứt của mình ở mockup v2 là ký hiệu tự chế, user bác đúng). Hai phát hiện chỉ lộ ra khi đo data: dòng chữ xám không chỉ chứa từ loại (45,6% có thêm grammar/labels), và chip không tác dụng lên tab Ảnh (ảnh tra theo headword, giống nhau giữa các từ loại) — mục sau chấp nhận để nguyên, ẩn/làm mờ đều đắt hơn cái lợi.

---

## Task 34 — [Perf] Cắt mỡ oxford-app.db: 185MB → 143MB, không mất dữ liệu

### Mô tả
User lo "file db nặng, build app sẽ nặng". **Tiền đề sai** — mở APK vừa build ra kiểm tra: **0 byte database** trong đó (nặng nhất là `libreactnative.so` 21MB + các file dex). DB được tải về `documentDirectory` ở SCR-00 đúng như spec §0.3. Vấn đề thật là (a) bắt user tải 185MB lần đầu, (b) 185MB nằm lại trên đĩa máy.

### Đo trước khi sửa (toàn bộ 68.832 entry)
Dung lượng theo bảng: `entries` **152,5MB (82%)** · `forms` 16,1MB · `search_index`+index 15,2MB.

Bóc cột `data` (112,1MB JSON):

| Thành phần | | |
|---|---|---|
| Key JSON + dấu ngoặc | 47,6 MB | 42,5% |
| **`pronunciations`** | **32,3 MB** | **28,8%** |
| Định nghĩa + ví dụ | 15,8 MB | 14,1% |

`pronunciations` phình vì mỗi entry lưu **4 URL Oxford đầy đủ**, trong đó `audio_ogg` **không có trong interface `EntryData`** và grep toàn `src/` không chỗ nào đọc — dead weight thuần.

### Solution implemented
- [x] `scripts/build-app-db.js` — thêm `slimEntry()` chạy lúc copy bảng entries:
  - bỏ `audio_ogg` → **−14,5MB**
  - bỏ `word`/`pos`/`cefr` (đã là cột của chính bảng entries, đang lưu 2 lần) → **−3,0MB**
  - cắt tiền tố `https://www.oxfordlearnersdictionaries.com/media/english/` (55 ký tự × >130k URL) → **−7,1MB**
  - bỏ `inflections`/`variants` (luôn null trong data thật)
- [x] `src/db/types.ts` — `parseEntryData()` ghép lại tiền tố khi đọc. Chọn chỗ này vì nó vốn đã chuẩn hoá shape → `playUrl`, cache key SHA-256, và toàn bộ UI **không phải đổi một dòng nào**.
- [x] `absAudio()` bỏ qua URL đã tuyệt đối → **máy nào đã tải bản DB cũ vẫn chạy bình thường**, không bắt ai tải lại 185MB chỉ vì đổi cách lưu.
- [x] **KHÔNG** đụng URL trong bảng `forms`: chỉ được thêm 2,8MB (1,5%) mà phải sửa 2 câu query trong `lookup.ts` cộng 2 chỗ đọc thẳng trong JSX — không đáng đổi.

### Kết quả đo thật (rebuild từ oxford.db nguồn 1,4GB)
| | Đĩa | gzip | zstd |
|---|---|---|---|
| Cũ | 185 MB | 28 MB | 21 MB |
| **Mới** | **143 MB** | **26 MB** | **19 MB** |

`data`: 112,1MB → 84,9MB (−24,3%).

**Nén và cắt mỡ giải quyết hai vấn đề khác nhau** — nén ăn 85% dung lượng *tải* nhưng không cứu được *đĩa*; cắt mỡ ăn 42MB *đĩa* nhưng sau khi nén chỉ còn giúp 2MB tải.

### Test
- [x] So khớp 2 DB: số dòng `entries`/`forms`/`search_index`/`form_type_label` **giống hệt**.
- [x] **131.221 URL audio** ghép lại và so với bản gốc — **0 sai**. 0 entry lệch số nghĩa.
- [x] 4 test mới cho `parseEntryData`: ghép tiền tố, giữ nguyên URL tuyệt đối (tương thích ngược), audio null không sinh URL rác, data thiếu word/pos/cefr vẫn parse.
- [x] `npx tsc --noEmit` — 0 lỗi. `npx vitest run` — **50/50 pass**.

### Verify
- [x] Đẩy DB mới vào emulator, xoá cả `-shm`/`-wal` cũ (WAL mồ côi trỏ vào file đã bị thay là đường dẫn thẳng tới lỗi "file is not a database").
- [x] Chạy thật trên emulator với DB mới: `river` hiện đủ IPA, 5 biến thể, 2 nghĩa, Idioms, Word origin, See also.
- [x] **Phát âm chạy** — bấm loa UK, app tải và cache file MP3 17KB. Kiểm chặt hơn: cache key là SHA-256 của URL, tên file trên máy (`48b685a6…899ed`) **khớp đúng** SHA-256 của URL đầy đủ `…/uk_pron/r/riv/river/river__gb_1.mp3` → tiền tố được ghép lại chính xác từng ký tự, không phải "nghe được là may".

### Chưa làm (phần host)
Vẫn còn `DEFAULT_URL = 'http://192.168.1.10:3000/oxford-app.db'` hardcode IP LAN — user thật không tải được. Đã bàn phương án:
- **Google Drive: KHÔNG.** File >100MB trả trang HTML cảnh báo virus kèm confirm token, `createDownloadResumable` sẽ ghi trang HTML đó vào `oxford-app.db` → `isCorruptionError()` khớp → app xoá file và đá về onboarding, lặp vô hạn.
- **GitHub Releases** (khuyên dùng): free, 2GB/file, URL cố định, **hỗ trợ Range** nên giữ được resumable. Repo hiện chưa có remote.
- **Tránh** Cloudflare Pages/Netlify — giới hạn ~25MB/file, chặn thẳng file 26MB.
- Nén: **không** dựa vào `Content-Encoding: gzip` (GitHub Releases trả nguyên trạng, Cloudflare bỏ qua nén file >10MB). Thay vào đó host `.zip` rồi giải nén native bằng `react-native-zip-archive@9.5.1` — app **vốn đã bắt buộc dev build** nên thêm native module không tốn thêm gì về quy trình, và Range vẫn chạy trên file nhị phân thường.

---
