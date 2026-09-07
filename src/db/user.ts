/**
 * user.db — everything the user owns. Kept apart from oxford.db so a
 * dictionary update never touches their data (spec §0.1).
 * Migrations via PRAGMA user_version so future columns are one numbered step.
 */
import type { DbLike } from './types';
import type { SrsState } from '../services/srs';

const MIGRATIONS: string[] = [
    // v1 — initial schema (spec §0.1 + vi_cache §0.5)
    `
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        entry_id INTEGER,
        looked_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saved_words (
        entry_id INTEGER PRIMARY KEY,
        headword TEXT NOT NULL,
        pos TEXT, cefr TEXT,
        user_meaning TEXT,
        note TEXT,
        saved_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS srs_state (
        entry_id INTEGER PRIMARY KEY REFERENCES saved_words(entry_id) ON DELETE CASCADE,
        box INTEGER DEFAULT 1,
        due_at TEXT DEFAULT (datetime('now')),
        streak INTEGER DEFAULT 0,
        last_result INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS vi_cache (
        word TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        fetched_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_history_time ON history(looked_at DESC);
    `,
    // v2 — image search cache (tab "Ảnh"; nguồn ảnh: xem services/image-search.ts)
    `
    CREATE TABLE IF NOT EXISTS image_cache (
        query TEXT NOT NULL,
        page INTEGER NOT NULL,
        json TEXT NOT NULL,
        fetched_at TEXT,
        PRIMARY KEY (query, page)
    );
    `,
    // v3 — FSRS scheduler columns (Phase 2). `box`/`streak`/`last_result` stay
    // as-is: `box` becomes a cosmetic bucket derived from `stability` for the
    // Leitner-ladder UI, `last_result`/`streak` still drive SessionQueue's
    // in-session learning-step orchestration, which is unchanged.
    `
    ALTER TABLE srs_state ADD COLUMN stability REAL;
    ALTER TABLE srs_state ADD COLUMN difficulty REAL;
    ALTER TABLE srs_state ADD COLUMN fsrs_state INTEGER;
    ALTER TABLE srs_state ADD COLUMN reps INTEGER;
    ALTER TABLE srs_state ADD COLUMN lapses INTEGER;
    ALTER TABLE srs_state ADD COLUMN scheduled_days INTEGER;
    ALTER TABLE srs_state ADD COLUMN learning_steps INTEGER;
    ALTER TABLE srs_state ADD COLUMN last_review TEXT;
    `,
];

export async function migrateUserDb(db: DbLike): Promise<void> {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    let v = row?.user_version ?? 0;
    while (v < MIGRATIONS.length) {
        await db.execAsync(MIGRATIONS[v]);
        v++;
        await db.execAsync(`PRAGMA user_version = ${v}`);
    }
    await db.execAsync('PRAGMA foreign_keys = ON');
}

// ---------------------------------------------------------------- history
export async function addHistory(db: DbLike, query: string, entryId: number | null) {
    await db.runAsync('INSERT INTO history (query, entry_id) VALUES (?, ?)', query, entryId);
}
export async function recentQueries(db: DbLike, limit = 10): Promise<string[]> {
    const rows = await db.getAllAsync<{ query: string }>(
        'SELECT query, MAX(looked_at) t FROM history GROUP BY query ORDER BY t DESC LIMIT ?', limit);
    return rows.map((r) => r.query);
}
export const deleteRecentQuery = (db: DbLike, query: string) =>
    db.runAsync('DELETE FROM history WHERE query = ?', query);
export async function historyByDay(db: DbLike, limit = 50, offset = 0) {
    return db.getAllAsync<{ id: number; query: string; entry_id: number | null; looked_at: string }>(
        'SELECT id, query, entry_id, looked_at FROM history ORDER BY looked_at DESC LIMIT ? OFFSET ?',
        limit, offset);
}
export const deleteHistoryRow = (db: DbLike, id: number) =>
    db.runAsync('DELETE FROM history WHERE id = ?', id);
export const clearHistory = (db: DbLike) => db.runAsync('DELETE FROM history');

// ---------------------------------------------------------------- saved
export interface SavedWord {
    entry_id: number; headword: string; pos: string | null; cefr: string | null;
    user_meaning: string | null; note: string | null; saved_at: string;
    box?: number; due_at?: string;
}

export async function isSaved(db: DbLike, entryId: number): Promise<boolean> {
    return !!(await db.getFirstAsync('SELECT 1 FROM saved_words WHERE entry_id = ?', entryId));
}

/** Save (or re-save). Never resets SRS; updates user_meaning only when provided. */
export async function saveWord(
    db: DbLike,
    w: { entry_id: number; headword: string; pos?: string | null; cefr?: string | null; user_meaning?: string | null },
) {
    await db.runAsync(
        `INSERT INTO saved_words (entry_id, headword, pos, cefr, user_meaning)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           user_meaning = COALESCE(excluded.user_meaning, saved_words.user_meaning)`,
        w.entry_id, w.headword, w.pos ?? null, w.cefr ?? null, w.user_meaning ?? null);
    await db.runAsync(
        `INSERT OR IGNORE INTO srs_state (entry_id, box, due_at, streak, last_result)
         VALUES (?, 1, datetime('now'), 0, NULL)`, w.entry_id);
}

export const unsaveWord = (db: DbLike, entryId: number) =>
    db.runAsync('DELETE FROM saved_words WHERE entry_id = ?', entryId);

/** Chỉ id, để Trang chủ loại từ đã lưu khỏi gợi ý mà không phải nạp cả hàng. */
export async function savedEntryIds(db: DbLike): Promise<number[]> {
    const rows = await db.getAllAsync<{ entry_id: number }>('SELECT entry_id FROM saved_words');
    return rows.map((r) => r.entry_id);
}

export type SavedOrder = 'recent' | 'az' | 'due' | 'cefr';

export async function listSaved(db: DbLike, order: SavedOrder = 'recent'): Promise<SavedWord[]> {
    const orderSql =
        order === 'az' ? 'w.headword COLLATE NOCASE ASC'
        : order === 'due' ? 's.due_at ASC'
        : order === 'cefr' ? `CASE w.cefr
            WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3
            WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 WHEN 'C2' THEN 6 ELSE 9 END, w.headword COLLATE NOCASE`
        : 'w.saved_at DESC';
    return db.getAllAsync<SavedWord>(
        `SELECT w.*, s.box, s.due_at FROM saved_words w
         LEFT JOIN srs_state s ON s.entry_id = w.entry_id ORDER BY ${orderSql}`);
}

export async function savedStats(db: DbLike): Promise<{ total: number; due: number }> {
    const row = await db.getFirstAsync<{ total: number; due: number }>(
        `SELECT COUNT(*) total,
                SUM(CASE WHEN s.due_at IS NOT NULL AND s.due_at <= datetime('now') THEN 1 ELSE 0 END) due
         FROM saved_words w LEFT JOIN srs_state s ON s.entry_id = w.entry_id`);
    return { total: row?.total ?? 0, due: row?.due ?? 0 };
}

export async function getSaved(db: DbLike, entryId: number): Promise<SavedWord | null> {
    return db.getFirstAsync<SavedWord>(
        `SELECT w.*, s.box, s.due_at FROM saved_words w
         LEFT JOIN srs_state s ON s.entry_id = w.entry_id WHERE w.entry_id = ?`, entryId);
}

export async function updateUserMeaning(db: DbLike, entryId: number, meaning: string | null) {
    await db.runAsync('UPDATE saved_words SET user_meaning = ? WHERE entry_id = ?', meaning, entryId);
}

export const clearViCache = (db: DbLike) => db.runAsync('DELETE FROM vi_cache');

// ---------------------------------------------------------------- image search cache
export async function getCachedImages(
    db: DbLike, query: string, page: number, maxAgeMs?: number,
): Promise<string | null> {
    const row = await db.getFirstAsync<{ json: string; fetched_at: string | null }>(
        'SELECT json, fetched_at FROM image_cache WHERE query = ? AND page = ?', query, page);
    if (!row) return null;
    if (maxAgeMs != null) {
        // Hàng cũ có thể không có fetched_at hợp lệ — coi như đã hết hạn thì
        // an toàn hơn là giữ mãi một kết quả không biết lấy từ bao giờ.
        const at = row.fetched_at ? Date.parse(row.fetched_at) : NaN;
        if (!Number.isFinite(at) || Date.now() - at > maxAgeMs) return null;
    }
    return row.json;
}
export const cacheImages = (db: DbLike, query: string, page: number, json: string) =>
    db.runAsync(
        'INSERT OR REPLACE INTO image_cache (query, page, json, fetched_at) VALUES (?, ?, ?, ?)',
        query, page, json, new Date().toISOString());
export const clearImageCache = (db: DbLike) => db.runAsync('DELETE FROM image_cache');

export interface NextDue { due_at: string; count: number }

export async function nextDueAt(db: DbLike): Promise<NextDue | null> {
    const min = await db.getFirstAsync<{ due_at: string }>(
        `SELECT MIN(due_at) due_at FROM srs_state WHERE due_at > datetime('now')`);
    if (!min?.due_at) return null;
    const counted = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) n FROM srs_state WHERE date(due_at) = date(?)`, min.due_at);
    return { due_at: min.due_at, count: counted?.n ?? 1 };
}

// ---------------------------------------------------------------- srs persistence
export async function loadSrsStates(db: DbLike): Promise<SrsState[]> {
    return db.getAllAsync<SrsState>(
        `SELECT entry_id, box, due_at, streak, last_result,
                stability, difficulty, fsrs_state, reps, lapses, scheduled_days, learning_steps, last_review
         FROM srs_state`);
}
export async function persistGrades(db: DbLike, graded: SrsState[]) {
    for (const g of graded) {
        await db.runAsync(
            `UPDATE srs_state SET box=?, due_at=?, streak=?, last_result=?,
                stability=?, difficulty=?, fsrs_state=?, reps=?, lapses=?, scheduled_days=?, learning_steps=?, last_review=?
             WHERE entry_id=?`,
            g.box, g.due_at, g.streak, g.last_result,
            g.stability ?? null, g.difficulty ?? null, g.fsrs_state ?? null,
            g.reps ?? null, g.lapses ?? null, g.scheduled_days ?? null, g.learning_steps ?? null, g.last_review ?? null,
            g.entry_id);
    }
}

// ---------------------------------------------------------------- settings
const SETTING_DEFAULTS: Record<string, string> = {
    pref_dialect: 'uk',
    autoplay: '0',
    review_autoplay: '0',
    font_scale: 'm',
    theme_mode: 'system',
};
export async function getSetting(db: DbLike, key: string): Promise<string> {
    const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM settings WHERE key = ?', key);
    return row?.value ?? SETTING_DEFAULTS[key] ?? '';
}
export const setSetting = (db: DbLike, key: string, value: string) =>
    db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
