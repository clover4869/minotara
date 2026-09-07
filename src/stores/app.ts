/**
 * App-wide state (zustand): settings mirror + db-ready flag.
 * Settings persist in user.db; the store is just the in-memory mirror so
 * screens re-render on change. One source of truth: user.db.
 */
import { create } from 'zustand';
import { getSetting, setSetting } from '../db/user';
import { openUser } from '../db/open';

export type ThemeMode = 'system' | 'light' | 'dark';

interface AppState {
    dictReady: boolean;
    prefDialect: 'uk' | 'us';
    /**
     * Một công tắc cho cả hai chỗ phát âm: mở từ thì đọc một lần, ôn tập thì
     * lặp cho tới khi sang thẻ khác. Trước đây tách thành `autoplay` và
     * `reviewAutoplay` với nhãn "Tự phát âm khi mở từ" / "Tự động đọc từ" —
     * hai tên gần như nhau cho hai công tắc rời, nên bật một cái rồi tưởng
     * đã bật cả hai và kết luận là ôn tập bị lỗi audio.
     */
    autoplay: boolean;
    fontScale: 's' | 'm' | 'l';
    themeMode: ThemeMode;
    setDictReady(v: boolean): void;
    loadSettings(): Promise<void>;
    setPrefDialect(d: 'uk' | 'us'): Promise<void>;
    setAutoplay(v: boolean): Promise<void>;
    setFontScale(v: 's' | 'm' | 'l'): Promise<void>;
    setThemeMode(v: ThemeMode): Promise<void>;
}

export const FONT_MULT: Record<'s' | 'm' | 'l', number> = { s: 0.9, m: 1, l: 1.15 };

export const useApp = create<AppState>((set) => ({
    dictReady: false,
    prefDialect: 'uk',
    autoplay: false,
    fontScale: 'm',
    themeMode: 'system',
    setDictReady: (v) => set({ dictReady: v }),
    loadSettings: async () => {
        const db = await openUser();
        const fs = await getSetting(db, 'font_scale');
        const tm = await getSetting(db, 'theme_mode');
        set({
            prefDialect: (await getSetting(db, 'pref_dialect')) === 'us' ? 'us' : 'uk',
            // Máy nào từng bật riêng "Tự động đọc từ" khi ôn thì vẫn được kế
            // thừa, khỏi phải đi bật lại sau khi hai công tắc gộp làm một.
            autoplay: (await getSetting(db, 'autoplay')) === '1'
                || (await getSetting(db, 'review_autoplay')) === '1',
            fontScale: fs === 's' || fs === 'l' ? fs : 'm',
            themeMode: tm === 'light' || tm === 'dark' ? tm : 'system',
        });
    },
    setPrefDialect: async (d) => {
        set({ prefDialect: d });
        await setSetting(await openUser(), 'pref_dialect', d);
    },
    setAutoplay: async (v) => {
        set({ autoplay: v });
        await setSetting(await openUser(), 'autoplay', v ? '1' : '0');
    },
    setFontScale: async (v) => {
        set({ fontScale: v });
        await setSetting(await openUser(), 'font_scale', v);
    },
    setThemeMode: async (v) => {
        set({ themeMode: v });
        await setSetting(await openUser(), 'theme_mode', v);
    },
}));
