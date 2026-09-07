/**
 * App-wide state (zustand): settings mirror + db-ready flag.
 * Settings persist in user.db; the store is just the in-memory mirror so
 * screens re-render on change. One source of truth: user.db.
 */
import { create } from 'zustand';
import { getSetting, setSetting } from '../db/user';
import { openUser } from '../db/open';

interface AppState {
    dictReady: boolean;
    prefDialect: 'uk' | 'us';
    autoplay: boolean;
    reviewAutoplay: boolean;
    fontScale: 's' | 'm' | 'l';
    setDictReady(v: boolean): void;
    loadSettings(): Promise<void>;
    setPrefDialect(d: 'uk' | 'us'): Promise<void>;
    setAutoplay(v: boolean): Promise<void>;
    setReviewAutoplay(v: boolean): Promise<void>;
    setFontScale(v: 's' | 'm' | 'l'): Promise<void>;
}

export const FONT_MULT: Record<'s' | 'm' | 'l', number> = { s: 0.9, m: 1, l: 1.15 };

export const useApp = create<AppState>((set) => ({
    dictReady: false,
    prefDialect: 'uk',
    autoplay: false,
    reviewAutoplay: false,
    fontScale: 'm',
    setDictReady: (v) => set({ dictReady: v }),
    loadSettings: async () => {
        const db = await openUser();
        const fs = await getSetting(db, 'font_scale');
        set({
            prefDialect: (await getSetting(db, 'pref_dialect')) === 'us' ? 'us' : 'uk',
            autoplay: (await getSetting(db, 'autoplay')) === '1',
            reviewAutoplay: (await getSetting(db, 'review_autoplay')) === '1',
            fontScale: fs === 's' || fs === 'l' ? fs : 'm',
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
    setReviewAutoplay: async (v) => {
        set({ reviewAutoplay: v });
        await setSetting(await openUser(), 'review_autoplay', v ? '1' : '0');
    },
    setFontScale: async (v) => {
        set({ fontScale: v });
        await setSetting(await openUser(), 'font_scale', v);
    },
}));
