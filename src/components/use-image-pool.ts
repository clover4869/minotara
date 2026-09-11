/**
 * Pool URL ảnh: hiện `want` ảnh đầu còn sống, link nào chết thì đẩy ảnh dự
 * phòng lên thay, cạn dự phòng mới gọi mạng lấy thêm.
 *
 * Vì sao pool nằm ở CHA chứ không phải mỗi ô ảnh tự lo: nếu từng ô tự gọi lại
 * mạng khi ảnh nó vỡ thì một trang 9 ô chết là 9 request Bing cùng lúc — đúng
 * cách để dính kiểu chặn mà cả tính năng ảnh đã phải vá mấy vòng. Ở đây cả
 * trang chỉ gọi lại ĐÚNG MỘT LẦN, và chỉ khi thật sự không còn ảnh nào để
 * hiện.
 *
 * Cache ảnh không hết hạn (xem getCachedImages), nên đây là con đường DUY
 * NHẤT để một link chết được thay. Không có nó thì ô ảnh vỡ sẽ vỡ vĩnh viễn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ImagePool {
    /** Các URL nên hiện lúc này — đã bỏ link chết, đã bù dự phòng. */
    visible: string[];
    /** Gọi từ `onError` của ô ảnh. */
    markDead: (url: string) => void;
    /** Đã cạn ảnh và lần gọi lại mạng cũng không cứu được. */
    exhausted: boolean;
}

export function useImagePool(
    all: string[],
    want: number,
    /** Lấy thêm ảnh (thường là searchImages với forceRefresh). Phải là hàm
     *  ổn định — bọc useCallback ở chỗ gọi, không thì effect chạy vòng. */
    refetch?: () => Promise<string[]>,
): ImagePool {
    const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set());
    const [extra, setExtra] = useState<string[]>([]);
    const asked = useRef(false);

    const alive = useMemo(
        () => [...all, ...extra].filter((u) => !dead.has(u)),
        [all, extra, dead],
    );

    const markDead = useCallback((url: string) => {
        setDead((prev) => {
            if (prev.has(url)) return prev; // giữ nguyên tham chiếu → khỏi re-render suông
            const next = new Set(prev);
            next.add(url);
            return next;
        });
    }, []);

    // Danh sách gốc đổi (sang từ khác / sang nghĩa khác) thì mở lại sổ: link
    // chết của từ trước không liên quan gì tới từ này.
    const signature = all.length ? `${all.length}:${all[0]}` : '';
    useEffect(() => {
        setDead(new Set());
        setExtra([]);
        asked.current = false;
    }, [signature]);

    /*
      Chỉ gọi lại mạng khi TỪNG CÓ ảnh mà giờ không đủ — tức đúng cảnh "link
      đã chết", là việc duy nhất hàm này sinh ra để làm.

      Điều kiện `all.length > 0` là bắt buộc, không phải cho gọn. Thiếu nó thì
      lúc cha còn đang tải (`all` là mảng rỗng) pool tưởng đã cạn ảnh và bắn
      forceRefresh ngay — mà forceRefresh thì BỎ QUA cache. Tab Ảnh của `run`
      có 17 block, nên đó là 17 request cache-miss bắn thêm cùng lúc với 17
      request thường: đủ để nguồn ảnh chặn cả trang, và mọi block hiện "nguồn
      ảnh không phản hồi" trong khi Bing vẫn trả 35 kết quả cho cùng truy vấn
      gọi từ dòng lệnh. Đã dính đúng như vậy.
    */
    useEffect(() => {
        if (!all.length || alive.length >= want || !refetch || asked.current) return;
        asked.current = true; // một lần cho cả pool, không phải một lần cho mỗi ô
        let alive2 = true;
        refetch()
            // Bỏ kết quả nếu đã sang từ/nghĩa khác trong lúc chờ mạng —
            // không có chốt này thì ảnh của từ trước đổ vào từ đang xem.
            .then((more) => { if (alive2) setExtra(more); })
            .catch(() => {});
        return () => { alive2 = false; };
    }, [all.length, alive.length, want, refetch]);

    return {
        visible: alive.slice(0, want),
        markDead,
        exhausted: all.length > 0 && alive.length === 0 && asked.current,
    };
}
