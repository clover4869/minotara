import { useColorScheme } from 'react-native';
import { palette, type Semantic } from './tokens';

export function usePalette(): Semantic {
    const scheme = useColorScheme();
    return palette(scheme === 'dark' ? 'dark' : 'light');
}
