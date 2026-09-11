/**
 * Phiên làm bài của báo thức. Khác phiên ôn tập thường ở ba chỗ, và cả ba
 * đều bắt nguồn từ một điều: màn này KHÔNG có nút thoát.
 *
 * 1. Điều kiện kết thúc là "đủ N câu ĐÚNG", không phải "hết hàng đợi". Hàng
 *    đợi có thể cạn (người dùng lưu ít từ) — cạn thì lấy thêm, chứ hết bài
 *    mà chuông chưa tắt được là kẹt.
 * 2. Chấm điểm ghi xuống DB NGAY sau mỗi câu, không gom tới cuối phiên. Không
 *    có lối thoát tử tế nghĩa là lối thoát duy nhất là tắt app — và công sức
 *    đã bỏ ra tới lúc đó vẫn phải được tính.
 * 3. Mọi đường dựng bài đều phải ra được một câu hỏi trả lời được. Không có
 *    trạng thái "không có gì để làm": chưa lưu từ nào thì lấy từ trong từ
 *    điển ra hỏi. Xem `buildPool`.
 */
import { create } from 'zustand';

import { openDictionary, openUser } from '@/db/open';
import {
    loadSrsStates, persistGrades, logAlarmEvent, type AlarmConfig,
} from '@/db/user';
import { buildSession, buildAheadSession, grade, shuffle, type SrsState } from '@/services/srs';
import { dailyWords } from '@/services/lookup';
import { assembleChoices, pickDistractorDefinitions, type QuizQuestion } from '@/services/quiz';
import { searchImages, imageQueryFor } from '@/services/image-search';
import { playRepeating, stopRepeat } from '@/services/audio';
import { clearAlarmNotifications } from '@/services/alarm';
import { loadCard, type CardContent } from '@/stores/review-session';
import { useApp } from '@/stores/app';

/** Một mục để hỏi. `srs` null nghĩa là từ lấy từ từ điển chứ không phải sổ
 *  từ của người dùng — hỏi được, nhưng không có trạng thái SRS để chấm. */
interface AlarmItem {
    entry_id: number;
    srs: SrsState | null;
}

/** Bao nhiêu ảnh hiện trong câu trắc nghiệm. */
const QUIZ_IMAGES = 2;

interface AlarmSessionState {
    kind: AlarmConfig['kind'];
    target: number;
    /** Số câu ĐÚNG đã đạt. Đây là thứ duy nhất mở được màn này. */
    correct: number;
    done: boolean;
    loading: boolean;

    card: CardContent | null;
    flipped: boolean;

    question: QuizQuestion | null;
    /** key đáp án đã chọn — có giá trị là đang ở trạng thái đã lộ đáp án. */
    picked: string | null;

    begin(cfg: AlarmConfig): Promise<void>;
    flip(): void;
    /** Chế độ ôn tập: tự chấm. */
    answerReview(correct: boolean): Promise<void>;
    /** Chế độ trắc nghiệm: chọn một đáp án. Không tự sang câu sau — màn hình
     *  quyết định lúc nào đi tiếp, để người dùng kịp nhìn đáp án đúng. */
    pick(key: string): Promise<void>;
    next(): Promise<void>;
    teardown(): void;
}

/** Hàng đợi sống ngoài zustand: nó bị sửa tại chỗ liên tục và không có gì
 *  trong UI vẽ theo nó, đẩy vào store chỉ tạo re-render vô ích. */
let pool: AlarmItem[] = [];
let cache = new Map<number, CardContent>();
/** Mục đang hỏi — chỉ logic chấm điểm cần tới, UI đọc `card`/`question`. */
let currentItem: AlarmItem | null = null;

/**
 * Dựng nguồn câu hỏi, theo thứ tự ưu tiên — và luôn phải ra được thứ gì đó:
 *   1. thẻ đến hạn hôm nay
 *   2. thẻ sắp đến hạn (ôn sớm còn hơn không có gì)
 *   3. mọi từ đã lưu
 *   4. từ B1/B2 lấy ngẫu nhiên từ từ điển — cho người chưa lưu từ nào
 *
 * Bước 4 là lý do màn này không bao giờ kẹt. Nó cũng khớp với chủ ý của tính
 * năng: mục đích là dậy đúng giờ và động não, không phải dọn sạch hàng đợi
 * ôn tập — hết bài mà im lặng thì hôm đó mất luôn thói quen.
 */
async function buildPool(target: number): Promise<AlarmItem[]> {
    const user = await openUser();
    const all = await loadSrsStates(user);
    const now = new Date();

    const due = buildSession(all, now);
    if (due.length) return shuffle(due).map((s) => ({ entry_id: s.entry_id, srs: s }));

    const ahead = buildAheadSession(all, now, Math.max(target * 2, 10));
    if (ahead.length) return shuffle(ahead).map((s) => ({ entry_id: s.entry_id, srs: s }));

    if (all.length) return shuffle(all).map((s) => ({ entry_id: s.entry_id, srs: s }));

    const dict = await openDictionary();
    const fresh = await dailyWords(dict, Math.max(target * 2, 10));
    return fresh.map((w) => ({ entry_id: w.id, srs: null }));
}

/** Lấy mục kế tiếp, nạp thêm nếu hàng đợi cạn trước khi đạt đủ số câu đúng. */
async function takeNext(target: number): Promise<AlarmItem | null> {
    if (!pool.length) pool = await buildPool(target);
    return pool.shift() ?? null;
}

export const useAlarmSession = create<AlarmSessionState>((set, get) => ({
    kind: 'quiz',
    target: 5,
    correct: 0,
    done: false,
    loading: true,
    card: null,
    flipped: false,
    question: null,
    picked: null,

    async begin(cfg) {
        pool = [];
        cache = new Map();
        set({
            kind: cfg.kind, target: cfg.target, correct: 0, done: false,
            loading: true, card: null, flipped: false, question: null, picked: null,
        });
        await logAlarmEvent(await openUser(), 'fired');
        await showNext(get, set);
    },

    flip() {
        if (!get().card) return;
        set({ flipped: !get().flipped });
    },

    async answerReview(correct) {
        if (!get().card || get().done) return;
        await commitAnswer(correct, get, set);
        if (!get().done) await showNext(get, set);
    },

    async pick(key) {
        const { question, picked, done } = get();
        if (!question || picked || done) return; // đã chọn rồi thì bấm nữa không đổi
        const choice = question.choices.find((c) => c.key === key);
        if (!choice) return;
        set({ picked: key });
        await commitAnswer(choice.correct, get, set);
    },

    async next() {
        await showNext(get, set);
    },

    teardown() {
        stopRepeat();
        pool = [];
        cache = new Map();
    },
}));

/**
 * Ghi nhận một câu trả lời: chấm vào SRS (nếu từ có trong sổ), cộng điểm nếu
 * đúng, và nếu chưa đúng thì đẩy từ đó lại cuối hàng đợi để hỏi lại.
 *
 * Ghi DB ngay tại đây chứ không gom cuối phiên — xem ghi chú (2) đầu file.
 */
async function commitAnswer(
    correct: boolean,
    get: () => AlarmSessionState,
    set: (p: Partial<AlarmSessionState>) => void,
): Promise<void> {
    const item = currentItem;
    if (item?.srs) {
        try {
            await persistGrades(await openUser(), [grade(item.srs, correct, new Date())]);
        } catch { /* chấm điểm hỏng không được làm kẹt phiên */ }
    }
    // Sai thì hỏi lại, nhưng `srs: null` để lần sau không chấm lần hai —
    // FSRS đã nhận "Again" rồi, chấm tiếp là phạt chồng cho cùng một lỗi.
    if (!correct && item) pool.push({ ...item, srs: null });
    const next = get().correct + (correct ? 1 : 0);
    set({ correct: next });
    if (next >= get().target) await finish(set);
}

async function finish(set: (p: Partial<AlarmSessionState>) => void): Promise<void> {
    stopRepeat();
    await clearAlarmNotifications();
    try {
        await logAlarmEvent(await openUser(), 'completed');
    } catch { /* nhật ký hỏng không được chặn việc tắt chuông */ }
    // Không xoá card/question, nhưng cũng đừng trông chờ chúng còn được vẽ:
    // màn hình rẽ sang nhánh `done` ngay khi cờ này bật, nên câu vừa trả lời
    // đúng KHÔNG kịp hiện màu xanh. Với mặc định 1 câu thì đó lại là đúng
    // nhịp — chạm một cái là chuông tắt, không bắt xem thêm hoạt cảnh nào.
    // Trả lời SAI thì không vào đây, nên đáp án đúng vẫn được lộ ra đủ lâu.
    set({ done: true, loading: false });
}

async function showNext(
    get: () => AlarmSessionState,
    set: (p: Partial<AlarmSessionState>) => void,
): Promise<void> {
    if (get().done) return;
    stopRepeat();
    set({ loading: true, flipped: false, picked: null });

    const item = await takeNext(get().target);
    if (!item) {
        // Không dựng được câu nào (từ điển hỏng?) — mở khoá thay vì giam
        // người dùng lại với một màn hình trống.
        await finish(set);
        return;
    }
    currentItem = item;

    const dialect = useApp.getState().prefDialect;
    const card = await loadCard(cache, item.entry_id, dialect);

    if (get().kind === 'review') {
        set({ card, question: null, loading: false });
    } else {
        const dict = await openDictionary();
        const distractors = await pickDistractorDefinitions(dict, {
            excludeEntryId: item.entry_id, pos: card.pos, count: 3,
        });
        const q: QuizQuestion = {
            entry_id: item.entry_id,
            headword: card.headword,
            ipa: card.ipa,
            audio: card.audio,
            choices: assembleChoices(card.definition, distractors),
        };
        set({ card, question: q, loading: false });
        loadQuizImages(q, card, get, set);
    }

    // Phát âm lặp liên tục ở CẢ HAI kiểu bài, không phụ thuộc công tắc
    // "tự động phát âm" trong Cài đặt: ở đây tiếng đọc là một phần của việc
    // đánh thức, không phải tuỳ chọn tiện lợi lúc tra từ.
    playRepeating(card.audio);
}

/**
 * Ảnh cho câu trắc nghiệm — tải ngoài luồng hiện câu hỏi. Chờ mạng xong mới
 * cho hiện thì báo thức đứng hình theo Bing, mà nguồn ảnh thì có lúc chặn.
 * Không có ảnh vẫn làm bài được: từ và bốn nghĩa đã đủ.
 */
function loadQuizImages(
    q: QuizQuestion,
    card: CardContent,
    get: () => AlarmSessionState,
    set: (p: Partial<AlarmSessionState>) => void,
): void {
    (async () => {
        let images: string[] = [];
        try {
            const r = await searchImages(await openUser(), imageQueryFor(card.headword, card.definition));
            if (!r.failed) images = r.results.slice(0, QUIZ_IMAGES).map((x) => x.thumbnail);
        } catch { /* giữ [] — làm bài bằng chữ */ }
        if (get().question?.entry_id === q.entry_id) {
            set({ question: { ...get().question!, images } });
        }
    })();
}
