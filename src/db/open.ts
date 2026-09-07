/**
 * The ONLY file that touches expo-sqlite directly. Swapping to op-sqlite
 * later means rewriting this file and nothing else.
 *
 * oxford-app.db is NOT bundled (300MB): SCR-00 downloads it into
 * documentDirectory. user.db is created on first run.
 *
 * Connections are cached by PROMISE, not by resolved value, and that cache
 * lives on `globalThis` rather than a module-local `let`: a plain module
 * variable resets to null every time Metro Fast Refresh/Reload re-executes
 * this file, while the *native* SQLite connection from before is never
 * closed — the next call then opens a second live connection to the same
 * file, and one of the two eventually dies with `NativeDatabase.prepareAsync`
 * → NullPointerException. Stashing the promise on `globalThis` means it
 * survives this module being re-evaluated, so reload doesn't orphan it.
 * Both connections also run in WAL mode as a second line of defense — WAL
 * tolerates multiple simultaneous connections to one file far better than
 * the default rollback journal, in case a handle still leaks somehow (e.g.
 * a full JS-context reload, which even a `globalThis` cache can't survive).
 */
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import type { DbLike } from './types';
import { migrateUserDb } from './user';

export const DICT_FILENAME = 'oxford-app.db';
export const DICT_PATH = `${FileSystem.documentDirectory}${DICT_FILENAME}`;
const DICT_META_PATH = `${DICT_PATH}.meta.json`;

function isCorruptionError(e: unknown): boolean {
    const msg = String((e as any)?.message ?? e);
    return /malformed|not a database|disk image|file is encrypted/i.test(msg);
}

/** Registered once from _layout.tsx; lets the app react (redirect to onboarding, offer re-download) without db/open.ts depending on navigation or the app store. */
let onDictionaryCorrupted: (() => void) | null = null;
export function setOnDictionaryCorrupted(cb: (() => void) | null): void {
    onDictionaryCorrupted = cb;
}

function wrap(db: SQLite.SQLiteDatabase): DbLike {
    return {
        getAllAsync: (sql, ...p) => db.getAllAsync(sql, ...(p as any)),
        getFirstAsync: (sql, ...p) => db.getFirstAsync(sql, ...(p as any)),
        runAsync: async (sql, ...p) => {
            const r = await db.runAsync(sql, ...(p as any));
            return { changes: r.changes };
        },
        execAsync: (sql) => db.execAsync(sql),
        closeAsync: () => db.closeAsync(),
    };
}

/** Wraps the dictionary connection so a corrupted-file error is reported once instead of just rejecting the caller. */
function wrapDictionary(db: SQLite.SQLiteDatabase): DbLike {
    const base = wrap(db);
    const guard = <A extends any[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
        try {
            return await fn(...a);
        } catch (e) {
            if (isCorruptionError(e)) onDictionaryCorrupted?.();
            throw e;
        }
    };
    return {
        getAllAsync: guard(base.getAllAsync),
        getFirstAsync: guard(base.getFirstAsync),
        runAsync: guard(base.runAsync),
        execAsync: guard(base.execAsync),
        closeAsync: base.closeAsync,
    };
}

interface GlobalDbCache {
    __minotaraDictDbPromise?: Promise<DbLike> | null;
    __minotaraUserDbPromise?: Promise<DbLike> | null;
}
const globalCache = globalThis as unknown as GlobalDbCache;

/** Cheap readiness check: file exists, isn't a stub, and (when we have a recorded fingerprint) hasn't changed size since the last verified download. */
export async function dictionaryReady(): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(DICT_PATH);
    if (!info.exists || (info.size ?? 0) <= 1024) return false;
    try {
        const metaRaw = await FileSystem.readAsStringAsync(DICT_META_PATH);
        const meta = JSON.parse(metaRaw) as { size: number };
        return meta.size === info.size;
    } catch {
        // No fingerprint recorded yet (e.g. app updated from a build predating this check) — fall back to the size-only check rather than force a re-download.
        return true;
    }
}

/** Call once right after a download passes `integrityCheckDictionary()`, so future launches can cheaply detect a truncated/overwritten file without re-running a full integrity check. */
export async function recordDictionaryMeta(): Promise<void> {
    const info = await FileSystem.getInfoAsync(DICT_PATH);
    if (!info.exists) return;
    await FileSystem.writeAsStringAsync(DICT_META_PATH, JSON.stringify({ size: info.size, recordedAt: new Date().toISOString() }));
}

export function openDictionary(): Promise<DbLike> {
    if (!globalCache.__minotaraDictDbPromise) {
        globalCache.__minotaraDictDbPromise = (async () => {
            const db = await SQLite.openDatabaseAsync(DICT_FILENAME, undefined, FileSystem.documentDirectory!);
            await db.execAsync('PRAGMA journal_mode = WAL');
            await db.execAsync('PRAGMA query_only = ON'); // read-only by contract
            return wrapDictionary(db);
        })().catch((e) => {
            globalCache.__minotaraDictDbPromise = null;
            throw e;
        });
    }
    return globalCache.__minotaraDictDbPromise;
}

export function openUser(): Promise<DbLike> {
    if (!globalCache.__minotaraUserDbPromise) {
        globalCache.__minotaraUserDbPromise = (async () => {
            const db = await SQLite.openDatabaseAsync('user.db');
            await db.execAsync('PRAGMA journal_mode = WAL');
            const wrapped = wrap(db);
            await migrateUserDb(wrapped);
            return wrapped;
        })().catch((e) => {
            globalCache.__minotaraUserDbPromise = null;
            throw e;
        });
    }
    return globalCache.__minotaraUserDbPromise;
}

/** SCR-00: verify the downloaded file before marking the dictionary ready. */
export async function integrityCheckDictionary(): Promise<boolean> {
    try {
        const db = await SQLite.openDatabaseAsync(DICT_FILENAME, undefined,
            FileSystem.documentDirectory!);
        const row = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
        await db.closeAsync();
        return (row?.integrity_check ?? '').toLowerCase() === 'ok';
    } catch {
        return false;
    }
}

export async function removeDictionaryFile(): Promise<void> {
    if (globalCache.__minotaraDictDbPromise) {
        await globalCache.__minotaraDictDbPromise.then((db) => db.closeAsync()).catch(() => {});
        globalCache.__minotaraDictDbPromise = null;
    }
    // Phải xoá cả -wal và -shm, không chỉ file .db. Cả hai chạy WAL nên SQLite
    // để lại hai file này bên cạnh; xoá .db mà bỏ sót chúng thì lần mở tiếp
    // theo SQLite thấy một WAL trỏ vào file nó không nhận ra và chết bằng
    // "file is not a database" — tức là tải lại từ điển xong vẫn hỏng, đúng
    // tình huống mà hàm này tồn tại để cứu.
    for (const p of [DICT_PATH, `${DICT_PATH}-wal`, `${DICT_PATH}-shm`, DICT_META_PATH]) {
        await FileSystem.deleteAsync(p, { idempotent: true });
    }
}

export async function dictMeta(db: DbLike): Promise<string | null> {
    let built: { value: string } | null = null;
    try {
        built = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM app_meta WHERE key = 'built_at'");
    } catch (e) {
        if (__DEV__) console.warn('[dictMeta] app_meta lookup failed — oxford-app.db may predate scripts/build-app-db.js:', e);
    }
    if (built?.value) return built.value.slice(0, 10);

    try {
        const crawl = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM crawl_meta LIMIT 1');
        if (!crawl) return null;
        const v = crawl.version ?? crawl.value ?? crawl.finished_at ?? crawl.built_at;
        return v != null ? String(v) : null;
    } catch (e) {
        if (__DEV__) console.warn('[dictMeta] crawl_meta lookup failed — oxford-app.db may predate scripts/build-app-db.js:', e);
        return null;
    }
}
