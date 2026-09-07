/**
 * Build oxford-app.db — the file the app downloads in SCR-00.
 *
 *   node scripts/build-app-db.js /path/to/oxford.db [out=oxford-app.db]
 *
 * Takes the crawler+forms-kit database and produces a lean, read-only copy:
 *   - keeps: entries, forms, form_type_label (+ audio WITHOUT bytes for urls)
 *   - drops: page_cache, browse_pages, words, crawl_meta, oxford_inflections
 *   - builds: search_index per spec §0.2 ('other' forms excluded, ’ normalized)
 *   - VACUUMs into a fresh file (typically a few hundred MB, from several GB)
 *
 * Requires: npm i -D better-sqlite3 (already a devDependency for tests).
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const out = path.resolve(process.argv[3] || 'oxford-app.db');
if (!src || !fs.existsSync(src)) {
    console.error('usage: node scripts/build-app-db.js /path/to/oxford.db [out.db]');
    process.exit(1);
}
if (fs.existsSync(out)) fs.rmSync(out);

const db = new Database(src, { readonly: true });
const app = new Database(out);
app.pragma('journal_mode = OFF');
app.pragma('synchronous = OFF');

console.log('1/4 copying dictionary tables…');
app.exec(`
CREATE TABLE entries (id INTEGER PRIMARY KEY, word_id INTEGER, url TEXT,
    headword TEXT, pos TEXT, cefr TEXT, data TEXT);
CREATE TABLE forms (id INTEGER PRIMARY KEY, form TEXT, form_type TEXT,
    ipa_uk TEXT, ipa_us TEXT, audio_uk TEXT, audio_us TEXT, audio_any TEXT,
    lemma TEXT, lemma_pos TEXT, tags TEXT, entry_id INTEGER, word_id INTEGER,
    source TEXT, ipa_source TEXT);
CREATE TABLE form_type_label (form_type TEXT PRIMARY KEY, en TEXT, vi TEXT, sort INTEGER);
`);

const copy = (table, cols, transform) => {
    const rows = db.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all();
    const ins = app.prepare(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    const tx = app.transaction((rs) => {
        for (const r of rs) { const v = transform ? transform(r) : r; ins.run(...cols.map((c) => v[c])); }
    });
    tx(rows);
    console.log(`   ${table}: ${rows.length.toLocaleString()} rows`);
};

/**
 * Cắt mỡ entries.data trước khi ghi — 185MB → 143MB, không mất thứ gì app đọc.
 * Đo trên toàn bộ 68.832 entry của bản build trước:
 *
 *   audio_ogg          −14.5MB  Không có trong interface `EntryData`, grep toàn
 *                               src/ không chỗ nào đọc. Dead weight thuần.
 *   word/pos/cefr       −3.0MB  Đã là cột của chính bảng entries; đang lưu 2 lần.
 *   prefix URL audio    −7.1MB  55 ký tự lặp ở hơn 130k URL. `parseEntryData()`
 *                               ghép lại lúc đọc nên phía sau không biết gì.
 *   inflections/variants        Luôn null trong data thật.
 *
 * KHÔNG đụng URL trong bảng `forms`: chỉ được thêm 2.8MB (1.5%) mà phải sửa 2
 * câu query trong lookup.ts cộng 2 chỗ đọc thẳng trong JSX — không đáng đổi.
 *
 * Sửa tiền tố ở đây thì phải sửa `AUDIO_PREFIX` trong src/db/types.ts cho khớp.
 */
const AUDIO_PREFIX = 'https://www.oxfordlearnersdictionaries.com/media/english/';
let slimBefore = 0, slimAfter = 0;

function slimEntry(r) {
    const raw = r.data || '';
    slimBefore += raw.length;
    let d;
    try { d = JSON.parse(raw); } catch { slimAfter += raw.length; return r; }

    for (const k of ['uk', 'us']) {
        const p = d.pronunciations && d.pronunciations[k];
        if (!p) continue;
        delete p.audio_ogg;
        if (typeof p.audio_mp3 === 'string' && p.audio_mp3.startsWith(AUDIO_PREFIX)) {
            p.audio_mp3 = p.audio_mp3.slice(AUDIO_PREFIX.length);
        }
    }
    delete d.word; delete d.pos; delete d.cefr;
    delete d.inflections; delete d.variants;

    const data = JSON.stringify(d);
    slimAfter += data.length;
    return { ...r, data };
}

copy('entries', ['id', 'word_id', 'url', 'headword', 'pos', 'cefr', 'data'], slimEntry);
console.log(`   slim data: ${(slimBefore / 1048576).toFixed(1)}MB → ${(slimAfter / 1048576).toFixed(1)}MB`
    + ` (−${((1 - slimAfter / slimBefore) * 100).toFixed(1)}%)`);
const formCols = db.prepare('PRAGMA table_info(forms)').all().map((c) => c.name)
    .filter((c) => ['id','form','form_type','ipa_uk','ipa_us','audio_uk','audio_us','audio_any','lemma','lemma_pos','tags','entry_id','word_id','source','ipa_source'].includes(c));
copy('forms', formCols);
copy('form_type_label', ['form_type', 'en', 'vi', 'sort']);

console.log('2/4 building search_index…');
app.exec(`
CREATE TABLE search_index (term TEXT NOT NULL, kind TEXT NOT NULL,
    entry_id INTEGER, display TEXT NOT NULL, sub TEXT);
INSERT INTO search_index
SELECT DISTINCT replace(lower(headword), '’', ''''), 'headword', id, headword, pos
FROM entries WHERE headword IS NOT NULL;
INSERT INTO search_index
SELECT DISTINCT replace(lower(f.form), '’', ''''), 'form', f.entry_id, f.form,
       l.en || ' of ' || f.lemma
FROM forms f JOIN form_type_label l ON l.form_type = f.form_type
WHERE f.entry_id IS NOT NULL AND f.form_type != 'other';
CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
`);
app.prepare('INSERT INTO app_meta VALUES (?, ?)').run('built_at', new Date().toISOString());

const crawlSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='crawl_meta'").get();
if (crawlSql?.sql) {
    try {
        app.exec(crawlSql.sql);
        const crawlCols = db.prepare('PRAGMA table_info(crawl_meta)').all().map((c) => c.name);
        copy('crawl_meta', crawlCols);
    } catch (e) {
        console.log('   crawl_meta skipped:', e.message);
    }
}
const siCount = app.prepare('SELECT COUNT(*) c FROM search_index').get().c;
console.log(`   search_index: ${siCount.toLocaleString()} rows`);

console.log('3/4 indexes…');
app.exec(`
CREATE INDEX idx_si_term ON search_index(term);
CREATE INDEX idx_entries_headword ON entries(headword COLLATE NOCASE);
CREATE INDEX idx_forms_form ON forms(form);
CREATE INDEX idx_forms_entry ON forms(entry_id);
`);

console.log('4/4 VACUUM…');
app.pragma('journal_mode = DELETE');
app.exec('VACUUM');
app.close();
db.close();

const mb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log(`done → ${out} (${mb}MB)`);
console.log('\nServe it for the app (same Wi-Fi):');
console.log(`  npx serve ${path.dirname(out)}   # then set the URL in SCR-00`);
