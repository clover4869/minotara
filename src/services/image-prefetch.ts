/**
 * Quét ảnh nền cho một mục từ: nghĩa 1 → nghĩa 2 → … → idiom 1 → idiom 2 …
 *
 * Vì sao quét hết chứ không giới hạn: dữ liệu từ điển nằm offline nên người
 * dùng lật nghĩa rất nhanh, và họ thường đọc phần nghĩa tiếng Anh một lúc
 * trước khi mở tab Ảnh. Quét sẵn trong lúc đó thì tab Ảnh mở ra là có ngay.
 * Cache không hết hạn nên mỗi nghĩa chỉ phải trả giá đúng một lần trong đời.
 *
 * Vì sao TUẦN TỰ chứ không song song: `take` (verb) có 43 nghĩa + 10 idiom.
 * Bắn 53 request cùng lúc là cách nhanh nhất để nguồn ảnh chặn lại — mà nó đã
 * chặn thật mấy lần trong lúc dựng tính năng này. Chạy nối đuôi thì lớp giãn
 * nhịp 700ms trong image-search.ts tự rải chúng ra.
 *
 * Vì sao phải HUỶ ĐƯỢC: lướt nhanh qua mười từ mà mỗi từ để lại một hàng đợi
 * 53 request thì hàng đợi dài hơn cả phiên dùng app, và toàn bộ là ảnh cho
 * những từ người dùng đã rời khỏi.
 */
import type { DbLike } from '../db/types';
import { searchImages, imageQueryFor } from './image-search';

/**
 * Một mục cần quét. Truy vấn cuối là `imageQueryFor(word, text)`.
 *
 * `word` tách riêng vì idiom KHÔNG tra bằng từ gốc: `idioms[].idiom` là bản
 * thân cụm từ ("take the biscuit"), nên tra "take" + cụm đó ra "take take the
 * biscuit". Idiom phải tra bằng chính cụm từ + nghĩa của cụm.
 */
export interface PrefetchTarget {
    word: string;
    /** Văn bản dùng làm phần nghĩa của truy vấn. */
    text: string;
}

export interface PrefetchHandle {
    cancel(): void;
}

/**
 * Bắt đầu quét. Trả về tay cầm để huỷ — gọi `cancel()` khi rời màn hình.
 *
 * Không bao giờ throw: một nghĩa lấy ảnh hỏng thì bỏ qua, đi tiếp nghĩa sau.
 * Đây là việc chạy nền, không có ai đứng đó để nhận lỗi.
 */
export function prefetchWordImages(
    userDb: DbLike,
    targets: PrefetchTarget[],
): PrefetchHandle {
    let cancelled = false;

    (async () => {
        for (const t of targets) {
            if (cancelled) return;
            const q = imageQueryFor(t.word, t.text);
            if (!q) continue;
            try {
                await searchImages(userDb, q);
            } catch {
                // nghĩa này không lấy được ảnh — đi tiếp, đừng làm đứt cả lượt
            }
        }
    })();

    return { cancel() { cancelled = true; } };
}

/**
 * Dựng danh sách mục cần quét, theo đúng thứ tự người dùng sẽ gặp trên màn
 * hình: các nghĩa trước, rồi tới các idiom.
 *
 * Lọc trùng theo truy vấn sẽ sinh ra: hai nghĩa ghi giống nhau thì cache dưới
 * đã gộp, nhưng lọc ở đây rẻ hơn là để nó xếp hàng rồi mới phát hiện.
 */
export function prefetchTargetsFor(
    headword: string,
    senses: Array<{ definition: string | null }>,
    idioms: Array<{ idiom: string | null; senses?: Array<{ definition: string | null }> }> = [],
): PrefetchTarget[] {
    const seen = new Set<string>();
    const out: PrefetchTarget[] = [];
    const push = (word: string | null | undefined, text: string | null | undefined) => {
        const w = (word ?? '').trim();
        const t = (text ?? '').trim();
        if (!w || !t) return;
        const k = `${w.toLowerCase()}${t.toLowerCase()}`;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ word: w, text: t });
    };
    for (const s of senses) push(headword, s.definition);
    for (const i of idioms) push(i.idiom, i.senses?.[0]?.definition);
    return out;
}
