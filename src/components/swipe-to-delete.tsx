import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { usePalette } from '@/theme/use-palette';

/** Swipe-left-to-reveal delete row (Task 28) — replaces the old long-press-to-delete gesture. */
export function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
    const t = usePalette();
    const ref = useRef<Swipeable>(null);

    return (
        <Swipeable
            ref={ref}
            overshootRight={false}
            rightThreshold={40}
            renderRightActions={() => (
                <Pressable
                    style={[styles.action, { backgroundColor: t.status.errorBg }]}
                    onPress={() => { ref.current?.close(); onDelete(); }}
                    accessibilityRole="button"
                    accessibilityLabel="Xoá"
                >
                    <Text style={[styles.actionText, { color: t.text.error }]}>Xoá</Text>
                </Pressable>
            )}
        >
            {children}
        </Swipeable>
    );
}

const styles = StyleSheet.create({
    action: { width: 76, alignItems: 'center', justifyContent: 'center' },
    actionText: { fontSize: 14, fontWeight: '600' },
});
