/**
 * GlassTabBar — floating glass pill with a teal glow on the active tab.
 *
 * Built on expo-router/ui's headless tabs (`TabTrigger asChild`), NOT the old
 * React Navigation `tabBar` render-prop — expo-router 56 dropped that in
 * favour of this composable model, so each tab is its own `<TabTrigger>`
 * wrapping a `<TabItem>`, rather than one component mapping over `state.routes`.
 * See app/(tabs)/_layout.tsx for how this plugs into <Tabs>/<TabList>/<TabSlot>.
 *
 * The pill itself follows the app's light/dark theme (via
 * `useEffectiveColorScheme()`) rather than staying fixed-dark like the
 * reference screenshot — dark glass with a light glow on the dark canvas,
 * light glass with a deeper teal on the light canvas — recoloured either way
 * from the screenshot's generic blue to the app's own brand teal.
 *
 * The glow is two stacked effects, because a single shadow reads as flat:
 *   1. a rounded tint filling the active tab's cell, behind icon + label
 *   2. a hairline gradient streak along the top edge of the pill
 * (A third effect — a coloured shadow on the glyph itself — existed in the
 * original Ionicons version via `textShadow*`, but lucide icons are SVG, not
 * text, so that style is invalid here; dropped rather than faked.)
 */
import { TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { BlurView, type BlurTint } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icons } from './dict-ui';
import { primitive, type ColorMode } from '@/theme/tokens';
import { useEffectiveColorScheme } from '@/theme/use-palette';

/** Per-theme glass recipe — dark glass + light glow on the dark canvas, light glass + deeper teal on the light canvas. */
const GLASS: Record<ColorMode, {
    active: string; inactive: string; pill: string; border: string;
    streak: string; activeBg: string; blurTint: BlurTint;
}> = {
    dark: {
        active: primitive.accent[400], // pops on the dark pill
        inactive: primitive.gray[400],
        pill: 'rgba(11, 25, 23, 0.92)', // primitive.gray[950], glassed
        border: 'rgba(255,255,255,0.14)',
        streak: 'rgba(63,175,160,0.85)',
        // Nền của nút đang chọn. Trước là vòng tròn 44px sau icon nên phải đậm
        // mới thấy; giờ phủ cả ô 1/4 nên cùng độ mờ đó lại quá gắt — hạ xuống.
        activeBg: 'rgba(63,175,160,0.18)',
        blurTint: 'dark',
    },
    light: {
        active: primitive.accent[600], // COLORS.md `accentText` — tuned for contrast on light
        inactive: primitive.gray[600],
        pill: 'rgba(255, 255, 255, 0.78)',
        border: 'rgba(10, 40, 38, 0.14)',
        streak: 'rgba(14,143,134,0.7)',
        activeBg: 'rgba(14,143,134,0.13)',
        blurTint: 'light',
    },
};

type Glyph = (typeof Icons)[keyof typeof Icons];

/** route name → label + icon, in tab-bar order. Keep in sync with app/(tabs)/_layout.tsx. */
const TABS: { name: string; label: string; icon: Glyph }[] = [
    { name: 'index', label: 'Tra cứu', icon: Icons.Search },
    { name: 'my-words', label: 'Từ của tôi', icon: Icons.Bookmark },
    { name: 'review', label: 'Ôn tập', icon: Icons.Layers },
    { name: 'settings', label: 'Cài đặt', icon: Icons.Settings },
];

export function GlassTabBar() {
    const insets = useSafeAreaInsets();
    const mode = useEffectiveColorScheme();
    const g = GLASS[mode];

    return (
        <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
            <View style={[styles.pill, { borderColor: g.border }]}>
                <BlurView intensity={40} tint={g.blurTint} style={StyleSheet.absoluteFill} />
                <View style={[styles.pillTint, { backgroundColor: g.pill }]} />

                {/* top-edge light streak */}
                <LinearGradient
                    colors={['rgba(255,255,255,0)', g.streak, 'rgba(255,255,255,0)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.topStreak}
                />

                <View style={styles.row}>
                    {TABS.map((tab) => (
                        <TabTrigger key={tab.name} name={tab.name} asChild>
                            <TabItem label={tab.label} icon={tab.icon} colors={g} />
                        </TabTrigger>
                    ))}
                </View>
            </View>
        </View>
    );
}

/**
 * Rendered as the `asChild` target of a `TabTrigger`, which clones this
 * element with `isFocused`/`onPress`/`onLongPress` merged in — everything
 * else (the bounce + glow animation) is this component's own.
 */
function TabItem({ label, icon: Icon, colors, isFocused, ...triggerProps }: TabTriggerSlotProps & {
    label: string; icon: Glyph; colors: (typeof GLASS)[ColorMode];
}) {
    const focused = !!isFocused;
    // Animate the glow instead of toggling it: an instant on/off makes the
    // bar feel like it's blinking rather than lighting up.
    const glow = useRef(new Animated.Value(focused ? 1 : 0)).current;
    const press = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.timing(glow, {
            toValue: focused ? 1 : 0,
            duration: 220,
            useNativeDriver: true,
        }).start();
    }, [focused]);

    const bounce = (to: number) =>
        Animated.spring(press, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

    return (
        <Pressable
            {...triggerProps}
            style={styles.item}
            onPressIn={() => bounce(0.9)}
            onPressOut={() => bounce(1)}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
        >
            {/*
              Nền của nút đang chọn: phủ hết ô 1/4 và bọc cả icon + nhãn.
              Nằm ngoài Animated.View co giãn bên dưới, nếu không nó sẽ nhỏ
              lại theo hiệu ứng nhấn và trông như nền bị rung.
              Không scale từ 0 mà từ 0.86: một khối rộng phóng từ 0 nhìn như
              bị bắn vào, còn 0.86 chỉ là nở nhẹ ra.
            */}
            <Animated.View
                pointerEvents="none"
                style={[styles.activeBg, {
                    backgroundColor: colors.activeBg,
                    opacity: glow,
                    transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
                }]}
            />
            <Animated.View style={{ transform: [{ scale: press }], alignItems: 'center' }}>
                <Icon
                    size={22}
                    color={focused ? colors.active : colors.inactive}
                    strokeWidth={focused ? 2.25 : 1.75}
                />
                <Text
                    numberOfLines={1}
                    style={[styles.label, { color: focused ? colors.active : colors.inactive, fontWeight: focused ? '600' : '400' }]}
                >
                    {label}
                </Text>
            </Animated.View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        paddingHorizontal: 16,
        backgroundColor: 'transparent',
    },
    pill: {
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        // outer drop shadow so the bar floats above content
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOpacity: 0.45,
                shadowRadius: 20,
                shadowOffset: { width: 0, height: 10 },
            },
            android: { elevation: 16 },
        }),
    },
    // BlurView alone doesn't reliably read as opaque enough on its own; this
    // solid (themed) tint on top keeps the bar legible either way.
    pillTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    topStreak: {
        position: 'absolute',
        top: 0, left: '12%', right: '12%',
        height: 1.5,
    },
    row: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6 },
    item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 },
    // Phủ hết ô (flex:1 nên đúng 1/4 chiều ngang), chừa 3px mỗi bên để hai nút
    // cạnh nhau không dính vào nhau. borderRadius 16 trên ô cao ~52 cho ra
    // hình chữ nhật bo tròn — không phải hình viên thuốc dài.
    activeBg: {
        position: 'absolute',
        top: 0, bottom: 0, left: 3, right: 3,
        borderRadius: 16,
    },
    label: { fontSize: 10.5, marginTop: 4, letterSpacing: 0.2 },
});

/**
 * Bottom padding screens need so their last row isn't hidden behind the
 * floating bar. Hard-coding a number in each screen would drift the moment
 * the bar's height changes.
 */
export const TAB_BAR_HEIGHT = 80;
