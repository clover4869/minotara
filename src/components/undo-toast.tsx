import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePalette } from '@/theme/use-palette';

/**
 * Bottom-anchored "Đã xoá X · Hoàn tác" bar — pairs with usePendingDelete.
 * `bottomOffset` lets screens under the floating GlassTabBar clear it
 * instead of landing underneath it (default 16 matches bar-less screens).
 */
export function UndoToast({ label, onUndo, bottomOffset = 16 }: { label: string; onUndo: () => void; bottomOffset?: number }) {
    const t = usePalette();
    return (
        <View style={[styles.root, { backgroundColor: t.surface.inverse, bottom: bottomOffset }]}>
            <Text style={[styles.label, { color: t.text.onInverse }]} numberOfLines={1}>{label}</Text>
            <Pressable onPress={onUndo} hitSlop={8}>
                <Text style={[styles.undo, { color: t.accent.bg }]}>Hoàn tác</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        position: 'absolute', left: 16, right: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    },
    label: { flex: 1, fontSize: 14, marginRight: 12 },
    undo: { fontSize: 14, fontWeight: '600' },
});
