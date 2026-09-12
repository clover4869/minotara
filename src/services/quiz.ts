/**
 * Câu trắc nghiệm cho báo thức: một từ + ảnh + 4 nghĩa, chọn nghĩa đúng.
 *
 * Vì sao có kiểu bài này bên cạnh thẻ ôn tập bình thường: lúc 7 giờ sáng,
 * "chạm để lật rồi tự chấm" là thao tác bấm được trong lúc còn ngủ — tự chấm
 * "Đã nhớ" không chứng minh được gì. Chọn 1 trong 4 thì không qua mặt được:
 * sai là sai, và đó mới là thứ đáng dùng làm điều kiện tắt chuông.
 *
 * Mồi nhử lấy CÙNG từ loại với đáp án. Lấy bừa cả từ điển thì một danh từ cụ
 * thể nằm giữa ba định nghĩa động từ, loại trừ được mà chẳng cần đọc.
 */
import type { DbLike } from '../db/types';

export interface QuizChoice {
    /** Ổn định theo nội dung — React cần key không đổi khi mảng bị xáo. */
    key: string;
    text: string;
    correct: boolean;
}

export interface QuizQuestion {
    entry_id: number;
    headword: string;
    /** Từ loại, hiện ngay cạnh từ. */
    pos: string | null;
    ipa: string | null;
    audio: string | null;
    /** undefined = đang tải, [] = không có ảnh (vẫn làm bài được bằng chữ). */
    images?: string[];
    /**
     * Ví dụ của ĐÚNG nghĩa được chọn làm đáp án — không phải ví dụ của nghĩa
     * đầu. Đáp án bốc ngẫu nhiên trong các nghĩa, nên lấy ví dụ của nghĩa đầu
     * là minh hoạ cho một nghĩa khác của cùng từ: vừa không giúp gì, vừa đánh
     * lạc hướng đúng lúc người học đang cân nhắc.
     */
    examples: string[];
    choices: QuizChoice[];
}

/** Một nghĩa kèm ví dụ của chính nó. */
export interface DictSense {
    definition: string;
    examples: string[];
}

/** Số đáp án mong muốn. Thiếu mồi nhử thì ít hơn — xem assembleChoices. */
export const CHOICE_COUNT = 4;

/**
 * Nghĩa quá ngắn ("a bird") không phân biệt được với nhau, quá dài thì lúc
 * ngái ngủ không ai đọc hết bốn cái. Khoảng này giữ cho bốn lựa chọn nhìn
 * ngang nhau — chênh lệch độ dài tự nó đã là gợi ý đáp án.
 */
const MIN_DEF_LEN = 12;
const MAX_DEF_LEN = 160;

/** So khớp để loại trùng: bỏ hoa/thường, dấu câu, khoảng trắng thừa. */
function norm(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isUsableDefinition(d: string | null | undefined): d is string {
    if (!d) return false;
    const t = d.trim();
    return t.length >= MIN_DEF_LEN && t.length <= MAX_DEF_LEN;
}

/**
 * Ghép đáp án đúng với mồi nhử rồi xáo. Luôn có ĐÚNG MỘT đáp án đúng, kể cả
 * khi mồi nhử trùng nội dung với đáp án (bị loại) hoặc trùng nhau.
 *
 * Thiếu mồi nhử thì trả về ít hơn 4 chứ không ném lỗi: màn làm bài không có
 * lối thoát, nên một câu hỏi dựng hụt phải vẫn trả lời được — kẹt ở đó là
 * người dùng chỉ còn cách tắt nguồn máy.
 */
export function assembleChoices(
    correct: string,
    distractors: string[],
    rng: () => number = Math.random,
): QuizChoice[] {
    const seen = new Set([norm(correct)]);
    const picked: string[] = [];
    for (const d of distractors) {
        const n = norm(d);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        picked.push(d.trim());
        if (picked.length >= CHOICE_COUNT - 1) break;
    }
    const all: QuizChoice[] = [
        { key: `c:${norm(correct)}`, text: correct.trim(), correct: true },
        ...picked.map((t) => ({ key: `d:${norm(t)}`, text: t, correct: false })),
    ];
    // Fisher-Yates tại chỗ — cùng thuật toán với shuffle() trong srs.ts, chép
    // lại 4 dòng thay vì kéo import chéo giữa hai service không liên quan.
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
}

/**
 * Lấy nghĩa của những từ KHÁC để làm mồi nhử.
 *
 * Không dùng `ORDER BY RANDOM()`: nó quét sạch 68k dòng và phải đọc cột
 * `data` của từng dòng để trích nghĩa. Thay vào đó nhảy tới một id ngẫu
 * nhiên rồi đi tới — `id` là khoá chính nên mỗi lần nhảy là một lần seek.
 * Lấy dư rồi mới lọc, vì nhiều mục không có nghĩa dùng được.
 */
export async function pickDistractorDefinitions(
    dict: DbLike,
    opts: { excludeEntryId: number; pos: string | null; count: number },
    rng: () => number = Math.random,
): Promise<string[]> {
    const maxRow = await dict.getFirstAsync<{ m: number }>('SELECT MAX(id) AS m FROM entries');
    const maxId = maxRow?.m ?? 0;
    if (!maxId) return [];

    const out: string[] = [];
    const seen = new Set<string>();

    async function harvest(pos: string | null): Promise<void> {
        // Trần số lần thử: hết vòng mà chưa đủ thì thôi, không quay vô hạn khi
        // từ loại hiếm không có đủ mục hợp lệ để lấy.
        for (let attempt = 0; attempt < opts.count * 8 && out.length < opts.count; attempt++) {
            const from = 1 + Math.floor(rng() * maxId);
            const row = await dict.getFirstAsync<{ id: number; def: string | null }>(
                `SELECT id, json_extract(data, '$.senses[0].definition') AS def
                 FROM entries
                 WHERE id >= ? AND id != ?${pos ? ' AND pos = ?' : ''}
                 LIMIT 1`,
                ...(pos ? [from, opts.excludeEntryId, pos] : [from, opts.excludeEntryId]),
            );
            const def = row?.def;
            if (!isUsableDefinition(def)) continue;
            const n = norm(def);
            if (seen.has(n)) continue;
            seen.add(n);
            out.push(def.trim());
        }
    }

    await harvest(opts.pos);
    // Từ loại hiếm ("determiner" có 114 mục, "noun, adjective" có 167) không
    // gom đủ mồi nhử. Thà mồi nhử khác từ loại còn hơn câu hỏi chỉ 2 đáp án —
    // 2 đáp án là tỉ lệ đoán bừa 50%, mà đây đang là điều kiện tắt chuông.
    if (opts.pos && out.length < opts.count) await harvest(null);
    return out;
}

/** Vừa đủ để dựng một câu hỏi — nhận hình này thay vì cả CardContent để
 *  services/quiz.ts không phải phụ thuộc vào store. */
export interface QuizSource {
    entry_id: number;
    headword: string;
    pos: string | null;
    ipa: string | null;
    audio: string | null;
    /** Mọi nghĩa TIẾNG ANH của mục từ, kèm ví dụ riêng. Đáp án đúng bốc
     *  ngẫu nhiên từ đây, và ví dụ đi kèm chính nghĩa được bốc. */
    dictSenses: DictSense[];
    /** Dùng khi mục từ không có nghĩa tiếng Anh nào dùng được. */
    definition: string;
}

/**
 * Dựng một câu trắc nghiệm hoàn chỉnh.
 *
 * Đáp án đúng bốc NGẪU NHIÊN trong các nghĩa tiếng Anh của từ: một từ nhiều
 * nghĩa thì mỗi lần gặp lại được hỏi một nghĩa khác, thay vì học thuộc đúng
 * một câu. Chỉ lấy nghĩa tiếng Anh — nghĩa tiếng Việt người dùng tự viết mà
 * đứng cạnh ba định nghĩa tiếng Anh thì lộ đáp án chỉ vì khác ngôn ngữ.
 *
 * `sessionPool` là nghĩa của những thẻ KHÁC trong cùng phiên ôn. Ưu tiên lấy
 * ở đây trước khi bốc từ từ điển: phân biệt hai từ mình đang học lẫn nhau mới
 * là kỹ năng thật, còn bốn nghĩa lấy ngẫu nhiên từ 68k mục thì loại trừ được
 * mà chẳng cần nhớ gì. Thiếu thì bù từ từ điển — phiên chỉ có 2-3 thẻ vẫn
 * phải ra được câu hỏi 4 đáp án.
 */
export async function buildQuizQuestion(
    dict: DbLike,
    src: QuizSource,
    opts: { sessionPool?: string[] } = {},
    rng: () => number = Math.random,
): Promise<QuizQuestion> {
    const usable = src.dictSenses.filter((x) => isUsableDefinition(x.definition));
    // Giữ cả object chứ không chỉ câu nghĩa: ví dụ phải đi theo đúng nghĩa vừa bốc.
    const picked = usable.length ? usable[Math.floor(rng() * usable.length)] : null;
    const correct = picked?.definition ?? src.dictSenses[0]?.definition ?? src.definition;

    const fromSession = shuffleIn(
        (opts.sessionPool ?? []).filter(isUsableDefinition),
        rng,
    );
    const need = CHOICE_COUNT - 1 - fromSession.length;
    const fromDict = need > 0
        ? await pickDistractorDefinitions(
            dict, { excludeEntryId: src.entry_id, pos: src.pos, count: need }, rng)
        : [];

    return {
        entry_id: src.entry_id,
        headword: src.headword,
        pos: src.pos,
        ipa: src.ipa,
        audio: src.audio,
        examples: picked?.examples ?? [],
        choices: assembleChoices(correct, [...fromSession, ...fromDict], rng),
    };
}

function shuffleIn(arr: string[], rng: () => number): string[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, CHOICE_COUNT - 1);
}
