/**
 * SCR-05-A — Review start screen. Stays a normal tab (bottom nav works here).
 * Starting a session pushes into `review-session.tsx`, a full-screen modal
 * outside the tab bar — Task 22: the tab bar must not stay on screen during
 * an actual review, both to reclaim space and to remove an accidental exit.
 *
 * Chạm một trong hai lựa chọn là vào phiên luôn — không còn bước "chọn rồi
 * bấm Bắt đầu" riêng, và không còn chọn trước chiều hỏi (Từ→Nghĩa/Nghĩa→Từ/
 * Ảnh→Từ): mỗi thẻ trong phiên tự bốc ngẫu nhiên một chiều (xem `cardMode`
 * trong stores/review-session.ts). Sau khi bỏ ba chip chiều hỏi, thứ còn lại
 * để chọn trước chỉ là kind (thẻ lật/trắc nghiệm) — một lựa chọn duy nhất thì
 * bắt xác nhận thêm bằng nút riêng chỉ là một cú chạm thừa.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { openDictionary, openUser } from '@/db/open';
import { loadSrsStates, getStreak } from '@/db/user';
import { buildAheadSession, type SrsState } from '@/services/srs';
import { buildStudyPool } from '@/services/study-pool';
import { useReviewSession, type ReviewKind } from '@/stores/review-session';
import { usePalette } from '@/theme/use-palette';
import { useTabBarSpace } from '@/components/glass-tab-bar';
import { Icons, UiIcon } from '@/components/dict-ui';
import { space, radius } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

export default function ReviewStartScreen() {
    const t = usePalette();
    const tabSpace = useTabBarSpace();
    const s = makeStyles(t);
    const setKind = useReviewSession((st) => st.setKind);
    const loadPrefs = useReviewSession((st) => st.loadPrefs);
    const setAllStates = useReviewSession((st) => st.setAllStates);
    const begin = useReviewSession((st) => st.begin);

    const [allStates, setLocalStates] = useState<SrsState[]>([]);
    const [dueCount, setDueCount] = useState(0);
    const [aheadCount, setAheadCount] = useState(0);
    const [streak, setStreak] = useState(0);
    const [showTip, setShowTip] = useState(false);

    const refreshCounts = useCallback(async () => {
        const user = await openUser();
        const states = await loadSrsStates(user);
        setLocalStates(states);
        setAllStates(states);
        const now = new Date();
        const nowIso = now.toISOString();
        setDueCount(states.filter((st) => st.due_at <= nowIso).length);
        setAheadCount(buildAheadSession(states, now).length);
        setStreak(await getStreak(user));
    }, [setAllStates]);

    // Fires on mount AND every time this tab regains focus — covers coming
    // back from a finished/exited session pushed via router (the tab itself
    // never remounts, so a mount-only effect wouldn't catch that).
    useFocusEffect(useCallback(() => { refreshCounts(); }, [refreshCounts]));

    // Lựa chọn kind được lưu xuống DB, đọc lại một lần khi mở tab — trước đây
    // nó chỉ nằm trong bộ nhớ nên mở lại app là về mặc định.
    useEffect(() => { loadPrefs().catch(() => {}); }, [loadPrefs]);

    /*
      Nguồn từ tự xuống tầng: sổ từ → lịch sử tra cứu → từ hôm nay → ngẫu
      nhiên (services/study-pool.ts), nên luôn có bài. Trần 40 từ mỗi lượt —
      ba tầng sau gần như vô hạn, không có trần thì lượt học không bao giờ hết.
    */
    async function startWith(kind: ReviewKind) {
        setKind(kind);
        const pool = await buildStudyPool(await openDictionary(), await openUser(), allStates);
        if (!pool.items.length) return;
        await begin(pool.items);
        router.push('/review-session');
    }

    const dueLabel = dueCount > 0 ? `${dueCount} thẻ đến hạn`
        : aheadCount > 0 ? 'Ôn trước hạn' : 'Học từ mới';

    return (
        <SafeAreaView style={[s.root, { paddingBottom: tabSpace }]} edges={['top']}>
            <View style={s.statbar}>
                <View style={s.statItem}>
                    <UiIcon icon={Icons.Flame} size={14} color={t.text.warning} />
                    <Text style={s.statText}>{streak} ngày</Text>
                </View>
                <View style={s.statDivider} />
                <Text style={s.statTextStrong}>{dueLabel}</Text>
            </View>

            <View style={s.labelRow}>
                <Text style={s.label}>Chạm để bắt đầu</Text>
                <Pressable onPress={() => setShowTip((v) => !v)} style={s.tipBtn} hitSlop={8}>
                    <UiIcon icon={Icons.CircleHelp} size={13} color={t.text.tertiary} />
                </Pressable>
            </View>
            {showTip && (
                <View style={s.tip}>
                    <Text style={s.tipText}>
                        Mỗi thẻ chỉ hiện lại khi bạn sắp quên. Từ mới phải đúng 2 lần trong một
                        phiên mới tính là thuộc, nên nó sẽ quay lại vài lần.
                    </Text>
                </View>
            )}

            <View style={s.rows}>
                <Pressable style={s.row} onPress={() => startWith('card')}>
                    <UiIcon icon={Icons.Layers} size={22} color={t.accent.bg} />
                    <View style={{ flex: 1 }}>
                        <Text style={s.rowTitle}>Thẻ lật</Text>
                        <Text style={s.rowSub}>Mỗi thẻ một chiều khác nhau</Text>
                    </View>
                    <UiIcon icon={Icons.ChevronRight} size={16} color={t.text.tertiary} />
                </Pressable>
                <Pressable style={s.row} onPress={() => startWith('quiz')}>
                    <UiIcon icon={Icons.ListChecks} size={22} color={t.accent.bg} />
                    <View style={{ flex: 1 }}>
                        <Text style={s.rowTitle}>Trắc nghiệm</Text>
                        <Text style={s.rowSub}>Chọn nghĩa đúng trong 4</Text>
                    </View>
                    <UiIcon icon={Icons.ChevronRight} size={16} color={t.text.tertiary} />
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas, paddingHorizontal: space.md, paddingTop: space.md },
        statbar: {
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md,
            paddingBottom: space.sm, marginBottom: space.sm,
            borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border.default,
        },
        statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        statDivider: { width: StyleSheet.hairlineWidth, height: 13, backgroundColor: t.border.default },
        statText: { fontSize: 12, color: t.text.secondary },
        statTextStrong: { fontSize: 13, fontWeight: '600', color: t.text.primary },
        labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
        label: { fontSize: 12, color: t.text.tertiary },
        tipBtn: {
            width: 18, height: 18, borderRadius: radius.full, borderWidth: 1, borderColor: t.border.default,
            alignItems: 'center', justifyContent: 'center',
        },
        tip: { backgroundColor: t.surface.inverse, borderRadius: radius.md, padding: space.sm, marginBottom: space.sm },
        tipText: { fontSize: 12, lineHeight: 17, color: t.text.onInverse },
        rows: { gap: space.sm },
        row: {
            flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm + 4,
            borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
        },
        rowTitle: { fontSize: 13, fontWeight: '600', color: t.text.primary },
        rowSub: { fontSize: 10, color: t.text.tertiary },
    });
}
