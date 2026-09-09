/**
 * Review session state (zustand), lifted out of the screen so it can be
 * shared between (tabs)/review.tsx (the "start" screen, stays a tab so the
 * bottom nav still works normally) and app/review-session.tsx (the "card" +
 * "done" screens, pushed as a full-screen modal so the tab bar disappears
 * during an active session — Task 22).
 */
import { create } from 'zustand';
import { openDictionary, openUser } from '@/db/open';
import { loadSrsStates, persistGrades, nextDueAt, type NextDue, type SavedWord } from '@/db/user';
import { SessionQueue, shuffle, type SrsState } from '@/services/srs';
import { formsOfEntry } from '@/services/lookup';
import { searchImages } from '@/services/image-search';
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
export type SessionPhase = 'card' | 'done';

export interface CardContent {
    entry_id: number;
    headword: string;
    ipa: string | null;
    audio: string | null;
    definition: string;
    /** Thumbnail cho chế độ Ảnh → Từ. undefined = chưa tải (spinner);
     *  [] = đã thử mà không có (fallback loa); chỉ tải khi ở đúng chế độ đó. */
    images?: string[];
    isUserMeaning: boolean;
    dictDefinition: string | null;
    example: string | null;
    forms: string;
}

interface ReviewSessionState {
    mode: ReviewMode;
    setMode(m: ReviewMode): void;

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

    begin(cards: SrsState[], skipGrade?: boolean): Promise<void>;
    flip(): void;
    answer(correct: boolean): Promise<void>;
    exitSession(): Promise<void>;
    retryMissed(): Promise<void>;
    clearCache(): void;
}

async function loadCard(cache: Map<number, CardContent>, entryId: number, dialect: 'uk' | 'us'): Promise<CardContent> {
    if (cache.has(entryId)) return cache.get(entryId)!;
    const dict = await openDictionary();
    const user = await openUser();
    const entry = await dict.getFirstAsync<any>(
        'SELECT id, headword, data FROM entries WHERE id = ?', entryId);
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
        ipa: pron?.phon ?? null,
        audio: pron?.audio_mp3 ?? data.pronunciations?.uk?.audio_mp3 ?? null,
        definition: saved?.user_meaning ?? firstSense?.definition ?? '(chưa có nghĩa)',
        isUserMeaning: !!saved?.user_meaning,
        dictDefinition: saved?.user_meaning ? firstSense?.definition ?? null : null,
        example: firstSense?.examples[0]?.text ?? null,
        forms,
    };
    cache.set(entryId, content);
    return content;
}

export const useReviewSession = create<ReviewSessionState>((set, get) => ({
    mode: 'word2meaning',
    setMode: (m) => set({ mode: m }),

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

    async begin(cards, skipGrade = false) {
        if (!cards.length) return;
        get().cache.clear();
        const q = skipGrade
            ? new SessionQueue(shuffle(cards), new Date(), Math.random, { reinforcement: true })
            : new SessionQueue(shuffle(cards), new Date());
        set({ queue: q, phase: 'card', noGrade: skipGrade, flipped: false, card: null, answered: 0 });
        await showCurrent(q, get, set);
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
    },
}));

async function showCurrent(
    q: SessionQueue,
    get: () => ReviewSessionState,
    set: (partial: Partial<ReviewSessionState>) => void,
): Promise<void> {
    stopRepeat();
    set({ flipped: false });
    const cur = q.current;
    if (!cur) {
        const { noGrade } = get();
        if (!noGrade) await persistGrades(await openUser(), q.graded);
        const nextDue = await nextDueAt(await openUser());
        set({ nextDue, phase: 'done', card: null });
        return;
    }
    const dialect = useApp.getState().prefDialect;
    const c = await loadCard(get().cache, cur.entry_id, dialect);
    set({ card: c });
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
    if (get().mode === 'image2word' && c.images === undefined) {
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
}
