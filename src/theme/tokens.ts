/**
 * Minotara token spine — Porcelain preset.
 * 3 layers: primitive → semantic → component.
 * sRGB hex for React Native StyleSheet (OKLCH source in .ui-craft/tokens.md).
 * Do not use raw hex in screens; import from here.
 */
import type { TextStyle, ViewStyle } from 'react-native';

export type ColorMode = 'light' | 'dark';

/** Layer 1 — named for the value, not the role. */
export const primitive = {
    gray: {
        50: '#FBFAF7',
        100: '#F6F3EF',
        200: '#E7E4DF',
        300: '#D1CDC7',
        400: '#A39D96',
        500: '#807971',
        600: '#746D65',
        700: '#4E463F',
        800: '#2E2721',
        900: '#201914',
        950: '#130F0A',
    },
    accent: {
        50: '#FBF0EA',
        100: '#F6DCD0',
        200: '#EBB7A0',
        300: '#E39678',
        400: '#DB7A58',
        500: '#C06240',
        600: '#AF5331',
        700: '#944123',
        800: '#6F311A',
        900: '#4A2012',
    },
    green: { 400: '#5AA56A', 600: '#36884D' },
    amber: { 400: '#D4A44A', 600: '#BB881A' },
    red: { 400: '#D46555', 600: '#BD3931' },
} as const;

export const space = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
} as const;

export const type = {
    size: { xs: 12, sm: 14, md: 15, lg: 18, xl: 20, '2xl': 24, '3xl': 30, display: 30 },
    weight: { regular: '400' as const, medium: '500' as const, semibold: '600' as const },
    leading: { tight: 1.15, snug: 1.3, body: 1.55 },
    tracking: { tight: -0.015, display: -0.015, wide: 0.04 },
    font: {
        body: undefined as string | undefined, // system UI
        display: undefined as string | undefined,
        mono: 'Menlo',
    },
};

export const radius = {
    sm: 2,
    md: 10, // inputs, badges — Porcelain
    lg: 14, // cards
    xl: 20, // modals / sheets
    full: 9999,
} as const;

export const duration = {
    instant: 80,
    fast: 140,
    base: 220,
    slow: 360,
} as const;

export const easing = {
    out: 'cubic-bezier(0.22, 1, 0.36, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const z = {
    base: 0,
    raised: 1,
    dropdown: 10,
    sticky: 20,
    modalBackdrop: 30,
    modal: 40,
    toast: 50,
} as const;

/** Brief §6: one vector set. Install lucide-react-native on /craft. */
export const icon = {
    set: 'lucide' as const,
    size: { sm: 16, md: 20, lg: 24 },
    stroke: 1.75,
};

type Shadow = Pick<ViewStyle, 'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'>;

function layeredShadow(color: string, opacity: number, y: number, radiusPx: number, elevation: number): Shadow {
    return {
        shadowColor: color,
        shadowOffset: { width: 0, height: y },
        shadowOpacity: opacity,
        shadowRadius: radiusPx,
        elevation,
    };
}

/** Layer 2 — remaps per mode. Primitives never change. */
export const semantic = {
    light: {
        surface: {
            canvas: primitive.gray[50],
            raised: primitive.gray[100],
            overlay: '#FFFCF8',
            sunken: primitive.gray[200],
            inverse: primitive.gray[900],
        },
        text: {
            primary: primitive.gray[900],
            secondary: primitive.gray[600],
            tertiary: primitive.gray[400],
            onAccent: primitive.gray[50],
            onInverse: primitive.gray[50],
            link: primitive.accent[600],
            success: primitive.green[600],
            warning: primitive.amber[600],
            error: primitive.red[600],
        },
        border: {
            subtle: 'rgba(32, 25, 20, 0.06)',
            default: 'rgba(32, 25, 20, 0.12)',
            strong: 'rgba(32, 25, 20, 0.24)',
            focus: primitive.accent[500],
            error: primitive.red[400],
        },
        accent: {
            bg: primitive.accent[500],
            bgHover: primitive.accent[600],
            bgActive: primitive.accent[700],
            text: primitive.gray[50],
            tint: 'rgba(192, 98, 64, 0.09)',
        },
        status: {
            successBg: '#E2F9E2',
            warningBg: '#FFF1D9',
            errorBg: '#FFEBE8',
        },
        elevation: {
            raised: layeredShadow('#3A2A1C', 0.06, 1, 2, 1),
            overlay: layeredShadow('#3A2A1C', 0.10, 8, 20, 8),
        },
        hairline: false,
    },
    dark: {
        surface: {
            canvas: primitive.gray[950], // tinted near-black, not #000
            raised: '#1C1712',
            overlay: '#25211B',
            sunken: '#0A0704',
            inverse: primitive.gray[50],
        },
        text: {
            primary: '#EBE7E2', // not #fff — OLED halation
            secondary: primitive.gray[400],
            tertiary: primitive.gray[500],
            onAccent: primitive.gray[950],
            onInverse: primitive.gray[900],
            link: '#DC855D',
            success: '#7CB88A',
            warning: '#D4A44A',
            error: '#D46555',
        },
        border: {
            subtle: 'rgba(255, 248, 240, 0.06)',
            default: 'rgba(255, 248, 240, 0.12)',
            strong: 'rgba(255, 248, 240, 0.24)',
            focus: '#DC855D',
            error: primitive.red[400],
        },
        accent: {
            bg: '#DC855D', // chroma down vs light
            bgHover: primitive.accent[400],
            bgActive: primitive.accent[300],
            text: primitive.gray[950],
            tint: 'rgba(220, 133, 93, 0.12)',
        },
        status: {
            successBg: 'rgba(54, 136, 77, 0.18)',
            warningBg: 'rgba(187, 136, 26, 0.18)',
            errorBg: 'rgba(189, 57, 49, 0.18)',
        },
        elevation: {
            raised: layeredShadow('#000000', 0, 0, 0, 0),
            overlay: layeredShadow('#000000', 0, 0, 0, 0),
        },
        hairline: true, // dark: 1px border ring instead of drop shadow
    },
} as const;

/** Layer 3 — only for multi-state controls already in the app. */
export const component = {
    button: {
        radius: radius.md,
        paddingX: space.md,
        paddingY: 12,
        minHeight: 44,
    },
    input: {
        radius: radius.md,
        paddingX: 14,
        paddingY: 10,
        minHeight: 44,
    },
    card: {
        radius: radius.lg,
        padding: space.md,
    },
    search: {
        radius: radius.lg,
    },
} as const;

export type Semantic = (typeof semantic)['light'];

export function palette(mode: ColorMode): Semantic {
    return semantic[mode] as Semantic;
}

export function displayType(): TextStyle {
    return {
        fontSize: type.size.display,
        fontWeight: type.weight.semibold,
        letterSpacing: type.tracking.display * type.size.display,
        lineHeight: Math.round(type.size.display * type.leading.tight),
    };
}

export function bodyType(): TextStyle {
    return {
        fontSize: type.size.md,
        fontWeight: type.weight.regular,
        lineHeight: Math.round(type.size.md * type.leading.body),
    };
}
