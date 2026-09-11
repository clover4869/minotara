/**
 * Review session state (zustand), lifted out of the screen so it can be
 * shared between (tabs)/review.tsx (the "start" screen, stays a tab so the
 * bottom nav still works normally) and app/review-session.tsx (the "card" +
 * "done" screens, pushed as a full-screen modal so the tab bar disappears
 * during an active session — Task 22).
 */
import { create } from 'zustand';
import { openDictionary, openUser } from '@/db/open';
import { loadSrsStates, persistGrades, nextDueAt, getSetting, setSetting, type NextDue, type SavedWord } from '@/db/user';
import { SessionQueue, shuffle, type SrsState } from '@/services/srs';
import { formsOfEntry } from '@/services/lookup';
import { searchImages, imageQueryFor } from '@/services/image-search';
import { buildQuizQuestion, type QuizQuestion } from '@/services/quiz';

/** Số ảnh đưa vào carousel trắc nghiệm — khớp CACHE_KEEP trong
 *  image-search.ts, tức là lấy hết những gì đã lưu cho nghĩa đó. */
const QUIZ_IMAGES = 12;
import { parseEntryData } from '@/db/types';
import { playRepeating, stopRepeat, playUrl } from '@/services/audio';
import { useApp } from '@/stores/app';

/**
 * 'image2word' thế chỗ 'listen': từ khi autoplay phát lặp ở MỌI chế độ, giá
 * trị riêng của thẻ nghe chỉ còn là giấu chữ — mà meaning2word cũng giấu chữ
 * và còn có định nghĩa làm câu hỏi. Thẻ ảnh cho một kiểu gợi nhớ khác hẳn
 * (thị giác), dùng lại luôn cache ảnh của tab Ảnh.
 */
export type ReviewMode = 'word2meaning' | 'meaning2word' | 'image2word';

/**
 * Trục thứ hai, độc lập với `mode`: thẻ lật hay trắc nghiệm.
 *
 * Ba giá trị của `ReviewMode` đều là THẺ LẬT, chỉ khác chiều hỏi. Trắc nghiệm
 * không phải chiều hỏi thứ tư mà là một cách tương tác khác — nhét nó thành
 * giá trị thứ tư của ReviewMode là nói rằng nó thay thế được cho ba cái kia,
 * trong khi `mode` không còn nghĩa gì khi đang làm trắc nghiệm.
 */
export type ReviewKind = 'card' | 'quiz';
export type SessionPhase = 'card' | 'done';

export interface CardContent {
    entry_id: number;
    headword: string;
    /** Từ loại — phiên báo thức lọc mồi nhử trắc nghiệm theo cùng từ loại. */
    pos: string | null;
    ipa: string | null;
    audio: string | null;
    definition: string;
    /** Thumbnail cho chế độ Ảnh → Từ. undefined = chưa tải (spinner);
     *  [] = đã thử mà không có (fallback loa); chỉ tải khi ở đúng chế độ đó. */
    images?: string[];
    isUserMeaning: boolean;
    dictDefinition: string | null;
    /**
     * MỌI nghĩa tiếng Anh của mục từ. Trắc nghiệm bốc ngẫu nhiên một nghĩa
     * trong đây làm đáp án đúng, nên một từ nhiều nghĩa được hỏi mỗi lần một
     * nghĩa khác chứ không lặp lại mãi nghĩa đầu.
     *
     * Cố ý KHÔNG dùng `definition`: khi người dùng đã tự viết nghĩa tiếng
     * Việt thì `definition` là câu tiếng Việt đó, còn ba mồi nhử là định
     * nghĩa tiếng Anh — đáp án đúng lộ ra chỉ vì khác ngôn ngữ.
     */
    dictSenses: string[];
    example: string | null;
    forms: string;
}

interface ReviewSessionState {
    mode: ReviewMode;
    setMode(m: ReviewMode): void;
    kind: ReviewKind;
    setKind(k: ReviewKind): void;
    /** Đọc lại lựa chọn đã lưu. Trước đây hai giá trị này chỉ nằm trong bộ
     *  nhớ nên mở lại app là về mặc định — chọn xong rồi mất là thứ người dùng
     *  phải làm lại mỗi ngày. */
    loadPrefs(): Promise<void>;

    /** Latest full SrsState snapshot, kept fresh by (tabs)/review.tsx — retryMissed() needs it to look up missed cards' current state. */
    allStates: SrsState[];
    setAllStates(s: SrsState[]): void;

    phase: SessionPhase;
    queue: SessionQueue | null;
    card: CardContent | null;
    flipped: boolean;
    noGrade: boolean;
    /** Tổng số lần trả lời trong phiên, kể cả các lần thẻ mới bị hỏi lại. Dùng
     *  cho thanh tiến độ; `queue.answered` không đủ vì zustand không thấy được
     *  thay đổi bên trong instance queue. */
    answered: number;
    nextDue: NextDue | null;
    cache: Map<number, CardContent>;

    /** Câu trắc nghiệm của thẻ đang hỏi. null khi đang ở kiểu thẻ lật. */
    question: QuizQuestion | null;
    /** key đáp án đã chọn — có giá trị nghĩa là đã lộ đáp án, chờ sang câu kế. */
    picked: string | null;

    begin(cards: SrsState[], skipGrade?: boolean): Promise<void>;
    flip(): void;
    /** Chọn một đáp án. CHỈ ghi lựa chọn để lộ đáp án — không chấm, không sang
     *  thẻ kế. Màn hình chờ cho người dùng đọc xong rồi tự gọi answer(). */
    pick(key: string): void;
    answer(correct: boolean): Promise<void>;
    exitSession(): Promise<void>;
    retryMissed(): Promise<void>;
    clearCache(): void;
}

export async function loadCard(cache: Map<number, CardContent>, entryId: number, dialect: 'uk' | 'us'): Promise<CardContent> {
    if (cache.has(entryId)) return cache.get(entryId)!;
    const dict = await openDictionary();
    const user = await openUser();
    const entry = await dict.getFirstAsync<any>(
        'SELECT id, headword, pos, data FROM entries WHERE id = ?', entryId);
    const saved = await user.getFirstAsync<SavedWord>(
        'SELECT * FROM saved_words WHERE entry_id = ?', entryId);
    const data = parseEntryData(entry.data);
    const pron = data.pronunciations?.[dialect === 'us' ? 'us' : 'uk'];
    const firstSense = data.senses.find((x) => x.definition);
    const inf = await formsOfEntry(dict, entryId);
    const forms = inf
        .filter((f) => f.form_type === 'past' || f.form_type === 'past_participle')
        .map((f) => `${f.form_type === 'past' ? 'V2' : 'V3'} ${f.form}`)
        .join(' · ');
    const content: CardContent = {
        entry_id: entryId,
        headword: entry.headword,
        pos: entry.pos ?? null,
        ipa: pron?.phon ?? null,
        audio: pron?.audio_mp3 ?? data.pronunciations?.uk?.audio_mp3 ?? null,
        definition: saved?.user_meaning ?? firstSense?.definition ?? '(chưa có nghĩa)',
        isUserMeaning: !!saved?.user_meaning,
        dictDefinition: saved?.user_meaning ? firstSense?.definition ?? null : null,
        dictSenses: data.senses.map((x) => x.definition).filter((d): d is string => !!d),
        example: firstSense?.examples[0]?.text ?? null,
        forms,
    };
    cache.set(entryId, content);
    return content;
}

export const useReviewSession = create<ReviewSessionState>((set, get) => ({
    mode: 'word2meaning',
    setMode: (m) => {
        set({ mode: m });
        openUser().then((db) => setSetting(db, 'review_mode', m)).catch(() => {});
    },
    kind: 'card',
    setKind: (k) => {
        set({ kind: k });
        openUser().then((db) => setSetting(db, 'review_kind', k)).catch(() => {});
    },
    async loadPrefs() {
        const db = await openUser();
        const m = await getSetting(db, 'review_mode');
        const k = await getSetting(db, 'review_kind');
        set({
            mode: m === 'meaning2word' || m === 'image2word' ? m : 'word2meaning',
            kind: k === 'quiz' ? 'quiz' : 'card',
        });
    },

    allStates: [],
    setAllStates: (s) => set({ allStates: s }),

    phase: 'card',
    queue: null,
    card: null,
    flipped: false,
    noGrade: false,
    answered: 0,
    nextDue: null,
    cache: new Map(),
    question: null,
    picked: null,

    async begin(cards, skipGrade = false) {
        if (!cards.length) return;
        get().cache.clear();
        const q = skipGrade
            ? new SessionQueue(shuffle(cards), new Date(), Math.random, { reinforcement: true })
            : new SessionQueue(shuffle(cards), new Date());
        set({
            queue: q, phase: 'card', noGrade: skipGrade, flipped: false, card: null,
            answered: 0, question: null, picked: null,
        });
        // Nghĩa của mọi thẻ trong phiên, lấy MỘT truy vấn: mồi nhử trắc nghiệm
        // ưu tiên các thẻ khác trong cùng phiên. Nạp từng thẻ khi cần thì ba
        // câu đầu chưa có thẻ nào khác được nạp, mồi nhử rơi hết về từ điển.
        sessionDefs = get().kind === 'quiz' ? await loadSessionDefs(cards) : [];
        await showCurrent(q, get, set);
    },

    pick(key) {
        if (!get().question || get().picked) return; // chọn rồi thì bấm nữa không đổi
        set({ picked: key });
    },

    /**
     * Lật qua lại được: chạm lần nữa là về mặt trước. Trước đây chỉ lật một
     * chiều, nên lỡ chạm sớm là mất cơ hội tự nhớ mà không có đường quay lại.
     * Không đụng tới audio: showCurrent() đã bật vòng lặp từ lúc thẻ hiện ra,
     * gọi lại ở đây chỉ làm âm thanh nhảy về đầu và reset tốc độ đang tăng dần.
     */
    flip() {
        const { flipped, card } = get();
        if (!card) return;
        set({ flipped: !flipped });
    },

    async answer(correct) {
        const { queue } = get();
        if (!queue) return;
        stopRepeat();
        queue.answer(correct);
        // `queue` là một instance bị sửa tại chỗ, zustand so sánh theo tham
        // chiếu nên không thấy gì đổi. Màn hình vẫn vẽ lại nhờ `card` đổi —
        // trừ đúng lúc chỉ còn một thẻ và nó bị đưa lại hàng đợi: `showCurrent`
        // set lại đúng object cũ từ cache, không re-render, thanh tiến độ đứng
        // im. Đẩy `answered` vào state để mỗi câu trả lời chắc chắn vẽ lại.
        set({ answered: queue.answered });
        await showCurrent(queue, get, set);
    },

    async exitSession() {
        const { queue, noGrade } = get();
        if (queue && !noGrade) await persistGrades(await openUser(), queue.graded);
        stopRepeat();
    },

    async retryMissed() {
        const { queue, allStates } = get();
        if (!queue) return;
        const missed = allStates.filter((s) => queue.missed.has(s.entry_id));
        if (!missed.length) return;
        await get().begin(missed, true);
    },

    clearCache() {
        get().cache.clear();
        sessionDefs = [];
    },
}));

/**
 * Nghĩa của mọi thẻ trong phiên, dùng làm mồi nhử trắc nghiệm. Sống ngoài
 * zustand vì UI không vẽ theo nó.
 *
 * Một truy vấn cho cả phiên chứ không nạp lẻ từng thẻ: nạp lẻ thì ba câu đầu
 * chưa có thẻ nào khác trong cache, mồi nhử rơi hết về từ điển — đúng lúc
 * người dùng còn chưa vào nhịp thì bài lại dễ nhất.
 */
let sessionDefs: Array<{ entry_id: number; def: string }> = [];

async function loadSessionDefs(cards: SrsState[]): Promise<Array<{ entry_id: number; def: string }>> {
    if (!cards.length) return [];
    const dict = await openDictionary();
    const ids = cards.map((c) => c.entry_id);
    const rows = await dict.getAllAsync<{ id: number; def: string | null }>(
        `SELECT id, json_extract(data, '$.senses[0].definition') AS def
         FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
    );
    return rows
        .filter((r): r is { id: number; def: string } => !!r.def)
        .map((r) => ({ entry_id: r.id, def: r.def }));
}

async function showCurrent(
    q: SessionQueue,
    get: () => ReviewSessionState,
    set: (partial: Partial<ReviewSessionState>) => void,
): Promise<void> {
    stopRepeat();
    set({ flipped: false, picked: null });
    const cur = q.current;
    if (!cur) {
        const { noGrade } = get();
        if (!noGrade) await persistGrades(await openUser(), q.graded);
        const nextDue = await nextDueAt(await openUser());
        set({ nextDue, phase: 'done', card: null, question: null });
        return;
    }
    const dialect = useApp.getState().prefDialect;
    const c = await loadCard(get().cache, cur.entry_id, dialect);
    set({ card: c });

    if (get().kind === 'quiz') {
        const pool = sessionDefs.filter((d) => d.entry_id !== c.entry_id).map((d) => d.def);
        const question = await buildQuizQuestion(await openDictionary(), c, { sessionPool: pool });
        // Chỉ gán nếu người dùng còn đứng ở đúng thẻ đó — dựng câu hỏi có
        // await, trong lúc đó họ có thể đã trả lời xong thẻ trước.
        if (get().card?.entry_id === c.entry_id) set({ question });
    } else {
        set({ question: null });
    }
    const { autoplay } = useApp.getState();
    // Bật autoplay là phát, mọi chế độ, không chờ lật thẻ. Kể cả
    // meaning2word/image2word — ở đó phát âm thanh lên là hé đáp án, nhưng
    // đó là điều người dùng chọn khi bật công tắc này, không phải chỗ app cản.
    if (autoplay) playRepeating(c.audio);

    // Ảnh cho thẻ Ảnh → Từ: tải NGOÀI luồng hiện thẻ — chờ mạng xong mới cho
    // thẻ hiện là phiên ôn khựng lại theo Bing. Thẻ hiện ngay với spinner,
    // ảnh về thì điền vào nếu người dùng còn đứng ở đúng thẻ đó. Kết quả ghi
    // cả vào cache phiên nên thẻ bị hỏi lại (từ mới phải đúng 2 lần) không
    // tải lại; thất bại ghi [] — một lần thử mỗi phiên, không dội Bing theo
    // mỗi lượt thẻ quay về.
    if (get().mode === 'image2word' && get().kind === 'card' && c.images === undefined) {
        (async () => {
            let imgs: string[] = [];
            try {
                const r = await searchImages(await openUser(), c.headword);
                if (!r.failed) imgs = r.results.slice(0, 4).map((x) => x.thumbnail);
            } catch { /* giữ imgs = [] — fallback loa */ }
            const withImgs = { ...c, images: imgs };
            get().cache.set(withImgs.entry_id, withImgs);
            if (get().card?.entry_id === withImgs.entry_id) set({ card: withImgs });
        })();
    }

    // Ảnh cho câu trắc nghiệm. Cũng tải ngoài luồng, cùng lý do như trên.
    //
    // Một phiên tới 40 thẻ nên đây là đường gọi ảnh dày nhất trong cả app —
    // chống đỡ nằm ở ba chỗ: cache 30 ngày trong image_cache, giãn nhịp
    // 700ms/request trong image-search.ts, và ghi kết quả vào cache phiên
    // dưới đây nên thẻ bị hỏi lại (từ mới phải đúng 2 lần) không tải lại.
    if (get().kind === 'quiz' && c.images === undefined) {
        // Tra ảnh theo ĐÚNG nghĩa đang được hỏi, không phải nghĩa đầu: đáp án
        // đúng bốc ngẫu nhiên trong các nghĩa, nên lấy nghĩa đầu thì ảnh minh
        // hoạ một nghĩa khác của cùng từ — không sai hẳn, nhưng lệch với câu
        // hỏi đúng lúc ảnh đang là chỗ dựa để nhớ.
        const asked = get().question?.choices.find((x) => x.correct)?.text ?? c.dictSenses[0] ?? null;
        (async () => {
            let imgs: string[] = [];
            try {
                const r = await searchImages(await openUser(), imageQueryFor(c.headword, asked));
                if (!r.failed) imgs = r.results.slice(0, QUIZ_IMAGES).map((x) => x.thumbnail);
            } catch { /* giữ [] — làm bài bằng chữ, bốn nghĩa đã đủ */ }
            get().cache.set(c.entry_id, { ...c, images: imgs });
            if (get().question?.entry_id === c.entry_id) {
                set({ question: { ...get().question!, images: imgs } });
            }
        })();
    }
}
