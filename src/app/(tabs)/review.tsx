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
import { useReviewSession, type ReviewMode } from '@/stores/review-session';
import { usePalette } from '@/theme/use-palette';
import { useTabBarSpace } from '@/components/glass-tab-bar';
import type { Semantic } from '@/theme/tokens';

export default function ReviewStartScreen() {
    const t = usePalette();
    const tabSpace = useTabBarSpace();
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
    // dueBoxCounts() bỏ qua thẻ mới, nên khi tất cả đều mới thì cả 5 cột đều 0
    // và đồ thị vẽ ra năm cái gạch cao bằng nhau ở đáy — nhìn hệt như "có đều
    // ở cả 5 mức" trong khi thật ra là chưa có gì. Không có dữ liệu thì đừng vẽ.
    const hasBoxes = boxes.some((n) => n > 0);
    return (
        <SafeAreaView style={[s.root, { paddingBottom: tabSpace }]} edges={['top']}>
            {/* Cụm thao tác chiếm phần trên và tự căn giữa trong đó; khối hướng
                dẫn nằm ngoài nên luôn neo đáy. Nhét tất cả vào một cột căn giữa
                thì phần hướng dẫn đẩy mọi thứ lên, để lại một mảng trống to ở
                trên và chính nó thì lửng lơ giữa màn. */}
            <View style={s.hero}>
            <Text style={s.big}>{dueCount}</Text>
            <Text style={s.secondaryText}>thẻ đến hạn hôm nay</Text>
            {hasBoxes && (
                <>
                    <View style={s.bars}>
                        {boxes.map((n, i) => (
                            <View key={i} style={s.barCol}>
                                <View style={[s.bar, { height: 8 + (n / maxBox) * 36 }]} />
                                <Text style={s.barLabel}>{i + 1}</Text>
                            </View>
                        ))}
                    </View>
                    <Text style={s.caption}>Mức nhớ 1–5 · càng cao càng lâu mới phải ôn lại</Text>
                </>
            )}
            <View style={[s.rowGap, { marginTop: 20 }]}>
                <ModeChip label="Từ → Nghĩa" active={mode === 'word2meaning'} onPress={() => setMode('word2meaning')} s={s} />
                <ModeChip label="Nghĩa → Từ" active={mode === 'meaning2word'} onPress={() => setMode('meaning2word')} s={s} />
                <ModeChip label="Nghe → Từ" active={mode === 'listen'} onPress={() => setMode('listen')} s={s} />
            </View>
            {/* Chỉ giải thích chế độ ĐANG chọn: ba dòng cùng lúc là ba dòng để
                đọc lướt rồi bỏ qua, một dòng đúng lúc thì người ta đọc. */}
            <Text style={s.caption}>{MODE_HINT[mode]}</Text>
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
            </View>

            {/* Ba điều người dùng không đoán ra được từ giao diện: vì sao số thẻ
                mỗi ngày mỗi khác, vì sao một từ hiện lại mấy lần trong cùng phiên,
                và chấm sai thì mất gì. Đúng ba dòng, không kể thêm. */}
            <View style={s.guide}>
                <Text style={s.guideTitle}>Cách ôn tập</Text>
                <Text style={s.guideLine}>
                    Mỗi thẻ chỉ hiện lại khi bạn sắp quên. Nhớ càng chắc, khoảng cách càng dài.
                </Text>
                <Text style={s.guideLine}>
                    Từ mới phải đúng 2 lần trong cùng một phiên mới được tính là thuộc, nên nó
                    sẽ quay lại vài lần.
                </Text>
                <Text style={s.guideLine}>
                    Lật thẻ rồi chấm thật. Chấm “Chưa nhớ” không mất gì — thẻ chỉ quay lại sớm hơn.
                </Text>
            </View>
        </SafeAreaView>
    );
}

const MODE_HINT: Record<ReviewMode, string> = {
    word2meaning: 'Hiện từ trước, bạn nhớ lại nghĩa.',
    meaning2word: 'Hiện nghĩa trước, bạn nhớ lại từ.',
    listen: 'Chỉ phát âm thanh, bạn đoán từ.',
};

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
        root: {
            flex: 1, backgroundColor: t.surface.canvas,
            paddingHorizontal: 24, // paddingBottom: useTabBarSpace(), gán ở chỗ dùng
        },
        hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
        caption: { fontSize: 12, color: t.text.tertiary, marginTop: 10, textAlign: 'center' },
        // Căn trái trong một khối hẹp: chữ căn giữa nhiều dòng thì mắt phải dò
        // lại điểm bắt đầu ở mỗi dòng.
        guide: { marginBottom: 8, gap: 7 },
        guideTitle: {
            fontSize: 11, fontWeight: '600', color: t.text.tertiary,
            letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2,
        },
        guideLine: { fontSize: 13, lineHeight: 19, color: t.text.secondary },
    });
}
