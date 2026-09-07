/** Shared dictionary chrome: palette-aware icons, speaker, chips, CEFR. */
import { useState, type ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import {
    Volume2, Bookmark, BookmarkCheck, ArrowLeft, Search,
    History, X, BookOpen, CornerDownRight, ExternalLink,
    RotateCcw, ChevronDown, ChevronUp, Upload, CircleHelp,
    Square, SquareCheck, Trash2, Share2, Headphones, Type,
    Layers, Settings, CircleX, Check, FileDown, CircleAlert, SquarePen, Images,
} from 'lucide-react-native';
import { playUrl } from '@/services/audio';
import { icon as iconTokens, primitive } from '@/theme/tokens';
import { usePalette } from '@/theme/use-palette';

export const Icons = {
    Volume2, Bookmark, BookmarkCheck, ArrowLeft, Search,
    History, X, BookOpen, CornerDownRight, ExternalLink,
    RotateCcw, ChevronDown, ChevronUp, Upload, CircleHelp,
    Square, SquareCheck, Trash2, Share2, Headphones, Type,
    Layers, Settings, CircleX, Check, FileDown, CircleAlert, SquarePen, Images,
};

type Glyph = ComponentType<LucideProps>;

export function UiIcon({
    icon: Glyph,
    color,
    size = iconTokens.size.md,
    label,
}: {
    icon: Glyph;
    color?: string;
    size?: number;
    label?: string;
}) {
    const t = usePalette();
    return (
        <Glyph
            size={size}
            color={color ?? t.text.secondary}
            strokeWidth={iconTokens.stroke}
            accessibilityLabel={label}
        />
    );
}

export function IconButton({
    icon: Glyph,
    onPress,
    label,
    color,
    active,
}: {
    icon: Glyph;
    onPress: () => void;
    label: string;
    color?: string;
    active?: boolean;
}) {
    const t = usePalette();
    return (
        <Pressable
            onPress={onPress}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 4 })}
        >
            <UiIcon icon={Glyph} color={color ?? (active ? t.accent.bg : t.text.primary)} />
        </Pressable>
    );
}

export function Speaker({ url }: { url: string | null | undefined }) {
    const t = usePalette();
    const [busy, setBusy] = useState(false);
    const disabled = !url;
    return (
        <Pressable
            hitSlop={8}
            disabled={disabled || busy}
            accessibilityRole="button"
            accessibilityLabel={disabled ? 'Không có audio' : 'Phát âm'}
            accessibilityState={{ disabled }}
            onPress={async () => {
                setBusy(true);
                await playUrl(url);
                setBusy(false);
            }}
            style={{ opacity: disabled ? 0.28 : busy ? 0.45 : 1 }}
        >
            <UiIcon icon={Volume2} color={t.text.secondary} size={iconTokens.size.sm} />
        </Pressable>
    );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
    const t = usePalette();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: !!active }}
            style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                backgroundColor: active ? t.surface.inverse : 'transparent',
                borderWidth: active ? 0 : 1, borderColor: t.border.default,
                minHeight: 36, justifyContent: 'center',
            }}
        >
            <Text style={{ fontSize: 13, color: active ? t.text.onInverse : t.text.secondary }}>{label}</Text>
        </Pressable>
    );
}

export function CefrBadge({ level, size = 12 }: { level: string | null | undefined; size?: number }) {
    const t = usePalette();
    if (!level) return null;
    const tone: Record<string, { bg: string; fg: string }> = {
        A1: { bg: t.status.successBg, fg: t.text.success },
        A2: { bg: t.status.successBg, fg: t.text.success },
        B1: { bg: t.accent.tint, fg: primitive.accent[700] },
        B2: { bg: t.accent.tint, fg: primitive.accent[700] },
        C1: { bg: t.status.warningBg, fg: t.text.warning },
        C2: { bg: t.status.warningBg, fg: t.text.warning },
    };
    const c = tone[level] ?? { bg: t.surface.raised, fg: t.text.secondary };
    return (
        <Text style={{
            fontSize: size, fontWeight: '600', color: c.fg, backgroundColor: c.bg,
            paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
        }}>{level}</Text>
    );
}

export function SectionLabel({ children }: { children: string }) {
    const t = usePalette();
    return (
        <Text style={{ fontSize: 12, color: t.text.tertiary, letterSpacing: 0.3 }}>{children}</Text>
    );
}

export function Hairline() {
    const t = usePalette();
    return <View style={{ height: 0.5, backgroundColor: t.border.subtle }} />;
}

/** Signature: 5 ticks filling toward box 5 — not rainbow “Hộp n” pills. */
export function LeitnerLadder({ box, size = 7 }: { box: number; size?: number }) {
    const t = usePalette();
    const n = Math.min(5, Math.max(1, box || 1));
    return (
        <View
            accessibilityLabel={`Hộp Leitner ${n}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
        >
            {[1, 2, 3, 4, 5].map((i) => (
                <View
                    key={i}
                    style={{
                        width: size,
                        height: size + (i - 1),
                        borderRadius: 1.5,
                        backgroundColor: i <= n ? t.accent.bg : t.border.default,
                    }}
                />
            ))}
        </View>
    );
}
