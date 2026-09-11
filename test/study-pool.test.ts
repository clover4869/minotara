import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DbLike } from '../src/db/types';
import { migrateUserDb, saveWord, setSetting } from '../src/db/user';
import { buildStudyPool, syntheticState, STUDY_LIMIT } from '../src/services/study-pool';
import type { SrsState } from '../src/services/srs';

function wrap(db: Database.Database): DbLike {
    return {
        getAllAsync: async (sql, ...p) => db.prepare(sql).all(...p) as any[],
        getFirstAsync: async (sql, ...p) => (db.prepare(sql).get(...p) ?? null) as any,
        runAsync: async (sql, ...p) => ({ changes: db.prepare(sql).run(...p).changes }),
        execAsync: async (sql) => { db.exec(sql); },
        closeAsync: async () => { db.close(); },
    };
}

/** Từ điển đủ để tầng "ngẫu nhiên" có hàng lấy. */
function makeDict(n = 80): DbLike {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, pos TEXT, cefr TEXT, data TEXT);');
    const ins = db.prepare('INSERT INTO entries (id, headword, pos, cefr, data) VALUES (?,?,?,?,?)');
    for (let i = 1; i <= n; i++) {
        ins.run(900 + i, `w${i}`, 'noun', 'B1', JSON.stringify({ senses: [{ definition: `nghia ${i} du dai de dung` }] }));
    }
    return wrap(db);
}

const NOW = new Date('2026-09-11T08:00:00.000Z');
const past = new Date(NOW.getTime() - 86400_000).toISOString();
const future = new Date(NOW.getTime() + 7 * 86400_000).toISOString();

const state = (entry_id: number, over: Partial<SrsState> = {}): SrsState => ({
    entry_id, box: 1, due_at: past, streak: 0, last_result: 1, ...over,
});

let user: DbLike;
let dict: DbLike;
beforeEach(async () => {
    user = wrap(new Database(':memory:'));
    await migrateUserDb(user);
    dict = makeDict();
});

async function addHistoryRow(entryId: number, at: string) {
    await user.runAsync('INSERT INTO history (query, entry_id, looked_at) VALUES (?,?,?)',
        `q${entryId}`, entryId, at);
}

describe('buildStudyPool — thứ tự bốn tầng', () => {
    it('tầng 1: thẻ đến hạn trong sổ được lấy trước hết', async () => {
        await saveWord(user, { entry_id: 11, headword: 'a' });
        await saveWord(user, { entry_id: 12, headword: 'b' });
        await addHistoryRow(77, past);
        const pool = await buildStudyPool(dict, user, [state(11), state(12)], { limit: 3, now: NOW });
        expect(pool.items.slice(0, 2).map((i) => i.entry_id).sort()).toEqual([11, 12]);
        expect(pool.counts.saved).toBe(2);
    });

    it('hết thẻ đến hạn thì xuống lịch sử — đây là lý do tính năng tồn tại', async () => {
        // chỉ có thẻ sắp đến hạn (không phải hôm nay) + một từ đã tra
        await addHistoryRow(77, past);
        const pool = await buildStudyPool(dict, user, [state(11, { due_at: future })], { limit: 2, now: NOW });
        expect(pool.items.map((i) => i.entry_id)).toContain(77);
        expect(pool.counts.history).toBe(1);
    });

    it('lịch sử lấy từ mới tra trước', async () => {
        await addHistoryRow(70, '2026-09-01T00:00:00.000Z');
        await addHistoryRow(71, '2026-09-10T00:00:00.000Z');
        const pool = await buildStudyPool(dict, user, [], { limit: 1, now: NOW });
        expect(pool.items[0].entry_id).toBe(71);
    });

    it('tầng 3: dùng đúng bộ "Từ hôm nay" đã ghim, không bốc lại', async () => {
        await setSetting(user, 'wotd_json', JSON.stringify([{ id: 501 }, { id: 502 }]));
        const pool = await buildStudyPool(dict, user, [], { limit: 2, now: NOW });
        expect(pool.items.map((i) => i.entry_id)).toEqual([501, 502]);
        expect(pool.counts.today).toBe(2);
    });

    it('tầng 4: cạn cả ba tầng trên thì lấy ngẫu nhiên từ từ điển', async () => {
        const pool = await buildStudyPool(dict, user, [], { limit: 5, now: NOW });
        expect(pool.items).toHaveLength(5);
        expect(pool.counts.random).toBe(5);
        expect(pool.items.every((i) => i.entry_id > 900)).toBe(true);
    });

    it('không bao giờ rỗng, kể cả khi chưa lưu từ nào và chưa tra gì', async () => {
        const pool = await buildStudyPool(dict, user, [], { now: NOW });
        expect(pool.items.length).toBeGreaterThan(0);
    });
});

describe('buildStudyPool — trần và trùng lặp', () => {
    it('tôn trọng trần số từ mỗi lượt', async () => {
        const pool = await buildStudyPool(dict, user, [], { limit: 7, now: NOW });
        expect(pool.items).toHaveLength(7);
    });

    it('trần mặc định là STUDY_LIMIT', async () => {
        const pool = await buildStudyPool(makeDict(200), user, [], { now: NOW });
        expect(pool.items).toHaveLength(STUDY_LIMIT);
    });

    /** Một từ vừa trong sổ vừa trong lịch sử không được hỏi hai lần. */
    it('không lấy trùng entry giữa các tầng', async () => {
        await saveWord(user, { entry_id: 11, headword: 'a' });
        await addHistoryRow(11, past);
        await setSetting(user, 'wotd_json', JSON.stringify([{ id: 11 }]));
        const pool = await buildStudyPool(dict, user, [state(11)], { limit: 10, now: NOW });
        const ids = pool.items.map((i) => i.entry_id);
        expect(ids.filter((x) => x === 11)).toHaveLength(1);
    });

    it('bỏ qua hàng lịch sử không có entry_id', async () => {
        await user.runAsync('INSERT INTO history (query, entry_id) VALUES (?, NULL)', 'gõ sai');
        const pool = await buildStudyPool(dict, user, [], { limit: 3, now: NOW });
        expect(pool.counts.history).toBe(0);
    });

    it('wotd_json hỏng thì bỏ qua tầng đó, không nổ', async () => {
        await setSetting(user, 'wotd_json', '{không-phải-json');
        const pool = await buildStudyPool(dict, user, [], { limit: 3, now: NOW });
        expect(pool.items).toHaveLength(3);
        expect(pool.counts.today).toBe(0);
    });
});

describe('chỉ tầng 1 được chấm điểm', () => {
    /**
     * Từ ngoài sổ không có hàng `srs_state`. `srs: null` là cách nói điều đó
     * ra thành mã, thay vì dựa vào việc persistGrades tự sửa 0 dòng.
     */
    it('từ trong sổ có srs, từ ngoài sổ thì null', async () => {
        await saveWord(user, { entry_id: 11, headword: 'a' });
        await addHistoryRow(77, past);
        const pool = await buildStudyPool(dict, user, [state(11)], { limit: 2, now: NOW });
        const saved = pool.items.find((i) => i.entry_id === 11);
        const hist = pool.items.find((i) => i.entry_id === 77);
        expect(saved?.srs).toBeTruthy();
        expect(hist?.srs).toBeNull();
    });
});

describe('syntheticState', () => {
    it('là thẻ MỚI, nên SessionQueue đòi đúng 2 lần trong phiên', () => {
        const s = syntheticState(42, NOW);
        expect(s.entry_id).toBe(42);
        expect(s.last_result).toBeNull();
    });
});
