/**
 * SRS — Leitner 5 boxes + the three Anki-borrowed mechanics from the spec:
 *   1. fuzz ±15% so same-day imports don't stay clumped forever
 *   2. learning steps: a NEW card must be answered correctly twice within the
 *      session before it graduates to box 2 (handled by SessionQueue)
 *   3. max 20 new cards per session; due reviews are uncapped up to the 40 ceiling
 *
 * Everything here is pure: time and randomness are injected, so tests are
 * deterministic. Persistence lives in db/user.ts, not here.
 */

export interface SrsState {
    entry_id: number;
    box: number;          // 1..5
    due_at: string;       // ISO
    streak: number;
    last_result: number | null; // 1 | 0 | null(never reviewed)
}

export const BOX_INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 };
export const MAX_NEW_PER_SESSION = 20;
export const MAX_CARDS_PER_SESSION = 40;

const DAY_MS = 86_400_000;

export const isNewCard = (s: SrsState) => s.last_result === null;

/**
 * Box transition per the spec table. Correct: 1→2→3→4→5→5.
 * Wrong: boxes 1-3 → 1; boxes 4-5 → 2 (partial credit for old cards).
 */
export function nextBox(box: number, correct: boolean): number {
    if (correct) return Math.min(5, box + 1);
    return box >= 4 ? 2 : 1;
}

/**
 * Apply one graded answer. `rng()` ∈ [0,1) injected for fuzz.
 * Returns a NEW state — caller persists it.
 */
export function grade(
    s: SrsState,
    correct: boolean,
    now: Date,
    rng: () => number = Math.random,
): SrsState {
    const box = nextBox(s.box, correct);
    const baseMs = BOX_INTERVAL_DAYS[box] * DAY_MS;
    const fuzz = 1 + (rng() * 2 - 1) * 0.15; // ±15%
    return {
        ...s,
        box,
        due_at: new Date(now.getTime() + baseMs * fuzz).toISOString(),
        streak: correct ? s.streak + 1 : 0,
        last_result: correct ? 1 : 0,
    };
}

/** Pick the cards for a session: due first (low box first), then ≤20 new. */
export function buildSession(all: SrsState[], now: Date): SrsState[] {
    const nowIso = now.toISOString();
    const due = all
        .filter((s) => !isNewCard(s) && s.due_at <= nowIso)
        .sort((a, b) => a.box - b.box || a.due_at.localeCompare(b.due_at));
    const fresh = all.filter(isNewCard).slice(0, MAX_NEW_PER_SESSION);
    return [...due, ...fresh].slice(0, MAX_CARDS_PER_SESSION);
}

/** 05A-03: no cards due — take the nearest upcoming reviews so the user can still study. */
export function buildAheadSession(all: SrsState[], now: Date, limit = 10): SrsState[] {
    const nowIso = now.toISOString();
    return all
        .filter((s) => !isNewCard(s) && s.due_at > nowIso)
        .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.box - b.box)
        .slice(0, limit);
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function boxCounts(states: SrsState[]): number[] {
    const c = [0, 0, 0, 0, 0];
    for (const s of states) {
        if (s.box >= 1 && s.box <= 5) c[s.box - 1]++;
    }
    return c;
}

/** 05B-02: hide the headword inside an example on the meaning→word face. */
export function maskHeadword(text: string, headword: string): string {
    if (!headword.trim()) return text;
    const escaped = headword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '___');
}

/**
 * SessionQueue — in-session flow including learning steps.
 *
 * A new card answered correctly does NOT leave the session on the first hit:
 * it goes back to the end of the queue and must be correct twice in a row
 * (within this session) before `grade()` is applied and it graduates.
 * Any wrong answer resets the in-session counter and requeues the card.
 * Non-new cards are graded immediately on first answer.
 */
type QueuedCard = SrsState & { _requeuedNoGrade?: boolean };

export class SessionQueue {
    private queue: QueuedCard[];
    private sessionCorrect = new Map<number, number>();
    private sessionWrong = new Map<number, number>();
    /** Graded results, ready to persist. */
    readonly graded: SrsState[] = [];
    /** entry_ids answered wrong at least once (for the "ôn lại thẻ sai" pass). */
    readonly missed = new Set<number>();
    readonly total: number;
    answered = 0;

    constructor(
        cards: SrsState[],
        private now: Date,
        private rng: () => number = Math.random,
        opts?: { reinforcement?: boolean },
    ) {
        this.queue = opts?.reinforcement
            ? cards.map((c) => ({ ...c, _requeuedNoGrade: true }))
            : [...cards];
        this.total = cards.length;
    }

    get current(): SrsState | null {
        return this.queue[0] ?? null;
    }
    get done(): boolean {
        return this.queue.length === 0;
    }

    answer(correct: boolean): void {
        const card = this.queue.shift();
        if (!card) return;
        this.answered++;

        // A card requeued purely for reinforcement was ALREADY graded —
        // answering it again must not touch SRS state (no double grading).
        if (card._requeuedNoGrade) {
            if (!correct) this.missed.add(card.entry_id);
            return;
        }

        if (!correct) this.missed.add(card.entry_id);

        if (isNewCard(card)) {
            const hits = correct ? (this.sessionCorrect.get(card.entry_id) ?? 0) + 1 : 0;
            this.sessionCorrect.set(card.entry_id, hits);
            if (hits >= 2) {
                this.graded.push(grade(card, true, this.now, this.rng)); // graduates → box 2
                return;
            }
            if (!correct) {
                const misses = (this.sessionWrong.get(card.entry_id) ?? 0) + 1;
                this.sessionWrong.set(card.entry_id, misses);
                // escape hatch: 4 misses on one new card → grade as wrong (box 1,
                // due tomorrow) and let the session move on instead of looping forever
                if (misses >= 4) {
                    this.graded.push(grade(card, false, this.now, this.rng));
                    return;
                }
            }
            this.queue.push(card); // back of the queue, try again this session
            return;
        }

        this.graded.push(grade(card, correct, this.now, this.rng));
        if (!correct) {
            // graded once (box drop) + shown once more at the end for immediate
            // reinforcement; that extra showing is grade-free (spec 05C-03)
            this.queue.push({ ...card, _requeuedNoGrade: true });
        }
    }
}
