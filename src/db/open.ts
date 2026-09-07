/**
 * The ONLY file that touches expo-sqlite directly. Swapping to op-sqlite
 * later means rewriting this file and nothing else.
 *
 * oxford-app.db is NOT bundled (300MB): SCR-00 downloads it into
 * documentDirectory. user.db is created on first run.
 */
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import type { DbLike } from './types';
import { migrateUserDb } from './user';

export const DICT_FILENAME = 'oxford-app.db';
export const DICT_PATH = `${FileSystem.documentDirectory}${DICT_FILENAME}`;

function wrap(db: SQLite.SQLiteDatabase): DbLike {
    return {
        getAllAsync: (sql, ...p) => db.getAllAsync(sql, ...(p as any)),
        getFirstAsync: (sql, ...p) => db.getFirstAsync(sql, ...(p as any)),
        runAsync: async (sql, ...p) => {
            const r = await db.runAsync(sql, ...(p as any));
            return { changes: r.changes };
        },
        execAsync: (sql) => db.execAsync(sql),
    };
}

let dictDb: DbLike | null = null;
let userDb: DbLike | null = null;

export async function dictionaryReady(): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(DICT_PATH);
    return info.exists && (info.size ?? 0) > 1024;
}

export async function openDictionary(): Promise<DbLike> {
    if (dictDb) return dictDb;
    const db = await SQLite.openDatabaseAsync(DICT_FILENAME, undefined,
        FileSystem.documentDirectory!);
    await db.execAsync('PRAGMA query_only = ON'); // read-only by contract
    dictDb = wrap(db);
    return dictDb;
}

export async function openUser(): Promise<DbLike> {
    if (userDb) return userDb;
    const db = await SQLite.openDatabaseAsync('user.db');
    userDb = wrap(db);
    await migrateUserDb(userDb);
    return userDb;
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
    dictDb = null;
    await FileSystem.deleteAsync(DICT_PATH, { idempotent: true });
}

export async function dictMeta(db: DbLike): Promise<string | null> {
    try {
        const built = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM app_meta WHERE key = 'built_at'");
        if (built?.value) return built.value.slice(0, 10);
        const crawl = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM crawl_meta LIMIT 1');
        if (!crawl) return null;
        const v = crawl.version ?? crawl.value ?? crawl.finished_at ?? crawl.built_at;
        return v != null ? String(v) : null;
    } catch {
        return null;
    }
}
