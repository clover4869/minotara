/**
 * SRS — FSRS-backed (ts-fsrs) interval math, wrapped in the same Anki-borrowed
 * session mechanics as before:
 *   1. fuzz ±15% so same-day imports don't stay clumped forever (applied on
 *      top of FSRS's computed interval — FSRS's own fuzz uses an internal,
 *      non-injectable RNG, which would break this file's "pure/deterministic"
 *      contract, so we keep doing it ourselves)
 *   2. learning steps: a NEW card must be answered correctly twice within the
 *      session before it graduates (handled by SessionQueue, unchanged)
 *   3. max 20 new cards per session; due reviews are uncapped up to the 40 ceiling
 *
 * `box` is kept only as a cosmetic bucket (derived from FSRS `stability`) for
 * the existing Leitner-ladder UI — it no longer drives scheduling.
 *
 * Everything here is pure: time and randomness are injected, so tests are
 * deterministic. Persistence lives in db/user.ts, not here.
 */
import { fsrs, createEmptyCard, Rating, State, type Card as FsrsCard } from 'ts-fsrs';

export interface SrsState {
    entry_id: number;
    box: number;          // 1..5, cosmetic — see boxFromStability()
    due_at: string;       // ISO
    streak: number;
    last_result: number | null; // 1 | 0 | null(never reviewed)
    // FSRS memory state — null until this card has been graded at least once
    // under FSRS (older Leitner-only rows, or a card saved but never reviewed).
    stability?: number | null;
    difficulty?: number | null;
    fsrs_state?: number | null;
    reps?: number | null;
    lapses?: number | null;
    scheduled_days?: number | null;
    learning_steps?: number | null;
    last_review?: string | null;
}

export const MAX_NEW_PER_SESSION = 20;
export const MAX_CARDS_PER_SESSION = 40;

export const isNewCard = (s: SrsState) => s.last_result === null;

/** enable_short_term: false — FSRS's own minute-granularity learning steps
 * would double up with SessionQueue's in-session graduation logic below, so
 * this instance is used purely for interval math, not step orchestration. */
const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });

/** Cosmetic bucket for the Leitner-ladder UI — same day thresholds the old Leitner boxes used, now read off FSRS's stability instead of driving anything. */
export function boxFromStability(stability: number | null | undefined): number {
    if (stability == null) return 1;
    if (stability < 2) return 1;
    if (stability < 4) return 2;
    if (stability < 7) return 3;
    if (stability < 14) return 4;
    return 5;
}

function toFsrsCard(s: SrsState, now: Date): FsrsCard {
    if (s.stability == null) {
        // Never graded under FSRS yet (fresh save, or a row from before this
        // migration) — seed a fresh memory state but keep the existing due
        // date rather than resetting it; FSRS ignores `due` for State.New
        // anyway, and self-corrects within a few real reviews regardless.
        return { ...createEmptyCard(now), due: new Date(s.due_at) };
    }
    return {
        due: new Date(s.due_at),
        stability: s.stability,
        difficulty: s.difficulty ?? 0,
        elapsed_days: 0, // deprecated field on Card; ts-fsrs computes elapsed time itself from `due`/`last_review`
        scheduled_days: s.scheduled_days ?? 0,
        learning_steps: s.learning_steps ?? 0,
        reps: s.reps ?? 0,
        lapses: s.lapses ?? 0,
        state: (s.fsrs_state ?? State.New) as State,
        last_review: s.last_review ? new Date(s.last_review) : undefined,
    };
}

function fromFsrsCard(entryId: number, card: FsrsCard, correct: boolean, streak: number): SrsState {
    return {
        entry_id: entryId,
        box: boxFromStability(card.stability),
        due_at: card.due.toISOString(),
        streak: correct ? streak + 1 : 0,
        last_result: correct ? 1 : 0,
        stability: card.stability,
        difficulty: card.difficulty,
        fsrs_state: card.state,
        reps: card.reps,
        lapses: card.lapses,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        last_review: card.last_review ? card.last_review.toISOString() : new Date().toISOString(),
    };
}

/**
 * Apply one graded answer via FSRS. "Chưa nhớ" → Rating.Again, "Đã nhớ" →
 * Rating.Good — the app keeps its 2-button UI; Hard/Easy are unused by
 * design (spec's explicit anti-"ease hell" stance). `rng()` ∈ [0,1) injected
 * for the ±15% fuzz layer. Returns a NEW state — caller persists it.
 */
export function grade(
    s: SrsState,
    correct: boolean,
    now: Date,
    rng: () => number = Math.random,
): SrsState {
    const rating = correct ? Rating.Good : Rating.Again;
    const { card } = scheduler.next(toFsrsCard(s, now), now, rating);
    const baseMs = card.due.getTime() - now.getTime();
    const fuzzedMs = baseMs > 0 ? baseMs * (1 + (rng() * 2 - 1) * 0.15) : baseMs;
    const fuzzedCard = { ...card, due: new Date(now.getTime() + fuzzedMs) };
    return fromFsrsCard(s.entry_id, fuzzedCard, correct, s.streak);
}

/** Preview the interval FSRS would give for each rating, without committing — for showing "< 1d" / "4d" next to the grade buttons. */
export function previewIntervals(s: SrsState, now: Date): { again: Date; good: Date } {
    const preview = scheduler.repeat(toFsrsCard(s, now), now);
    return { again: preview[Rating.Again].card.due, good: preview[Rating.Good].card.due };
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

/** 05A-01: the true due count + box distribution, uncapped — NOT `buildSession()`, which caps at 40/20 for gameplay and would undercount a real backlog. */
export function dueBoxCounts(all: SrsState[], now: Date): number[] {
    const nowIso = now.toISOString();
    return boxCounts(all.filter((s) => !isNewCard(s) && s.due_at <= nowIso));
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

    /** Distinct cards still in the queue (requeues from learning-steps/reinforcement count once) — use this for progress, not `answered`, which counts every attempt and can exceed `total`. */
    get remaining(): number {
        return new Set(this.queue.map((c) => c.entry_id)).size;
    }

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
