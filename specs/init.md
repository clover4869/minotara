# SPEC — Từ điển Anh-Anh (Mobile)

**Phiên bản** 1.0 · **Nền tảng** React Native / Flutter · **Data** `oxford.db` (SQLite, read-only) + `user.db` (SQLite, dữ liệu người dùng)
**Phạm vi** Tra từ · Lịch sử · Từ đã lưu · Flashcard ôn tập

---

## 0. Kiến trúc dữ liệu (đọc trước khi làm màn nào)

### 0.1. Hai file database — KHÔNG gộp

| File | Vai trò | Ghi/Đọc | Lý do tách |
|---|---|---|---|
| `oxford.db` | Từ điển: `entries`, `forms`, `form_type_label`, `audio` | chỉ đọc | Update phiên bản từ điển = thay file, không đụng data user |
| `user.db` | `history`, `saved_words`, `srs_state`, `settings` | đọc/ghi | Sống sót qua mọi lần update từ điển |

Schema `user.db`:

```sql
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,            -- chuỗi người dùng gõ
  entry_id INTEGER,               -- entry đã mở (NULL nếu chỉ xem form)
  looked_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE saved_words (
  entry_id INTEGER PRIMARY KEY,   -- tham chiếu oxford.entries.id
  headword TEXT NOT NULL,         -- denormalize để list không cần join cross-db
  pos TEXT, cefr TEXT,
  user_meaning TEXT,              -- nghĩa user tự nhập/import; NULL = dùng nghĩa từ điển
  note TEXT,                      -- ghi chú cá nhân (khác nghĩa: "hay gặp trong đề đọc")
  saved_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE srs_state (
  entry_id INTEGER PRIMARY KEY REFERENCES saved_words(entry_id) ON DELETE CASCADE,
  box INTEGER DEFAULT 1,          -- Leitner 1..5
  due_at TEXT DEFAULT (datetime('now')),
  streak INTEGER DEFAULT 0,
  last_result INTEGER             -- 1 đúng / 0 sai
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
```

### 0.2. Bảng search_index — build một lần khi đóng gói

Autocomplete cần một bảng phẳng, không thể prefix-search trên 2 bảng lúc runtime. Thêm vào `oxford.db` ở bước build (script offline, chạy 1 lần):

```sql
CREATE TABLE search_index (
  term      TEXT NOT NULL,        -- lowercase
  kind      TEXT NOT NULL,        -- 'headword' | 'form'
  entry_id  INTEGER,              -- headword: entry đích; form: entry của lemma
  display   TEXT NOT NULL,        -- chữ hiển thị gốc (giữ hoa/’)
  sub       TEXT                  -- form: 'past tense of run' để hiện dòng phụ
);
CREATE INDEX idx_si_term ON search_index(term);

-- nguồn 1: headwords
INSERT INTO search_index
SELECT DISTINCT lower(headword), 'headword', id, headword, pos FROM entries;
-- nguồn 2: forms đã link (bỏ form_type='other' — là từ phái sinh, không phải biến thể)
INSERT INTO search_index
SELECT DISTINCT f.form, 'form', f.entry_id, f.form,
       l.en || ' of ' || f.lemma
FROM forms f JOIN form_type_label l ON l.form_type = f.form_type
WHERE f.entry_id IS NOT NULL AND f.form_type != 'other';
```

### 0.3. Đóng gói db & audio

- `oxford.db` **không audio bytes** (~vài trăm MB): bundle trong assets, first-launch copy sang app dir. Nếu vẫn nặng quá store limit → tải về lần đầu mở app (màn SCR-00).
- Audio: **không bundle 2GB**. Chiến lược 3 tầng, theo đúng data đang có:
  1. `audio.bytes` đã tải (nếu ship kèm gói audio offline) → phát từ BLOB
  2. Chưa có bytes → stream từ `forms.audio_uk/us/any` (URL Oxford/Wikimedia), cache file xuống local sau lần phát đầu
  3. Offline + không cache → icon loa disabled, vẫn hiện IPA

### 0.5. Lớp nghĩa tiếng Việt — ONLINE (giai đoạn 1)

Nguồn: `GET https://dict.minhqnd.com/api/v1/lookup?word={lemma}&lang=en&def_lang=vi` (free, CC BY-SA 4.0 — ghi công bắt buộc, xem 06-06). Anh-Anh vẫn 100% offline; chỉ nghĩa Việt cần mạng.

Rule cứng:
- **Cache-first**: bảng `user.db`: `vi_cache(word TEXT PRIMARY KEY, json TEXT, fetched_at TEXT)`. Có cache → không gọi API. TTL: không hết hạn (nghĩa từ điển không đổi), chỉ xoá qua 06-05.
- **Gọi bằng LEMMA**: tra `walked` → gọi `word=walk` (tra bảng `forms` trước khi gọi).
- **Không block UI**: nội dung Anh render ngay; khối Việt async, timeout 3s, retry 1 lần, fail-soft.
- Map `pos` Việt trong response → tab entry: `Danh từ`→noun, `Động từ`→verb, `Tính từ`→adjective, `Phó từ`→adverb; không khớp → mục "Nghĩa khác".
- Giai đoạn 2 (nếu cần full offline): extract `dictionary.db` (Releases của repo) merge vào db local — chỉ đổi tầng nguồn, component UI giữ nguyên.

### 0.4. Hai query lookup lõi (mọi màn tra từ dùng chung)

```sql
-- Q1: entry trực tiếp (một từ có thể ra nhiều entry = homograph run_1/run_2)
SELECT id, headword, pos, cefr, data FROM entries WHERE lower(headword) = :q;

-- Q2: từ này là biến thể của từ nào (chạy SONG SONG Q1, không phải fallback)
SELECT f.form, f.form_type, l.vi AS label_vi, l.en AS label_en, l.sort,
       f.ipa_uk, f.ipa_us,
       COALESCE(f.audio_uk, f.audio_any) AS audio_uk,
       COALESCE(f.audio_us, f.audio_any) AS audio_us,
       f.lemma, e.id AS entry_id, e.headword, e.pos
FROM forms f
LEFT JOIN entries e ON e.id = f.entry_id
LEFT JOIN form_type_label l ON l.form_type = f.form_type
WHERE f.form = :q AND f.form_type != 'other'
ORDER BY l.sort;
```

---

## SCR-00 · Khởi động lần đầu (First launch)

**Mục đích** Chuẩn bị db trước khi vào app. Chỉ hiện đúng một lần.

| ID | Thành phần | Mô tả | Rule |
|---|---|---|---|
| 00-01 | Logo + progress bar | Copy/tải `oxford.db` | Copy assets→app dir; verify bằng `PRAGMA integrity_check` |
| 00-02 | Text trạng thái | "Đang chuẩn bị từ điển…" | Hiện % nếu là download |
| 00-03 | Nút Thử lại | Chỉ hiện khi lỗi | Lỗi disk đầy → thông báo dung lượng cần |

**Điều hướng** Xong → SCR-01. Lần mở sau: check file tồn tại + version khớp → vào thẳng SCR-01.

---

## SCR-01 · Tra cứu (Home / Search)

**Mục đích** Điểm vào chính. Gõ → gợi ý tức thì → chọn → SCR-02.

### Layout

| ID | Thành phần | Mô tả | Data / Rule |
|---|---|---|---|
| 01-01 | Search bar | Autofocus khi mở màn; nút clear; nút mic (phase 2) | Debounce 150ms |
| 01-02 | List gợi ý | Hiện khi query ≥ 1 ký tự, tối đa 12 dòng | `SELECT DISTINCT display, sub, kind, entry_id FROM search_index WHERE term LIKE :q || '%' ORDER BY kind='headword' DESC, length(term) LIMIT 12` |
| 01-03 | Dòng gợi ý kind=headword | Chữ đậm + pos mờ bên phải | `display` + `sub`(=pos) |
| 01-04 | Dòng gợi ý kind=form | Chữ thường + dòng phụ nhỏ "past tense of run" | `sub`; tap → SCR-02 của **lemma**, kèm param `via_form` |
| 01-05 | Khối "Gần đây" | 10 lượt tra gần nhất, hiện khi search bar trống | `user.db: SELECT DISTINCT query FROM history ORDER BY looked_at DESC LIMIT 10`; nút xoá từng dòng |
| 01-06 | Khối "Từ hôm nay" (tuỳ chọn) | 1 từ random CEFR B1-B2 làm điểm chạm học | `SELECT ... FROM entries WHERE cefr IN ('B1','B2') ORDER BY RANDOM() LIMIT 1` — cache theo ngày |
| 01-07 | Empty state không match | "Không tìm thấy — ý bạn là:" + 5 gợi ý gần đúng | Fallback: `term LIKE '%' || :q || '%'` LIMIT 5; vẫn trống → chỉ hiện thông báo |

### Hành vi
- Submit (Enter) khi có ≥1 gợi ý → mở gợi ý đầu tiên.
- Query chuẩn hoá: `lower(trim())`, giữ nguyên dấu `'`/`’` (search_index đã lưu cả hai — build script cần normalize `’`→`'` ở cột term).

---

## SCR-02 · Chi tiết từ (Word Detail) — màn quan trọng nhất

**Mục đích** Hiển thị đầy đủ một từ: nghĩa Oxford + biến thể + phát âm. Nhận param: `q` (chuỗi tra) hoặc `entry_id`.

### Logic vào màn (quyết định layout)

Chạy Q1 + Q2 song song với `q`:

| Kết quả | Hiển thị | Ví dụ |
|---|---|---|
| Q1 có, Q2 rỗng | Layout entry chuẩn (02-A) | `abandon` |
| Q1 có, Q2 có | Banner form-of (02-B) TRÊN entry chuẩn | `running`, `saw`, `read` |
| Q1 rỗng, Q2 có | Chỉ banner form-of phóng to + nút sang lemma | `walked`, `children` |
| Cả hai rỗng | Không xảy ra nếu vào từ gợi ý; deep-link lạ → về 01-07 | — |

### 02-B · Banner form-of

| ID | Thành phần | Mô tả | Data |
|---|---|---|---|
| 02B-01 | Câu dẫn | "**walked** — quá khứ (V2) của **walk**" | Q2: `form + label_vi + lemma`; nhiều dòng nếu nhiều form_type (walked có V2+V3 → gộp "quá khứ (V2) · quá khứ phân từ (V3)") |
| 02B-02 | IPA của form | `/wɔːkt/` UK · US | Q2 `ipa_uk/ipa_us`; **heteronym như `read` có 2 dòng khác IPA — hiện từng dòng riêng, KHÔNG gộp** |
| 02B-03 | Nút loa UK/US | Phát audio của chính form | Thứ tự nguồn theo §0.3; `dialect` ưu tiên theo settings |
| 02B-04 | Nút "Xem từ gốc →" | Chỉ ở case Q1 rỗng | Điều hướng SCR-02 với `entry_id` lemma |

### 02-A · Entry chuẩn

| ID | Thành phần | Mô tả | Data (`entries.data` JSON) |
|---|---|---|---|
| 02-01 | Tabs homograph | Khi Q1 trả >1 entry: tab theo pos — "verb · noun" | Mỗi tab = 1 entry; mặc định entry đầu; nếu vào từ form thì active tab có pos khớp `lemma_pos` |
| 02-02 | Headword + hom | Chữ lớn; số homograph nhỏ nếu có | `$.word`, `$.homograph` |
| 02-03 | Badge CEFR | A1..C2, màu theo level | `$.cefr`; ẩn nếu null |
| 02-04 | POS + grammar + labels | "verb · [transitive] · (informal)" | `$.pos`, `$.grammar`, `$.labels` |
| 02-05 | Khối phát âm | UK /rʌn/ 🔊 · US /rʌn/ 🔊 | `$.pronunciations.uk/us.phon + audio_mp3`; autoplay theo settings |
| 02-05b | Link "Nghe trong video thật ↗" (phase 1.5) | Dòng nhỏ dưới IPA, mở browser/Custom Tab: `https://youglish.com/pronounce/{word}/english/{uk\|us}` theo `pref_dialect`. Tra form đã chia → link bằng chính form đó ("walked"), không phải lemma. CHỈ hiện khi online; offline ẩn hẳn. Link-out thuần, KHÔNG nhúng widget (điều khoản mobile-app + YouTube ToS của YouGlish) | — |
| 02-06 | Bảng biến thể | Bảng V1/V2/V3… hoặc plural/comparative, mỗi dòng: nhãn VI + chữ + IPA + loa | `SELECT ... FROM forms WHERE entry_id=:id AND form_type!='other' ORDER BY sort` (join `form_type_label`); ẩn cả khối nếu rỗng (danh từ thường, 135 verb khuyết) |
| 02-07 | Senses | Đánh số 1,2,3…; mỗi sense: guideword (chip xám), definition, grammar/labels nhỏ, ví dụ (toggle "xem thêm" nếu >2) | `$.senses[]`: `.guideword .definition .grammar .labels .examples[].text` |
| 02-08 | CEFR per-sense | Chấm màu nhỏ cạnh số sense | `$.senses[].cefr` |
| 02-09 | Idioms (accordion, đóng mặc định) | "Idioms (4)" → list idiom + nghĩa + ví dụ | `$.idioms[]` |
| 02-10 | Phrasal verbs (accordion) | Link nội bộ → SCR-02 của phrasal verb | `$.phrasal_verbs[]` — resolve `url`→entry qua `entries.url` |
| 02-11 | Word origin (accordion) | Đoạn văn nguồn gốc từ | `$.word_origin`; ẩn nếu null |
| 02-12 | Synonyms / xrefs | Chips tap được → SCR-02 | `$.senses[].synonyms`, `$.senses[].xrefs`, `$.see_also` |
| 02-12b | **Khối "Nghĩa tiếng Việt"** (online) | Dưới senses, trên idioms. Skeleton khi loading; mỗi nghĩa: definition_vi + ví dụ (nếu có). Footer nhỏ: "Nguồn: dict.minhqnd.com" (link) | §0.5: cache-first `vi_cache`, gọi bằng lemma, lọc theo pos tab đang mở. Offline không cache → dòng "Cần mạng để xem nghĩa Việt · [Thử lại]" |
| 02-13 | Nút Lưu (bookmark, header) | Toggle saved; đã lưu = icon đầy | `user.db saved_words` upsert/delete; lưu → tự tạo `srs_state` box 1 |

### Hành vi & Edge cases
- **Ghi history khi vào màn**: `INSERT INTO history(query, entry_id)` — ghi một lần mỗi lượt vào, không ghi khi đổi tab.
- **Periphrastic** (`more beautiful`): dòng trong bảng 02-06 hiện chữ, cột IPA để "—" (không phải lỗi).
- **Entry stub** (`arose`, `been`…): Q1 có nhưng `senses` gần rỗng → nếu Q2 cũng có, ưu tiên banner form-of lên đầu, entry stub thu gọn.
- Sense rỗng definition (hiếm) → bỏ qua dòng đó.
- Long-press bất kỳ từ nào trong definition/ví dụ → popup tra nhanh (mini SCR-02, phase 2).

---

## SCR-03 · Lịch sử

| ID | Thành phần | Mô tả | Data |
|---|---|---|---|
| 03-01 | List theo ngày | Section header "Hôm nay / Hôm qua / dd/mm"; dòng: query + headword đích + giờ | `history` ORDER BY looked_at DESC, phân trang 50 |
| 03-02 | Swipe xoá | Xoá một dòng | DELETE by id |
| 03-03 | Nút "Xoá tất cả" | Confirm dialog | DELETE FROM history |
| 03-04 | Tap dòng | → SCR-02 (`entry_id` nếu có, không thì `q=query`) | — |
| 03-05 | Empty state | "Chưa tra từ nào" + nút về SCR-01 | — |

---

## SCR-04 · Từ của tôi (Saved + Import)

| ID | Thành phần | Mô tả | Data |
|---|---|---|---|
| 04-01 | Search trong sổ | Filter client-side theo headword | — |
| 04-02 | Sort | Mới nhất / A-Z / theo CEFR / sắp đến hạn ôn | join `srs_state.due_at` |
| 04-03 | Dòng từ | headword + pos + CEFR badge + chip box SRS (màu 1-5) + note preview | `saved_words` + `srs_state` |
| 04-04 | Swipe xoá | Xoá saved (cascade xoá srs_state) | — |
| 04-05 | Tap → SCR-02 | Mở chi tiết | — |
| 04-06 | Header stats | "42 từ · 7 đến hạn ôn" + nút "Ôn ngay" → SCR-05 | `COUNT(*)`, `COUNT(due_at<=now)` |
| 04-07 | Empty state | Hướng dẫn: "Lưu từ bằng nút 🔖 khi tra, hoặc nhập danh sách từ" | — |
| 04-08 | Nút "Nhập danh sách" (header, icon upload) | Mở flow 04-B | — |

### 04-B · Flow nhập danh sách từ

Format dễ tính — mỗi dòng: `từ` hoặc `từ,nghĩa` hoặc `từ<tab>nghĩa`. Không có khái niệm "sai template", chỉ có match thấp.

| Bước | Mô tả | Rule |
|---|---|---|
| B0 | Icon **?** ở header màn nhập | Mở bottom sheet: 3 dòng ví dụ format + nút "Tải file mẫu (.csv)" (file mẫu bundle sẵn trong app, không cần mạng) |
| B1 | Chọn nguồn: dán text / chọn file .txt hoặc .csv | Parse mỗi dòng: tách ở dấu phẩy/tab ĐẦU TIÊN → `word` + `user_meaning` (nghĩa được chứa dấu phẩy); trim, lowercase word, bỏ trùng; giới hạn 500 từ/lần; bỏ dòng trống & dòng header ("word,meaning") |
| B2 | Đối chiếu với từ điển | Match `search_index` — headword khớp trực tiếp; form khớp → resolve về **lemma** (nhập "ran" = lưu "run", nghĩa user đi theo) |
| B2b | **Cứu hộ match thấp**: nếu >50% không tìm thấy | Banner "Có vẻ danh sách chưa đúng định dạng — Xem hướng dẫn" → mở bottom sheet B0 |
| B3 | Màn xác nhận: 2 nhóm "Tìm thấy (n)" tick sẵn / "Không có trong từ điển (m)" mờ | Dòng có nghĩa user → hiện preview nghĩa dưới từ; homograph → mặc định entry đầu, user đổi được |
| B4 | Nút "Thêm n từ" | Batch insert `saved_words` (kèm `user_meaning`) + `srs_state` box 1; từ đã lưu trước → bỏ qua không reset SRS, NHƯNG nếu lần này có nghĩa user thì cập nhật `user_meaning` |
| B5 | Toast kết quả + nhắc giới hạn thẻ mới | "Đã thêm 46 từ · sẽ vào ôn tập dần, tối đa 20 thẻ mới/ngày" |

**Quy tắc nghĩa xuyên suốt app**: `user_meaning` nếu có → ưu tiên hiển thị (flashcard, preview trong Từ của tôi); không có → nghĩa từ điển. Trong SCR-02, nghĩa user hiện thành khối nhỏ "Ghi chú nghĩa của bạn" có nút sửa, không thay thế senses Oxford.

---

## SCR-05 · Ôn tập Flashcard (SRS Leitner 5 hộp)

### Rule SRS (Leitner 5 hộp + 3 cơ chế mượn từ Anki)

| Box | Chu kỳ ôn | Đúng → | Sai → |
|---|---|---|---|
| 1 | mỗi ngày | box 2 | box 1 |
| 2 | 2 ngày | box 3 | box 1 |
| 3 | 4 ngày | box 4 | box 1 |
| 4 | 1 tuần | box 5 | box 2 |
| 5 | 2 tuần | giữ 5 | box 2 |

`due_at = now + chu_kỳ(box mới) ± random(15%)` — **fuzz** để các từ lưu cùng ngày không mãi đến hạn cùng ngày dồn cục.

Cơ chế mượn từ Anki (giữ nguyên 2 nút chấm — chính cộng đồng Anki khuyên dùng nhị phân, 4 nút gây "ease hell"):
- **Learning steps**: thẻ box 1 chưa từng đúng (streak=0) khi trả lời đúng KHÔNG rời phiên ngay — quay lại cuối hàng đợi, đúng **2 lần trong phiên** mới tốt nghiệp lên box 2. Trả lời sai bất kỳ lúc nào → reset đếm trong phiên.
- **Giới hạn thẻ mới**: tối đa 20 thẻ chưa-từng-ôn mỗi phiên (import 100 từ không tạo ra phiên 100 thẻ); thẻ ôn lại (box ≥2 đến hạn) không giới hạn.
- Phiên ôn = thẻ đến hạn (ưu tiên box thấp trước) + tối đa 20 thẻ mới, trộn ngẫu nhiên, trần 40 thẻ/phiên.

**Đường nâng cấp phase 2**: thay hàm tính `due_at` bằng package `ts-fsrs` (MIT, chạy được RN) — scheduler FSRS như Anki hiện đại, nhận input nhị phân nên UI 2 nút giữ nguyên; `srs_state` thêm cột `stability REAL, difficulty REAL` là đủ.

### 05-A · Màn bắt đầu phiên

| ID | Thành phần | Mô tả |
|---|---|---|
| 05A-01 | Số thẻ đến hạn + phân bố box (mini bar chart) | Query đếm theo box |
| 05A-02 | Chọn chế độ | "Nghĩa → Từ" / "Từ → Nghĩa" / "Nghe → Từ" (cần audio) |
| 05A-03 | Nút Bắt đầu | Disabled nếu 0 thẻ đến hạn; gợi ý "Ôn trước hạn" (lấy thẻ gần hạn nhất) |

### 05-B · Màn thẻ

| ID | Thành phần | Mô tả | Data |
|---|---|---|---|
| 05B-01 | Progress "7/20" + nút thoát | Thoát giữa chừng: kết quả các thẻ đã trả lời VẪN được ghi | — |
| 05B-02 | Mặt trước | Theo chế độ: definition sense 1 (ẩn headword trong ví dụ bằng "___") / headword + IPA / nút loa | `entries.data` |
| 05B-03 | Tap lật thẻ | Mặt sau: headword + IPA + loa + **nghĩa: `user_meaning` nếu có (kèm nhãn nhỏ "nghĩa của bạn"), dưới là nghĩa từ điển** + 1 ví dụ + bảng biến thể rút gọn (chỉ chữ, V2·V3) | Q forms + `saved_words.user_meaning` |
| 05B-03b | **Tự động đọc** (theo setting 06-07) | Bật: audio của từ tự phát khi thẻ HIỆN MẶT CÓ CHỮ (mode Từ→Nghĩa: phát ngay; mode Nghĩa→Từ: phát khi lật), lặp lại mỗi 3 giây đến khi chấm điểm. Giọng theo 06-08. Không có audio (offline, chưa cache) → im lặng, không báo lỗi giữa phiên | settings `review_autoplay` |
| 05B-04 | Hai nút chấm | "Chưa nhớ" (đỏ) / "Đã nhớ" (xanh) — ghi `srs_state` ngay theo rule trên | UPDATE box, due_at, streak |
| 05B-05 | Haptic + animation lật | RN: `Animated`; Flutter: `AnimatedSwitcher` | — |

### 05-C · Màn kết quả phiên

| ID | Thành phần | Mô tả |
|---|---|---|
| 05C-01 | Tỉ lệ đúng + list từ sai (tap → SCR-02) | — |
| 05C-02 | "Lần ôn tiếp theo: X thẻ vào ngày mai" | MIN(due_at) tương lai |
| 05C-03 | Nút "Ôn tiếp thẻ sai" / "Xong" | Phiên phụ chỉ gồm thẻ sai, không tính SRS lần 2 |

---

## SCR-06 · Cài đặt

| ID | Thành phần | Mô tả | Lưu |
|---|---|---|---|
| 06-01 | Giọng ưu tiên | UK / US — quyết định loa nào phát khi tap nhanh & autoplay | settings `pref_dialect` |
| 06-02 | Autoplay phát âm | Bật/tắt phát khi mở SCR-02 | `autoplay` |
| 06-03 | Cỡ chữ nội dung | S / M / L | `font_scale` |
| 06-07 | **Nhóm "Ôn tập" — Tự động đọc từ** | Toggle. Bật: khi ôn flashcard, audio của từ tự phát và lặp mỗi 3s đến khi chấm (chi tiết 05B-03b) | `review_autoplay` (mặc định tắt) |
| 06-08 | **Nhóm "Ôn tập" — Giọng đọc** | Segmented: Anh-Anh (UK) / Anh-Mỹ (US), ngay dưới toggle 06-07 | Ghi vào `pref_dialect` DÙNG CHUNG với 06-01 — một nguồn sự thật, hai chỗ chỉnh; đổi ở đây thì 06-01 đổi theo và ngược lại |
| 06-04 | Gói audio offline | Trạng thái: chưa tải / đã tải (dung lượng); nút tải/xoá — tải file `audio.db` riêng (ATTACH) | `audio_pack` |
| 06-05 | Dữ liệu | Xoá lịch sử / Xoá cache audio streaming / Export sổ từ (JSON) | — |
| 06-06 | Về app | Version app + version data từ điển (`crawl_meta`) + attribution: "Audio & inflection data một phần từ Wiktionary (CC-BY-SA)" · "Nghĩa tiếng Việt: @minhqnd — dict.minhqnd.com (CC BY-SA 4.0)" | **bắt buộc** — điều kiện giấy phép của cả hai nguồn |

---

## Điều hướng tổng

```
Tab bar (4 tab):  [Tra cứu 🔍]  [Từ của tôi 🔖]  [Ôn tập 🎴]  [Cài đặt ⚙]
                    SCR-01        SCR-04       SCR-05       SCR-06
SCR-01 ── gợi ý/gần đây ──▶ SCR-02 ◀── mọi nơi có chữ tap được
SCR-01 ── icon 🕘 header ──▶ SCR-03
SCR-04 ── "Ôn ngay" ──▶ SCR-05
```

Deep link: `dict://word/{headword}` → SCR-02.

---

## Thứ tự triển khai đề xuất

1. §0 data layer + search_index build script → SCR-01 + SCR-02 — **đây là 80% giá trị app**
2. SCR-03 + 04 (nhanh, chỉ là CRUD trên user.db)
3. SCR-05 (SRS)
4. SCR-06 + gói audio offline