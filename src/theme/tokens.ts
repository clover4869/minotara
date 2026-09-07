/**
 * Minotara token spine — Teal Cow preset (derived from assets/icons/icon.png +
 * assets/icons/COLORS.md, the icon's own documented brand palette).
 * 3 layers: primitive → semantic → component.
 * Dark mode has no source spec (COLORS.md is light-only) — those values are
 * derived by the same "lighten + keep hue" pattern the previous preset used.
 */
import type { TextStyle, ViewStyle } from 'react-native';

export type ColorMode = 'light' | 'dark';

/** Layer 1 — named for the value, not the role. */
export const primitive = {
    gray: {
        50: '#FCFEFE',
        100: '#EEF7F5', // COLORS.md `soft`
        200: '#D6E7E5', // COLORS.md `border`
        300: '#BFD8D5',
        400: '#7E9694', // COLORS.md `muted`
        500: '#5F7876',
        600: '#4C6663', // COLORS.md `secondary`
        700: '#39504D',
        800: '#1F3532',
        900: '#122624',
        950: '#0B1917',
    },
    accent: {
        50: '#EAF7F5',
        100: '#D2EEEA',
        200: '#A8DDD5',
        300: '#79C9BE',
        400: '#3FAFA0',
        500: '#0E8F86', // COLORS.md `accent`
        600: '#0A6B64', // COLORS.md `accentText`
        700: '#0F5F5C', // COLORS.md `primary`
        800: '#0A423F',
        900: '#062E2C',
    },
    /** From the question-mark mat in the icon — not in COLORS.md, sampled from icon.png. Used for success/"remembered" instead of a generic gray-green. */
    green: { 400: '#9BD66E', 600: '#5DA84D' },
    /** Nudged toward COLORS.md `brandYellow` (#F8C140, the book's cover). */
    amber: { 400: '#FFD874', 600: '#D9A72A' },
    red: { 400: '#D46555', 600: '#BD3931' },
    /** COLORS.md `brandOrange` — reserved for future badges/highlights (cow/book accent), not wired into semantic yet. */
    orange: { 500: '#EA8336' },
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
    md: 10, // inputs, badges
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
            overlay: '#FFFFFF',
            sunken: primitive.gray[200],
            inverse: primitive.accent[700], // primary buttons/active chips — COLORS.md `primary`, not neutral black
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
            subtle: 'rgba(10, 40, 38, 0.06)',
            default: 'rgba(10, 40, 38, 0.12)',
            strong: 'rgba(10, 40, 38, 0.24)',
            focus: primitive.accent[500],
            error: primitive.red[400],
        },
        accent: {
            bg: primitive.accent[500],
            bgHover: primitive.accent[600],
            bgActive: primitive.accent[700],
            text: primitive.gray[50],
            tint: 'rgba(14, 143, 134, 0.09)',
        },
        status: {
            successBg: '#E6F5DC',
            warningBg: '#FFF3D6',
            errorBg: '#FFEBE8',
        },
        elevation: {
            raised: layeredShadow('#0A2422', 0.06, 1, 2, 1),
            overlay: layeredShadow('#0A2422', 0.10, 8, 20, 8),
        },
        hairline: false,
    },
    dark: {
        surface: {
            canvas: primitive.gray[950],
            raised: '#132825',
            overlay: '#1A302D',
            sunken: '#060F0E',
            inverse: '#6CC6BD', // COLORS.md `brandTeal` itself — the icon's signature color, popping on a dark canvas
        },
        text: {
            primary: '#E4F3F0', // not pure white — OLED halation
            secondary: primitive.gray[400],
            tertiary: primitive.gray[500],
            onAccent: primitive.gray[950],
            onInverse: primitive.accent[900],
            link: '#5CC9BC',
            success: primitive.green[400],
            warning: primitive.amber[400],
            error: primitive.red[400],
        },
        border: {
            subtle: 'rgba(228, 243, 240, 0.06)',
            default: 'rgba(228, 243, 240, 0.12)',
            strong: 'rgba(228, 243, 240, 0.24)',
            focus: '#5CC9BC',
            error: primitive.red[400],
        },
        accent: {
            bg: '#4FC1B4', // distinct from surface.inverse's brighter brandTeal, so links/small accents read differently from big CTA buttons
            bgHover: primitive.accent[300],
            bgActive: primitive.accent[200],
            text: primitive.gray[950],
            tint: 'rgba(79, 193, 180, 0.12)',
        },
        status: {
            successBg: 'rgba(93, 168, 77, 0.18)',
            warningBg: 'rgba(217, 167, 42, 0.18)',
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
