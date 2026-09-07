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
import { parseEntryData } from '@/db/types';
import { playRepeating, stopRepeat, playUrl } from '@/services/audio';
import { useApp } from '@/stores/app';

export type ReviewMode = 'word2meaning' | 'meaning2word' | 'listen';
export type SessionPhase = 'card' | 'done';

export interface CardContent {
    entry_id: number;
    headword: string;
    ipa: string | null;
    audio: string | null;
    definition: string;
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
    nextDue: null,
    cache: new Map(),

    async begin(cards, skipGrade = false) {
        if (!cards.length) return;
        get().cache.clear();
        const q = skipGrade
            ? new SessionQueue(shuffle(cards), new Date(), Math.random, { reinforcement: true })
            : new SessionQueue(shuffle(cards), new Date());
        set({ queue: q, phase: 'card', noGrade: skipGrade, flipped: false, card: null });
        await showCurrent(q, get, set);
    },

    flip() {
        const { flipped, card, mode } = get();
        if (flipped || !card) return;
        set({ flipped: true });
        const { autoplay } = useApp.getState();
        if (autoplay && mode === 'meaning2word') playRepeating(card.audio);
    },

    async answer(correct) {
        const { queue } = get();
        if (!queue) return;
        stopRepeat();
        queue.answer(correct);
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
    const mode = get().mode;
    const { autoplay } = useApp.getState();
    // meaning2word cố tình KHÔNG phát ở đây: chế độ đó hiện nghĩa và bắt nhớ
    // lại từ, phát âm thanh lên là đọc luôn đáp án. Chỗ phát của nó là flip().
    const wordVisible = mode === 'word2meaning' || mode === 'listen';
    if (autoplay && wordVisible) playRepeating(c.audio);
    else if (mode === 'listen') playUrl(c.audio);
}
