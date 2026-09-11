import { describe, it, expect } from 'vitest';
import { prefetchTargetsFor } from '../src/services/image-prefetch';

describe('prefetchTargetsFor', () => {
    const senses = [
        { definition: 'to move or go somewhere with somebody' },
        { definition: 'to reach and hold something with your hand' },
    ];

    it('xếp nghĩa trước, idiom sau — đúng thứ tự gặp trên màn hình', () => {
        const t = prefetchTargetsFor('take', senses, [
            { idiom: 'take the biscuit', senses: [{ definition: 'to be the most surprising thing' }] },
        ]);
        expect(t.map((x) => x.word)).toEqual(['take', 'take', 'take the biscuit']);
        expect(t[2].text).toBe('to be the most surprising thing');
    });

    /**
     * `idioms[].idiom` là bản thân cụm từ, không phải định nghĩa. Tra bằng từ
     * gốc sẽ ra truy vấn "take take the biscuit" — nên idiom phải mang chính
     * cụm từ làm phần `word`.
     */
    it('idiom tra bằng chính cụm từ, không phải từ gốc', () => {
        const t = prefetchTargetsFor('take', [], [
            { idiom: 'take the biscuit', senses: [{ definition: 'to be the most surprising thing' }] },
        ]);
        expect(t).toHaveLength(1);
        expect(t[0].word).toBe('take the biscuit');
    });

    it('bỏ idiom không có nghĩa — không có gì để ghép vào truy vấn', () => {
        const t = prefetchTargetsFor('take', [], [
            { idiom: 'take five', senses: [] },
            { idiom: 'take ten', senses: [{ definition: null }] },
        ]);
        expect(t).toEqual([]);
    });

    it('lọc nghĩa trùng nhau, không xếp hàng hai lần cùng một truy vấn', () => {
        const t = prefetchTargetsFor('take', [
            { definition: 'to move something' },
            { definition: 'To Move Something' },
            { definition: 'to hold something' },
        ]);
        expect(t).toHaveLength(2);
    });

    it('bỏ nghĩa rỗng/null', () => {
        const t = prefetchTargetsFor('take', [
            { definition: null }, { definition: '   ' }, { definition: 'nghĩa thật' },
        ]);
        expect(t).toHaveLength(1);
        expect(t[0].text).toBe('nghĩa thật');
    });

    it('từ rỗng thì không sinh mục nào', () => {
        expect(prefetchTargetsFor('  ', senses)).toEqual([]);
    });

    it('mục từ chưa có nghĩa nào thì trả mảng rỗng, không nổ', () => {
        expect(prefetchTargetsFor('zebra', [])).toEqual([]);
    });
});
