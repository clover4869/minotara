import { useColorScheme } from 'react-native';
import { useApp } from '@/stores/app';
import { palette, type ColorMode, type Semantic } from './tokens';

/** OS scheme, overridden by the user's in-app Sáng/Tối/Hệ thống choice (SCR-06). */
export function useEffectiveColorScheme(): ColorMode {
    const system = useColorScheme();
    const themeMode = useApp((s) => s.themeMode);
    if (themeMode === 'light' || themeMode === 'dark') return themeMode;
    return system === 'dark' ? 'dark' : 'light';
}

export function usePalette(): Semantic {
    return palette(useEffectiveColorScheme());
}
