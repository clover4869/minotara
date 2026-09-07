/**
 * SCR-05-A — Review start screen. Stays a normal tab (bottom nav works here).
 * Starting a session pushes into `review-session.tsx`, a full-screen modal
 * outside the tab bar — Task 22: the tab bar must not stay on screen during
 * an actual review, both to reclaim space and to remove an accidental exit.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { openUser } from '@/db/open';
import { loadSrsStates } from '@/db/user';
import { buildSession, buildAheadSession, dueBoxCounts, type SrsState } from '@/services/srs';
import { useReviewSession } from '@/stores/review-session';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

export default function ReviewStartScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const mode = useReviewSession((st) => st.mode);
    const setMode = useReviewSession((st) => st.setMode);
    const setAllStates = useReviewSession((st) => st.setAllStates);
    const begin = useReviewSession((st) => st.begin);

    const statesRef = useRef<SrsState[]>([]);
    const [dueCount, setDueCount] = useState(0);
    const [aheadCount, setAheadCount] = useState(0);
    const [boxes, setBoxes] = useState([0, 0, 0, 0, 0]);

    const refreshCounts = useCallback(async () => {
        const states = await loadSrsStates(await openUser());
        statesRef.current = states;
        setAllStates(states);
        const now = new Date();
        const nowIso = now.toISOString();
        setDueCount(states.filter((st) => st.due_at <= nowIso).length);
        setAheadCount(buildAheadSession(states, now).length);
        setBoxes(dueBoxCounts(states, now));
    }, [setAllStates]);

    // Fires on mount AND every time this tab regains focus — covers coming
    // back from a finished/exited session pushed via router (the tab itself
    // never remounts, so a mount-only effect wouldn't catch that).
    useFocusEffect(useCallback(() => { refreshCounts(); }, [refreshCounts]));

    async function start() {
        await begin(buildSession(statesRef.current, new Date()));
        router.push('/review-session');
    }
    async function startAhead() {
        await begin(buildAheadSession(statesRef.current, new Date()));
        router.push('/review-session');
    }

    const maxBox = Math.max(1, ...boxes);
    return (
        <SafeAreaView style={s.center} edges={['top']}>
            <Text style={s.big}>{dueCount}</Text>
            <Text style={s.secondaryText}>thẻ đến hạn hôm nay</Text>
            <View style={s.bars}>
                {boxes.map((n, i) => (
                    <View key={i} style={s.barCol}>
                        <View style={[s.bar, { height: 8 + (n / maxBox) * 36 }]} />
                        <Text style={s.barLabel}>{i + 1}</Text>
                    </View>
                ))}
            </View>
            <View style={[s.rowGap, { marginTop: 20 }]}>
                <ModeChip label="Từ → Nghĩa" active={mode === 'word2meaning'} onPress={() => setMode('word2meaning')} s={s} />
                <ModeChip label="Nghĩa → Từ" active={mode === 'meaning2word'} onPress={() => setMode('meaning2word')} s={s} />
                <ModeChip label="Nghe → Từ" active={mode === 'listen'} onPress={() => setMode('listen')} s={s} />
            </View>
            <Pressable
                style={[s.primaryBtn, !dueCount && { opacity: 0.4 }]}
                disabled={!dueCount}
                onPress={start}
            >
                <Text style={s.primaryBtnText}>Bắt đầu</Text>
            </Pressable>
            {!dueCount && aheadCount > 0 && (
                <Pressable style={s.ghostBtn} onPress={startAhead}>
                    <Text style={s.ghostBtnText}>Ôn trước hạn · {aheadCount} thẻ</Text>
                </Pressable>
            )}
            {!dueCount && !aheadCount && (
                <Text style={s.hintText}>Lưu từ ở tab Tra cứu để có thẻ ôn</Text>
            )}
        </SafeAreaView>
    );
}

type Styles = ReturnType<typeof makeStyles>;

function ModeChip({ label, active, onPress, s }: { label: string; active: boolean; onPress: () => void; s: Styles }) {
    return (
        <Pressable onPress={onPress} style={[s.modeChip, active && s.modeChipActive]}>
            <Text style={[s.modeChipText, active && s.modeChipTextActive]}>{label}</Text>
        </Pressable>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface.canvas },
        big: { fontSize: 44, fontWeight: '600', color: t.text.primary },
        secondaryText: { color: t.text.secondary },
        hintText: { color: t.text.tertiary, marginTop: 10, fontSize: 13 },
        rowGap: { flexDirection: 'row', gap: 12, padding: 16, flexWrap: 'wrap', justifyContent: 'center' },
        primaryBtn: { marginTop: 20, backgroundColor: t.surface.inverse, paddingHorizontal: 36, paddingVertical: 13, borderRadius: 12 },
        primaryBtnText: { color: t.text.onInverse, fontSize: 15, fontWeight: '600' },
        ghostBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: t.border.default },
        ghostBtnText: { fontSize: 14, color: t.text.secondary, fontWeight: '600' },
        modeChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: t.border.default },
        modeChipActive: { backgroundColor: t.surface.inverse, borderColor: t.surface.inverse },
        modeChipText: { fontSize: 13, color: t.text.secondary },
        modeChipTextActive: { color: t.text.onInverse },
        bars: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginTop: 16, height: 56 },
        barCol: { alignItems: 'center', width: 22 },
        bar: { width: 14, backgroundColor: t.accent.bg, borderRadius: 4 },
        barLabel: { fontSize: 10, color: t.text.tertiary, marginTop: 4 },
    });
}
