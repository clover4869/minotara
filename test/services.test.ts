import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import type { DbLike } from '../src/db/types';
import { lookup, suggest, normalizeQuery, initialEntryIndex, formsOfEntry, groupFormOf } from '../src/services/lookup';
import { parseImportText, shouldSuggestTemplate } from '../src/services/import-parser';
import { matchImport } from '../src/services/import-matcher';
import { grade, buildSession, buildAheadSession, dueBoxCounts, SessionQueue, nextBox, maskHeadword, type SrsState } from '../src/services/srs';
import { migrateUserDb, saveWord, savedStats, getSetting, setSetting, nextDueAt } from '../src/db/user';
import { getViMeanings, meaningsForPos, meaningsOtherPos, normalizeViPos } from '../src/services/vi-meaning';

/** better-sqlite3 wrapped to look like expo-sqlite's async API. */
function wrap(db: Database.Database): DbLike {
    return {
        getAllAsync: async (sql, ...p) => db.prepare(sql).all(...p) as any[],
        getFirstAsync: async (sql, ...p) => (db.prepare(sql).get(...p) ?? null) as any,
        runAsync: async (sql, ...p) => ({ changes: db.prepare(sql).run(...p).changes }),
        execAsync: async (sql) => { db.exec(sql); },
        closeAsync: async () => { db.close(); },
    };
}

// ---- dictionary fixture matching the real oxford-app.db schema ----
function makeDict(): DbLike {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE entries (id INTEGER PRIMARY KEY, word_id INTEGER, url TEXT,
        headword TEXT, pos TEXT, cefr TEXT, data TEXT);
    CREATE TABLE forms (id INTEGER PRIMARY KEY, form TEXT, form_type TEXT,
        ipa_uk TEXT, ipa_us TEXT, audio_uk TEXT, audio_us TEXT, audio_any TEXT,
        lemma TEXT, lemma_pos TEXT, tags TEXT, entry_id INTEGER, word_id INTEGER, source TEXT);
    CREATE TABLE form_type_label (form_type TEXT PRIMARY KEY, en TEXT, vi TEXT, sort INTEGER);
    CREATE TABLE search_index (term TEXT, kind TEXT, entry_id INTEGER, display TEXT, sub TEXT);
    INSERT INTO form_type_label VALUES
      ('present_3sg','third person singular','ngôi 3 số ít',2),
      ('present_participle','present participle','hiện tại phân từ (V-ing)',3),
      ('past','past tense','quá khứ (V2)',4),
      ('past_participle','past participle','quá khứ phân từ (V3)',5),
      ('plural','plural','số nhiều',6),
      ('other','form','biến thể',9);
    `);
    const data = (word: string, pos: string, sense: string) => JSON.stringify({
        word, pos, cefr: 'B1',
        pronunciations: { uk: { phon: '/x/', audio_mp3: 'https://ox/a.mp3' }, us: { phon: '/x/', audio_mp3: null } },
        senses: [{ definition: sense, cefr: null, guideword: null, grammar: null, labels: null, examples: [], synonyms: [], xrefs: [] }],
        idioms: [], phrasal_verbs: [], word_origin: null,
    });
    const ie = db.prepare('INSERT INTO entries (id, headword, pos, cefr, data) VALUES (?,?,?,?,?)');
    ie.run(1, 'run', 'verb', 'A1', data('run', 'verb', 'move fast'));
    ie.run(2, 'run', 'noun', 'A2', data('run', 'noun', 'an act of running'));
    ie.run(3, 'running', 'noun', 'B1', data('running', 'noun', 'the sport'));
    ie.run(4, 'walk', 'verb', 'A1', data('walk', 'verb', 'move on foot'));
    ie.run(5, 'read', 'verb', 'A1', data('read', 'verb', 'look and comprehend'));
    ie.run(6, 'sheep', 'noun', 'A2', data('sheep', 'noun', 'woolly animal'));
    ie.run(7, 'foo', 'verb', 'A1', data('foo', 'verb', 'placeholder verb'));

    const inf = db.prepare(`INSERT INTO forms (form, form_type, ipa_uk, ipa_us, lemma, lemma_pos, entry_id, source)
        VALUES (?,?,?,?,?,?,?,'test')`);
    inf.run('running', 'present_participle', '/ˈrʌnɪŋ/', '/ˈrʌnɪŋ/', 'run', 'verb', 1);
    inf.run('ran', 'past', '/ræn/', '/ræn/', 'run', 'verb', 1);
    inf.run('run', 'past_participle', '/rʌn/', '/rʌn/', 'run', 'verb', 1);
    inf.run('walked', 'past', '/wɔːkt/', '/wɔːkt/', 'walk', 'verb', 4);
    inf.run('walked', 'past_participle', '/wɔːkt/', '/wɔːkt/', 'walk', 'verb', 4);
    inf.run('read', 'past', '/red/', '/red/', 'read', 'verb', 5);
    inf.run('read', 'past_participle', '/red/', '/red/', 'read', 'verb', 5);
    inf.run('sheep', 'plural', '/ʃiːp/', '/ʃiːp/', 'sheep', 'noun', 6);
    inf.run('runner', 'other', null, null, 'run', 'verb', 1); // derivation — must be hidden
    inf.run('foobar', 'weird_new_type', '/x/', '/x/', 'foo', 'verb', 7); // form_type with no form_type_label row yet

    const si = db.prepare('INSERT INTO search_index VALUES (?,?,?,?,?)');
    si.run('run', 'headword', 1, 'run', 'verb');
    si.run('run', 'headword', 2, 'run', 'noun');
    si.run('running', 'headword', 3, 'running', 'noun');
    si.run('walk', 'headword', 4, 'walk', 'verb');
    si.run('walked', 'form', 4, 'walked', 'past tense of walk');
    si.run('ran', 'form', 1, 'ran', 'past tense of run');
    si.run('read', 'headword', 5, 'read', 'verb');
    si.run('sheep', 'headword', 6, 'sheep', 'noun');
    return wrap(db);
}

function makeUser(): Promise<DbLike> {
    const u = wrap(new Database(':memory:'));
    return migrateUserDb(u).then(() => u);
}

let dict: DbLike;
beforeAll(() => { dict = makeDict(); });

// ================================================================ lookup
describe('lookup — 4 cases of SCR-02', () => {
    it('entry only (abandon-class)', async () => {
        const r = await lookup(dict, 'walk');
        expect(r.kind).toBe('entry');
        expect(r.entries).toHaveLength(1);
    });
    it('entry+form: running has own entry AND is V-ing of run', async () => {
        const r = await lookup(dict, 'Running ');
        expect(r.kind).toBe('entry+form');
        expect(r.entries[0].headword).toBe('running');
        expect(r.formOf[0].lemma).toBe('run');
        expect(r.formOf[0].label_vi).toContain('V-ing');
    });
    it('form-only: walked returns V2 AND V3, ordered by sort', async () => {
        const r = await lookup(dict, 'walked');
        expect(r.kind).toBe('form-only');
        expect(r.formOf.map((f) => f.form_type)).toEqual(['past', 'past_participle']);
    });
    it('read heteronym: two rows, both /red/, entry also present', async () => {
        const r = await lookup(dict, 'read');
        expect(r.kind).toBe('entry+form');
        expect(r.formOf).toHaveLength(2);
        expect(r.formOf.every((f) => f.ipa_uk === '/red/')).toBe(true);
    });
    it('sheep: form == lemma survives', async () => {
        const r = await lookup(dict, 'sheep');
        expect(r.formOf).toHaveLength(1);
        expect(r.formOf[0].form_type).toBe('plural');
    });
    it("form_type='other' never surfaces", async () => {
        const r = await lookup(dict, 'runner');
        expect(r.kind).toBe('miss');
        const table = await formsOfEntry(dict, 1);
        expect(table.some((f) => f.form_type === 'other')).toBe(false);
    });
    it('formsOfEntry keeps a row even when form_type_label has no entry for it (LEFT JOIN, not INNER)', async () => {
        const table = await formsOfEntry(dict, 7);
        const row = table.find((f) => f.form === 'foobar');
        expect(row).toBeTruthy();
        expect(row!.label_vi).toBeNull();
    });
    it('homograph tab: arriving via form opens the verb tab', async () => {
        const r = await lookup(dict, 'run');
        expect(r.entries).toHaveLength(2);
        expect(initialEntryIndex(r.entries, r.formOf)).toBe(
            r.entries.findIndex((e) => e.pos === 'verb'));
    });
    it('normalize: smart apostrophe + case + spaces', () => {
        expect(normalizeQuery("  Don\u2019t  ")).toBe("don't");
    });
});

describe('suggest', () => {
    it('prefix match, headwords first, forms carry sub-line', async () => {
        const rows = await suggest(dict, 'wal');
        expect(rows[0].kind).toBe('headword');
        const form = rows.find((r) => r.kind === 'form');
        expect(form?.sub).toBe('past tense of walk');
    });
    it('falls back to contains when prefix misses', async () => {
        const rows = await suggest(dict, 'unning');
        expect(rows.some((r) => r.display === 'running')).toBe(true);
    });
});

// ================================================================ import
describe('import parser', () => {
    it('word / word,meaning / word<TAB>meaning; first-separator split', () => {
        const { items } = parseImportText(
            'ubiquitous\nmeticulous, tỉ mỉ, kỹ càng\nran\tchạy (quá khứ)\n\nword,meaning\n');
        expect(items).toHaveLength(3);
        expect(items[1]).toEqual({ word: 'meticulous', meaning: 'tỉ mỉ, kỹ càng' });
        expect(items[2].meaning).toBe('chạy (quá khứ)');
    });
    it('dedupes, keeps first, adopts later meaning if first lacked it', () => {
        const { items, skipped } = parseImportText('run\nrun, chạy\n');
        expect(items).toHaveLength(1);
        expect(items[0].meaning).toBe('chạy');
        expect(skipped).toBe(1);
    });
    it('low-match rescue threshold', () => {
        expect(shouldSuggestTemplate(10, 4)).toBe(true);
        expect(shouldSuggestTemplate(10, 6)).toBe(false);
        expect(shouldSuggestTemplate(0, 0)).toBe(false);
    });
});

describe('import matcher', () => {
    it('resolves forms to lemma, flags already-saved, separates unmatched', async () => {
        const user = await makeUser();
        await saveWord(user, { entry_id: 4, headword: 'walk' });
        const { items } = parseImportText('ran, chạy\nwalked\nteh\n');
        const r = await matchImport(dict, user, items);
        expect(r.unmatched).toEqual(['teh']);
        const ran = r.matched.find((m) => m.inputWords.includes('ran'))!;
        expect(ran.headword).toBe('run');
        expect(ran.viaForm).toBe(true);
        expect(ran.meaning).toBe('chạy');
        expect(r.matched.find((m) => m.inputWords.includes('walked'))!.alreadySaved).toBe(true);
    });

    it('two inputs resolving to the same entry are merged, not dropped', async () => {
        const user = await makeUser();
        const { items } = parseImportText('ran\nrun, chạy nhanh\n');
        const r = await matchImport(dict, user, items);
        expect(r.unmatched).toEqual([]);
        expect(r.matched).toHaveLength(1);
        expect(r.matched[0].entry_id).toBe(1);
        expect(r.matched[0].inputWords).toEqual(['ran', 'run']);
        expect(r.matched[0].viaForm).toBe(true); // "ran" resolved via a form
        expect(r.matched[0].meaning).toBe('chạy nhanh'); // adopted from "run" since "ran" had none
    });
});

// ================================================================ srs
describe('SRS scheduler', () => {
    const now = new Date('2026-08-20T10:00:00Z');
    const rngMid = () => 0.5; // fuzz factor exactly 1.0
    const base = (over: Partial<SrsState>): SrsState =>
        ({ entry_id: 1, box: 1, due_at: '2026-08-20T00:00:00Z', streak: 0, last_result: 1, ...over });

    it('box transitions match the spec table', () => {
        expect(nextBox(1, true)).toBe(2);
        expect(nextBox(5, true)).toBe(5);
        expect(nextBox(3, false)).toBe(1);
        expect(nextBox(4, false)).toBe(2);
        expect(nextBox(5, false)).toBe(2);
    });
    it('grade sets due_at = interval (fuzz=1 at rng .5) and updates streak', () => {
        const g = grade(base({ box: 2, streak: 3 }), true, now, rngMid);
        expect(g.box).toBe(3);
        expect(g.due_at).toBe(new Date(now.getTime() + 4 * 86400000).toISOString());
        expect(g.streak).toBe(4);
    });
    it('fuzz stays within ±15%', () => {
        const lo = grade(base({}), true, now, () => 0);
        const hi = grade(base({}), true, now, () => 0.999999);
        const days = (s: SrsState) => (new Date(s.due_at).getTime() - now.getTime()) / 86400000;
        expect(days(lo)).toBeCloseTo(2 * 0.85, 5);
        expect(days(hi)).toBeGreaterThan(2 * 1.14);
    });
    it('buildSession: due low-box first, new capped at 20, ceiling 40', () => {
        const cards: SrsState[] = [];
        for (let i = 0; i < 30; i++) cards.push(base({ entry_id: i, box: (i % 3) + 1, due_at: '2026-08-19T00:00:00Z' }));
        for (let i = 100; i < 130; i++) cards.push(base({ entry_id: i, last_result: null }));
        const s = buildSession(cards, now);
        expect(s).toHaveLength(40);
        expect(s.filter((c) => c.last_result === null)).toHaveLength(10); // 30 due + 10 new = 40
        expect(s[0].box).toBe(1);
    });
    it('learning steps: new card graduates only after 2 in-session corrects', () => {
        const q = new SessionQueue([base({ entry_id: 7, last_result: null })], now, rngMid);
        q.answer(true);
        expect(q.done).toBe(false);
        expect(q.graded).toHaveLength(0);
        q.answer(true);
        expect(q.done).toBe(true);
        expect(q.graded[0].box).toBe(2);
    });
    it('wrong answer resets the in-session counter', () => {
        const q = new SessionQueue([base({ entry_id: 7, last_result: null })], now, rngMid);
        q.answer(true); q.answer(false); q.answer(true);
        expect(q.done).toBe(false); // counter was reset — needs 2 again
        q.answer(true);
        expect(q.done).toBe(true);
    });
    it('reviewed card answered wrong: graded ONCE, reinforcement pass grade-free', () => {
        const q = new SessionQueue([base({ entry_id: 9, box: 3 })], now, rngMid);
        q.answer(false);
        expect(q.graded).toHaveLength(1);
        expect(q.graded[0].box).toBe(1);
        expect(q.done).toBe(false);   // requeued for reinforcement
        q.answer(true);
        expect(q.graded).toHaveLength(1); // still exactly one grade
        expect(q.missed.has(9)).toBe(true);
    });
    it('escape hatch: 4 misses on a new card grades it wrong and moves on', () => {
        const q = new SessionQueue([base({ entry_id: 5, last_result: null })], now, rngMid);
        for (let i = 0; i < 4; i++) q.answer(false);
        expect(q.done).toBe(true);
        expect(q.graded[0].box).toBe(1);
        expect(q.graded[0].last_result).toBe(0);
    });
    it('remaining tracks distinct cards left, not attempts made — never lets progress exceed total', () => {
        const q = new SessionQueue([base({ entry_id: 7, last_result: null })], now, rngMid);
        expect(q.remaining).toBe(1);
        q.answer(true); // graduation needs 2 in-session corrects — card requeued
        expect(q.answered).toBe(1);
        expect(q.remaining).toBe(1); // still 1 distinct card left, not "done" yet
        q.answer(true);
        expect(q.answered).toBe(2); // more attempts than the single card in this session
        expect(q.remaining).toBe(0); // but remaining correctly reflects it's actually done
        expect(q.total - q.remaining).toBeLessThanOrEqual(q.total);
    });
    it('dueBoxCounts counts the true due backlog, uncapped by the 40/20 session limits, excluding new cards', () => {
        const cards: SrsState[] = [];
        for (let i = 0; i < 50; i++) cards.push(base({ entry_id: i, box: 1, due_at: '2026-08-19T00:00:00Z' }));
        for (let i = 100; i < 110; i++) cards.push(base({ entry_id: i, last_result: null })); // new, not due
        const counts = dueBoxCounts(cards, now);
        expect(counts[0]).toBe(50); // all 50 due box-1 cards counted, not capped at 40
        expect(counts.reduce((a, b) => a + b, 0)).toBe(50); // new cards excluded entirely
    });
});

// ================================================================ user db + vi
describe('user db', () => {
    it('re-saving never resets SRS but adopts a new meaning (B4)', async () => {
        const user = await makeUser();
        await saveWord(user, { entry_id: 1, headword: 'run' });
        await user.runAsync('UPDATE srs_state SET box = 4 WHERE entry_id = 1');
        await saveWord(user, { entry_id: 1, headword: 'run', user_meaning: 'chạy' });
        const s = await user.getFirstAsync<any>('SELECT box FROM srs_state WHERE entry_id = 1');
        expect(s.box).toBe(4);
        const w = await user.getFirstAsync<any>('SELECT user_meaning FROM saved_words WHERE entry_id = 1');
        expect(w.user_meaning).toBe('chạy');
    });
    it('settings defaults + roundtrip', async () => {
        const user = await makeUser();
        expect(await getSetting(user, 'pref_dialect')).toBe('uk');
        await setSetting(user, 'pref_dialect', 'us');
        expect(await getSetting(user, 'pref_dialect')).toBe('us');
    });
    it('nextDueAt reports how many cards share the next due date, not just the date', async () => {
        const user = await makeUser();
        await saveWord(user, { entry_id: 1, headword: 'run' });
        await saveWord(user, { entry_id: 2, headword: 'run' });
        await saveWord(user, { entry_id: 4, headword: 'walk' });
        await user.runAsync("UPDATE srs_state SET due_at = '2099-01-02T00:00:00.000Z' WHERE entry_id IN (1,2)");
        await user.runAsync("UPDATE srs_state SET due_at = '2099-01-05T00:00:00.000Z' WHERE entry_id = 4");
        const next = await nextDueAt(user);
        expect(next?.due_at).toBe('2099-01-02T00:00:00.000Z');
        expect(next?.count).toBe(2);
    });
});

describe('vi-meaning', () => {
    const apiJson = { exists: true, results: [{ lang_code: 'en', meanings: [
        { definition: 'Sự chạy.', definition_lang: 'vi', example: 'at a run', pos: 'Danh từ' },
        { definition: 'Chạy.', definition_lang: 'vi', example: null, pos: 'Động từ' },
    ] }] };
    it('fetches once then serves from cache; second call needs no network', async () => {
        const user = await makeUser();
        let calls = 0;
        const fakeFetch = (async () => { calls++; return { ok: true, json: async () => apiJson }; }) as any;
        const a = await getViMeanings(user, 'Run', fakeFetch);
        expect(a.meanings).toHaveLength(2);
        expect(a.fromCache).toBe(false);
        const b = await getViMeanings(user, 'run', () => { throw new Error('no network'); });
        expect(b.fromCache).toBe(true);
        expect(b.meanings).toHaveLength(2);
        expect(calls).toBe(1);
    });
    it('network failure → failed flag, no throw', async () => {
        const user = await makeUser();
        const r = await getViMeanings(user, 'walk', (() => { throw new Error('offline'); }) as any);
        expect(r.failed).toBe(true);
        expect(r.meanings).toEqual([]);
    });
    it('pos mapping + tab filter', () => {
        expect(normalizeViPos('Danh từ')).toBe('noun');
        const ms = [
            { definition: 'a', example: null, pos: 'noun' },
            { definition: 'b', example: null, pos: 'verb' },
            { definition: 'c', example: null, pos: null },
        ];
        const forNoun = meaningsForPos(ms as any, 'noun');
        expect(forNoun.map((m) => m.definition)).toEqual(['a', 'c']);
        expect(meaningsOtherPos(ms as any, 'noun').map((m) => m.definition)).toEqual(['b']);
    });
    it('a tab with zero matching-POS meanings shows only the unposed ones, never the other tab\'s meanings', () => {
        const ms = [
            { definition: 'noun-meaning', example: null, pos: 'noun' },
            { definition: 'verb-meaning', example: null, pos: 'verb' },
            { definition: 'unposed-meaning', example: null, pos: null },
        ];
        // no meaning is tagged 'adjective' — must NOT fall back to showing all of `ms`
        const forAdjective = meaningsForPos(ms as any, 'adjective');
        expect(forAdjective.map((m) => m.definition)).toEqual(['unposed-meaning']);
        // and those non-matching ones still show up under "Nghĩa khác", not duplicated in the main list
        expect(meaningsOtherPos(ms as any, 'adjective').map((m) => m.definition).sort())
            .toEqual(['noun-meaning', 'verb-meaning']);
    });
    it('retries once after a failed fetch', async () => {
        const user = await makeUser();
        let calls = 0;
        const fakeFetch = (async () => {
            calls++;
            if (calls === 1) throw new Error('timeout');
            return { ok: true, json: async () => apiJson };
        }) as any;
        const r = await getViMeanings(user, 'run', fakeFetch);
        expect(calls).toBe(2);
        expect(r.failed).toBe(false);
        expect(r.meanings).toHaveLength(2);
    });
});

describe('form-of grouping + mask', () => {
    it('walked V2+V3 with same IPA collapse to one row', async () => {
        const r = await lookup(dict, 'walked');
        const g = groupFormOf(r.formOf);
        expect(g).toHaveLength(1);
        expect(g[0].labels.length).toBe(2);
        expect(g[0].labels.join(' · ')).toContain('V2');
        expect(g[0].labels.join(' · ')).toContain('V3');
    });
    it('different IPA stay on separate rows', () => {
        const g = groupFormOf([
            { form: 'read', form_type: 'past', label_vi: 'V2', label_en: 'past', sort: 4,
                ipa_uk: '/red/', ipa_us: '/red/', audio_uk: null, audio_us: null,
                lemma: 'read', lemma_pos: 'verb', entry_id: 5, headword: 'read', pos: 'verb' },
            { form: 'read', form_type: 'infinitive', label_vi: 'V1', label_en: 'infinitive', sort: 1,
                ipa_uk: '/riːd/', ipa_us: '/riːd/', audio_uk: null, audio_us: null,
                lemma: 'read', lemma_pos: 'verb', entry_id: 5, headword: 'read', pos: 'verb' },
        ]);
        expect(g).toHaveLength(2);
    });
    it('masks headword in examples', () => {
        expect(maskHeadword('I can run fast', 'run')).toBe('I can ___ fast');
    });
});

describe('SRS extras', () => {
    it('buildAheadSession takes nearest future cards, skips new', () => {
        const now = new Date('2026-08-20T10:00:00Z');
        const cards: SrsState[] = [
            { entry_id: 1, box: 2, due_at: '2026-08-21T00:00:00Z', streak: 1, last_result: 1 },
            { entry_id: 2, box: 3, due_at: '2026-08-25T00:00:00Z', streak: 1, last_result: 1 },
            { entry_id: 3, box: 1, due_at: '2026-08-20T00:00:00Z', streak: 0, last_result: null },
        ];
        const ahead = buildAheadSession(cards, now, 1);
        expect(ahead).toHaveLength(1);
        expect(ahead[0].entry_id).toBe(1);
    });
});

describe('saved stats + import homographs', () => {
    it('new saved words count as due (due_at <= now)', async () => {
        const user = await makeUser();
        await saveWord(user, { entry_id: 1, headword: 'run' });
        const stats = await savedStats(user);
        expect(stats.total).toBe(1);
        expect(stats.due).toBe(1);
    });
    it('import exposes homograph alternatives for run', async () => {
        const user = await makeUser();
        const { items } = parseImportText('run\n');
        const r = await matchImport(dict, user, items);
        expect(r.matched[0].homographs.length).toBeGreaterThanOrEqual(2);
    });
});
