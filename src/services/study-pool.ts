/**
 * Nguồn từ cho một lượt học — dùng chung cho phiên ôn tập và cho báo thức.
 *
 * Bốn tầng, xuống tầng sau chỉ khi tầng trước chưa đủ số từ:
 *
 *   1. TỪ CỦA BẠN   — sổ từ, xếp theo SRS: đến hạn trước, rồi sắp đến hạn,
 *                     rồi phần còn lại
 *   2. LỊCH SỬ      — từ đã tra mà chưa lưu, mới tra trước
 *   3. TỪ HÔM NAY   — đúng bộ gợi ý đang hiện ở màn Tra cứu (ghim theo ngày
 *                     trong settings `wotd_json`, không phải bốc lại mỗi lần)
 *   4. NGẪU NHIÊN   — từ B1/B2 bất kỳ trong từ điển
 *
 * Vì sao cần tầng 2-4: hết thẻ đến hạn không có nghĩa là hết nhu cầu học.
 * Trước đây nút "Bắt đầu" tắt hẳn khi không còn thẻ nào đến hạn, tức app nói
 * "hôm nay xong rồi" với người đang muốn học thêm.
 *
 * CHỈ TẦNG 1 ĐƯỢC CHẤM ĐIỂM. Từ ở tầng 2-4 chưa nằm trong sổ nên không có
 * hàng `srs_state`; chấm chúng là luyện thêm, không phải cam kết học lâu dài,
 * và `srs` để null chính là cách nói điều đó ra thành mã. Đừng dựa vào việc
 * `persistGrades` tự no-op (nó `UPDATE ... WHERE entry_id=?` nên sửa 0 dòng) —
 * đó là im lặng do tình cờ, không phải do thiết kế.
 */
import type { DbLike } from '../db/types';
import { getSetting } from '../db/user';
import { dailyWords } from './lookup';
import {
    buildSession, buildAheadSession, isNewCard, MAX_CARDS_PER_SESSION, type SrsState,
} from './srs';

/** Một từ trong lượt học. `srs` null = từ ngoài sổ, học thêm, không chấm. */
export interface StudyItem {
    entry_id: number;
    srs: SrsState | null;
}

export type StudyTier = 'saved' | 'history' | 'today' | 'random';

export interface StudyPool {
    items: StudyItem[];
    /** Đếm theo tầng — màn hình dùng để nói thật với người dùng là lượt này
     *  gồm bao nhiêu thẻ ôn và bao nhiêu từ học thêm. */
    counts: Record<StudyTier, number>;
}

/**
 * Trần số từ một lượt. Tầng 2-4 gần như vô hạn, nên không có trần thì một
 * lượt học không bao giờ kết thúc.
 */
export const STUDY_LIMIT = MAX_CARDS_PER_SESSION;

export async function buildStudyPool(
    dict: DbLike,
    user: DbLike,
    all: SrsState[],
    opts: { limit?: number; now?: Date } = {},
): Promise<StudyPool> {
    const limit = opts.limit ?? STUDY_LIMIT;
    const now = opts.now ?? new Date();
    const items: StudyItem[] = [];
    const taken = new Set<number>();
    const counts: Record<StudyTier, number> = { saved: 0, history: 0, today: 0, random: 0 };

    const add = (entry_id: number, srs: SrsState | null, tier: StudyTier) => {
        if (items.length >= limit || taken.has(entry_id)) return;
        taken.add(entry_id);
        items.push({ entry_id, srs });
        counts[tier]++;
    };
    const need = () => limit - items.length;

    // ---- tầng 1: từ của bạn ----------------------------------------------
    // buildSession lo phần "đến hạn + tối đa 20 từ mới"; hai bước sau vét
    // phần còn lại của sổ để người dùng vẫn ôn được khi hàng đợi đã sạch.
    for (const s of buildSession(all, now)) add(s.entry_id, s, 'saved');
    if (need() > 0) {
        for (const s of buildAheadSession(all, now, need())) add(s.entry_id, s, 'saved');
    }
    if (need() > 0) {
        // Từ mới chưa học đứng trước từ đã học xong — học cái chưa biết có ích
        // hơn là gặp lại cái đã chắc.
        const rest = [...all].sort((a, b) => Number(isNewCard(b)) - Number(isNewCard(a)));
        for (const s of rest) add(s.entry_id, s, 'saved');
    }

    // ---- tầng 2: lịch sử tra cứu -----------------------------------------
    if (need() > 0) {
        const rows = await user.getAllAsync<{ entry_id: number }>(
            `SELECT entry_id, MAX(looked_at) t FROM history
             WHERE entry_id IS NOT NULL
             GROUP BY entry_id ORDER BY t DESC LIMIT ?`,
            need() * 3, // lấy dư vì phần lớn có thể đã nằm trong sổ
        );
        for (const r of rows) add(r.entry_id, null, 'history');
    }

    // ---- tầng 3: từ hôm nay ----------------------------------------------
    // Cùng bộ đang hiện ở màn Tra cứu. Ghim theo ngày nên học nó là học đúng
    // thứ app vừa gợi ý, không phải một bộ khác bốc lại.
    if (need() > 0) {
        for (const id of await todayWordIds(user)) add(id, null, 'today');
    }

    // ---- tầng 4: ngẫu nhiên ----------------------------------------------
    if (need() > 0) {
        const fresh = await dailyWords(dict, need(), [...taken]);
        for (const w of fresh) add(w.id, null, 'random');
    }

    return { items, counts };
}

/** Đọc bộ "Từ hôm nay" đã ghim. Hỏng/chưa có thì trả rỗng, không nổ. */
async function todayWordIds(user: DbLike): Promise<number[]> {
    try {
        const raw = await getSetting(user, 'wotd_json');
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.map((w) => w?.id).filter((x): x is number => typeof x === 'number');
    } catch {
        return [];
    }
}

/**
 * SrsState giả cho từ ngoài sổ, để đưa được vào SessionQueue.
 *
 * `last_result: null` nên SessionQueue coi nó là thẻ MỚI — phải đúng 2 lần
 * trong phiên mới thôi hỏi lại, giống mọi từ mới khác. Chỗ chấm điểm lọc
 * theo sổ nên trạng thái giả này không bao giờ bị ghi xuống DB.
 */
export function syntheticState(entryId: number, now: Date): SrsState {
    return {
        entry_id: entryId,
        box: 1,
        due_at: now.toISOString(),
        streak: 0,
        last_result: null,
    };
}
