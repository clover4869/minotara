import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { DbLike } from '../src/db/types';
import {
    assembleChoices, isUsableDefinition, pickDistractorDefinitions, buildQuizQuestion,
    CHOICE_COUNT, type QuizSource,
} from '../src/services/quiz';

function wrap(db: Database.Database): DbLike {
    return {
        getAllAsync: async (sql, ...p) => db.prepare(sql).all(...p) as any[],
        getFirstAsync: async (sql, ...p) => (db.prepare(sql).get(...p) ?? null) as any,
        runAsync: async (sql, ...p) => ({ changes: db.prepare(sql).run(...p).changes }),
        execAsync: async (sql) => { db.exec(sql); },
        closeAsync: async () => { db.close(); },
    };
}

/** rng tất định: phát lần lượt các giá trị cho trước rồi lặp lại. */
const seq = (...vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
};

describe('assembleChoices', () => {
    const CORRECT = 'a round fruit with shiny red or green skin';
    const D = [
        'a large animal with a long trunk and tusks',
        'a game played on ice with heavy flat stones',
        'a piece of furniture for one person to sit on',
        'a long narrow boat used on rivers and canals',
    ];

    it('cho đúng 4 đáp án, trong đó đúng một đáp án đúng', () => {
        const c = assembleChoices(CORRECT, D, seq(0.5));
        expect(c).toHaveLength(CHOICE_COUNT);
        expect(c.filter((x) => x.correct)).toHaveLength(1);
        expect(c.find((x) => x.correct)!.text).toBe(CORRECT);
    });

    it('có xáo thứ tự — đáp án đúng không luôn nằm ở vị trí đầu', () => {
        // rng trả 0 liên tục: Fisher-Yates đẩy phần tử cuối về đầu mỗi vòng,
        // nên đáp án đúng (dựng ở index 0) chắc chắn bị dời đi.
        const c = assembleChoices(CORRECT, D, seq(0));
        expect(c[0].correct).toBe(false);
    });

    it('loại mồi nhử trùng nội dung với đáp án đúng, kể cả khác hoa thường/dấu câu', () => {
        const c = assembleChoices(CORRECT, ['A ROUND FRUIT, WITH SHINY RED OR GREEN SKIN!', ...D]);
        expect(c.filter((x) => x.correct)).toHaveLength(1);
        const texts = c.map((x) => x.text.toLowerCase().replace(/[^a-z ]/g, '').trim());
        expect(new Set(texts).size).toBe(texts.length); // không có hai đáp án cùng nội dung
    });

    it('loại mồi nhử trùng nhau', () => {
        const dup = ['a large animal with a long trunk', 'a large animal with a long trunk.'];
        const c = assembleChoices(CORRECT, dup);
        expect(c).toHaveLength(2); // 1 đúng + 1 mồi nhử sau khi gộp trùng
    });

    /**
     * Màn làm bài không có nút thoát. Một câu dựng hụt mà ném lỗi thì người
     * dùng kẹt lại với chuông đang kêu — phải trả về ít đáp án chứ không vỡ.
     */
    it('thiếu mồi nhử vẫn trả về câu hỏi trả lời được, không ném lỗi', () => {
        expect(assembleChoices(CORRECT, [])).toHaveLength(1);
        expect(assembleChoices(CORRECT, [])[0].correct).toBe(true);
        expect(assembleChoices(CORRECT, [D[0]])).toHaveLength(2);
    });

    it('key của mỗi đáp án là duy nhất', () => {
        const c = assembleChoices(CORRECT, D);
        expect(new Set(c.map((x) => x.key)).size).toBe(c.length);
    });
});

describe('isUsableDefinition', () => {
    it('loại nghĩa quá ngắn — bốn cái "a bird" không phân biệt được', () => {
        expect(isUsableDefinition('a bird')).toBe(false);
    });
    it('loại nghĩa quá dài — 7 giờ sáng không ai đọc hết bốn đoạn văn', () => {
        expect(isUsableDefinition('x'.repeat(200))).toBe(false);
    });
    it('nhận nghĩa dài vừa phải', () => {
        expect(isUsableDefinition('a round fruit with shiny red skin')).toBe(true);
    });
    it('null/rỗng thì loại', () => {
        expect(isUsableDefinition(null)).toBe(false);
        expect(isUsableDefinition('')).toBe(false);
    });
});

describe('pickDistractorDefinitions', () => {
    function makeDict(n = 60): DbLike {
        const db = new Database(':memory:');
        db.exec(`CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, pos TEXT, data TEXT);`);
        const ins = db.prepare('INSERT INTO entries (id, headword, pos, data) VALUES (?,?,?,?)');
        for (let i = 1; i <= n; i++) {
            ins.run(i, `w${i}`, i % 2 ? 'noun' : 'verb', JSON.stringify({
                senses: [{ definition: `nghia so ${i} du dai de dung lam moi nhu` }],
            }));
        }
        // mục không có nghĩa dùng được — phải bị bỏ qua chứ không làm hụt kết quả
        ins.run(n + 1, 'stub', 'noun', JSON.stringify({ senses: [] }));
        ins.run(n + 2, 'tiny', 'noun', JSON.stringify({ senses: [{ definition: 'a bird' }] }));
        return wrap(db);
    }

    it('lấy đủ số lượng, không trùng nhau, không dính chính từ đang hỏi', async () => {
        const d = await pickDistractorDefinitions(makeDict(), { excludeEntryId: 7, pos: null, count: 3 });
        expect(d).toHaveLength(3);
        expect(new Set(d).size).toBe(3);
        expect(d).not.toContain('nghia so 7 du dai de dung lam moi nhu');
    });

    it('lọc theo từ loại để mồi nhử không bị loại trừ chỉ nhờ nhìn lướt', async () => {
        const dict = makeDict();
        // id lẻ = noun trong fixture; lấy pos='noun' thì mọi nghĩa trả về phải là số lẻ
        const d = await pickDistractorDefinitions(dict, { excludeEntryId: 1, pos: 'noun', count: 3 });
        expect(d.length).toBeGreaterThan(0);
        for (const t of d) {
            const n = Number(/nghia so (\d+)/.exec(t)![1]);
            expect(n % 2).toBe(1);
        }
    });

    it('bỏ qua mục không có nghĩa và mục nghĩa quá ngắn', async () => {
        const d = await pickDistractorDefinitions(makeDict(), { excludeEntryId: 0, pos: null, count: 5 });
        expect(d).not.toContain('a bird');
        expect(d.every((x) => x.length >= 12)).toBe(true);
    });

    /** Từ điển rỗng/hỏng không được làm treo vòng lặp. */
    it('từ điển rỗng thì trả về mảng rỗng chứ không quay vô hạn', async () => {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, pos TEXT, data TEXT);');
        expect(await pickDistractorDefinitions(wrap(db), { excludeEntryId: 1, pos: null, count: 3 })).toEqual([]);
    });

    /**
     * Từ loại hiếm cạn mồi nhử thì hạ yêu cầu, lấy sang từ loại khác cho đủ.
     * Câu hỏi 2 đáp án là đoán bừa trúng 50%, mà đây là điều kiện tắt chuông.
     */
    it('từ loại hiếm cạn mồi nhử thì lấy bù từ loại khác cho đủ', async () => {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, pos TEXT, data TEXT);');
        const ins = db.prepare('INSERT INTO entries (id, headword, pos, data) VALUES (?,?,?,?)');
        for (let i = 1; i <= 30; i++) {
            ins.run(i, `w${i}`, 'noun', JSON.stringify({ senses: [{ definition: `nghia so ${i} du dai roi day` }] }));
        }
        ins.run(31, 'only', 'determiner', JSON.stringify({ senses: [{ definition: 'nghia xac dinh duy nhat' }] }));
        const d = await pickDistractorDefinitions(wrap(db), { excludeEntryId: 99, pos: 'determiner', count: 3 });
        expect(d).toHaveLength(3);
        expect(d).toContain('nghia xac dinh duy nhat'); // vẫn ưu tiên đúng từ loại trước
    });
});

describe('buildQuizQuestion', () => {
    function dictOf(n = 60): DbLike {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, pos TEXT, data TEXT);');
        const ins = db.prepare('INSERT INTO entries (id, headword, pos, data) VALUES (?,?,?,?)');
        for (let i = 1; i <= n; i++) {
            ins.run(i, `w${i}`, 'noun', JSON.stringify({
                senses: [{ definition: `nghia tu dien so ${i} du dai de dung` }],
            }));
        }
        return wrap(db);
    }

    const src = (over: Partial<QuizSource> = {}): QuizSource => ({
        entry_id: 999,
        headword: 'apple',
        pos: 'noun',
        ipa: '/ˈæpl/',
        audio: 'https://a/x.mp3',
        dictSenses: ['a round fruit with shiny red or green skin'],
        definition: 'a round fruit with shiny red or green skin',
        ...over,
    });

    it('ra 4 đáp án với đúng một đáp án đúng, mang theo từ/ipa/audio', async () => {
        const q = await buildQuizQuestion(dictOf(), src());
        expect(q.choices).toHaveLength(CHOICE_COUNT);
        expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
        expect(q.headword).toBe('apple');
        expect(q.audio).toBe('https://a/x.mp3');
        expect(q.entry_id).toBe(999);
    });

    /**
     * Đây là lý do QuizSource mang `dictSenses` chứ không mang `definition`:
     * người dùng tự viết nghĩa tiếng Việt thì đáp án đúng là câu tiếng Việt
     * đứng giữa ba định nghĩa tiếng Anh — lộ đáp án chỉ vì khác ngôn ngữ,
     * không cần nhớ gì cũng chọn trúng.
     */
    it('KHÔNG bao giờ lấy nghĩa tiếng Việt người dùng tự viết làm đáp án', async () => {
        const q = await buildQuizQuestion(dictOf(), src({
            definition: 'quả táo — nghĩa tôi tự ghi',
            dictSenses: ['a round fruit with shiny red or green skin'],
        }));
        const right = q.choices.find((c) => c.correct)!;
        expect(right.text).toBe('a round fruit with shiny red or green skin');
        expect(q.choices.every((c) => !c.text.includes('tôi tự ghi'))).toBe(true);
    });

    it('bốc ngẫu nhiên trong các nghĩa tiếng Anh — từ nhiều nghĩa không lặp mãi nghĩa đầu', async () => {
        const many = src({
            dictSenses: [
                'nghia thu nhat du dai de dung lam dap an',
                'nghia thu hai du dai de dung lam dap an',
                'nghia thu ba du dai de dung lam dap an',
            ],
        });
        const seen = new Set<string>();
        for (let i = 0; i < 25; i++) {
            const q = await buildQuizQuestion(dictOf(), many);
            seen.add(q.choices.find((c) => c.correct)!.text);
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    it('bỏ qua nghĩa quá ngắn/dài khi chọn đáp án đúng', async () => {
        const q = await buildQuizQuestion(dictOf(), src({
            dictSenses: ['a bird', 'x'.repeat(300), 'nghia duy nhat dung duoc o day'],
        }));
        expect(q.choices.find((c) => c.correct)!.text).toBe('nghia duy nhat dung duoc o day');
    });

    it('ưu tiên mồi nhử từ các thẻ cùng phiên, chỉ bù từ từ điển khi thiếu', async () => {
        const pool = [
            'nghia cua the cung phien so mot',
            'nghia cua the cung phien so hai',
            'nghia cua the cung phien so ba',
        ];
        const q = await buildQuizQuestion(dictOf(), src(), { sessionPool: pool });
        const wrong = q.choices.filter((c) => !c.correct).map((c) => c.text);
        expect(wrong).toHaveLength(3);
        // đủ 3 mồi nhử từ phiên thì không cần đụng tới từ điển
        expect(wrong.every((t) => pool.includes(t))).toBe(true);
    });

    it('phiên chỉ có 1 thẻ khác thì bù từ từ điển cho đủ 4 đáp án', async () => {
        const q = await buildQuizQuestion(dictOf(), src(), {
            sessionPool: ['nghia cua the cung phien duy nhat'],
        });
        expect(q.choices).toHaveLength(CHOICE_COUNT);
        const wrong = q.choices.filter((c) => !c.correct).map((c) => c.text);
        expect(wrong).toContain('nghia cua the cung phien duy nhat');
        expect(wrong.some((t) => t.startsWith('nghia tu dien'))).toBe(true);
    });

    it('bỏ qua mục trong phiên có nghĩa không dùng được', async () => {
        const q = await buildQuizQuestion(dictOf(), src(), { sessionPool: ['a bird', ''] });
        expect(q.choices).toHaveLength(CHOICE_COUNT);
        expect(q.choices.every((c) => c.text !== 'a bird')).toBe(true);
    });

    /** Từ điển rỗng + phiên rỗng: vẫn phải ra câu trả lời được, không ném lỗi. */
    it('không có mồi nhử nào thì vẫn ra câu hỏi, không ném lỗi', async () => {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, pos TEXT, data TEXT);');
        const q = await buildQuizQuestion(wrap(db), src());
        expect(q.choices).toHaveLength(1);
        expect(q.choices[0].correct).toBe(true);
    });
});
