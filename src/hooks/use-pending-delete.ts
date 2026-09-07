import { useCallback, useRef, useState } from 'react';

const UNDO_WINDOW_MS = 4000;

/**
 * Optimistic delete-with-undo: `remove(item)` hides it immediately (caller
 * filters `pendingItem` out of what it renders) and only calls `commit`
 * after the undo window passes with no `undo()` call. Used by swipe-to-
 * delete rows (Task 28) so a swipe doesn't need a blocking confirm dialog.
 */
export function usePendingDelete<T>(commit: (item: T) => Promise<void>) {
    const [pendingItem, setPendingItem] = useState<T | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const remove = useCallback((item: T) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setPendingItem(item);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setPendingItem(null);
            commit(item).catch(() => {});
        }, UNDO_WINDOW_MS);
    }, [commit]);

    const undo = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        setPendingItem(null);
    }, []);

    return { pendingItem, remove, undo };
}
