/**
 * SCR-05-B/C — Flashcard + results screens. Pushed as a full-screen modal
 * from (tabs)/review.tsx so the bottom tab bar is gone for the whole
 * session (Task 22) — the only way out is the ✕ button below, which still
 * persists whatever was graded so far.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { router } from 'expo-router';

import { maskHeadword } from '@/services/srs';
import { stopRepeat } from '@/services/audio';
import { useReviewSession } from '@/stores/review-session';
import { useApp, FONT_MULT } from '@/stores/app';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

function formatNext(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString() || d.toDateString() === today.toDateString()) {
        return 'vào ngày mai';
    }
    return d.toLocaleDateString('vi-VN');
}

export default function ReviewSessionScreen() {
    const t = usePalette();
    const fs = FONT_MULT[useApp((st) => st.fontScale)];
    const s = useMemo(() => makeStyles(t, fs), [t, fs]);

    const mode = useReviewSession((st) => st.mode);
    const phase = useReviewSession((st) => st.phase);
    const queue = useReviewSession((st) => st.queue);
    const card = useReviewSession((st) => st.card);
    const flipped = useReviewSession((st) => st.flipped);
    const answered = useReviewSession((st) => st.answered);
    const nextDue = useReviewSession((st) => st.nextDue);
    const cache = useReviewSession((st) => st.cache);
    const flipAction = useReviewSession((st) => st.flip);
    const answerAction = useReviewSession((st) => st.answer);
    const exitSession = useReviewSession((st) => st.exitSession);
    const retryMissed = useReviewSession((st) => st.retryMissed);
    const clearCache = useReviewSession((st) => st.clearCache);

    const flipAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        // Fresh card each time it changes: reset the flip animation.
        flipAnim.setValue(1);
    }, [card?.entry_id, flipAnim]);

    useEffect(() => {
        return () => {
            stopRepeat();
            clearCache(); // session over — next one starts with a clean cache (Task 8)
        };
    }, [clearCache]);

    function flip() {
        if (!card) return;
        Animated.sequence([
            Animated.timing(flipAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
            Animated.timing(flipAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
        ]).start();
        flipAction();
    }

    async function answer(correct: boolean) {
        Vibration.vibrate(12);
        await answerAction(correct);
    }

    async function exitEarly() {
        await exitSession();
        router.back();
    }

    if (phase === 'done' && queue) {
        const wrongIds = [...queue.missed];
        const wrong = wrongIds.length;
        const right = Math.max(0, queue.total - wrong);
        const nextLabel = nextDue
            ? `Lần ôn tiếp theo: ${nextDue.count} thẻ ${formatNext(nextDue.due_at)}`
            : 'Chưa có thẻ đến hạn tiếp theo';
        return (
            <SafeAreaView style={s.center} edges={['top']}>
                <Text style={s.big}>{queue.total ? Math.round((right / queue.total) * 100) : 0}%</Text>
                <Text style={s.secondaryText}>{right} đúng · {wrong} chưa nhớ</Text>
                <Text style={s.hintText}>{nextLabel}</Text>
                {wrong > 0 && (
                    <View style={{ marginTop: 16, alignItems: 'center', gap: 8 }}>
                        {wrongIds.slice(0, 8).map((id) => {
                            const c = cache.get(id);
                            if (!c) return null;
                            return (
                                <Pressable key={id} onPress={() => router.push({
                                    pathname: '/word/[q]', params: { q: c.headword, id: String(id) },
                                })}>
                                    <Text style={s.wrongWord}>{c.headword}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                    {wrong > 0 && (
                        <Pressable style={s.ghostBtn} onPress={retryMissed}>
                            <Text style={s.ghostBtnText}>Ôn tiếp thẻ sai</Text>
                        </Pressable>
                    )}
                    <Pressable style={s.primaryBtn} onPress={() => router.back()}>
                        <Text style={s.primaryBtnText}>Xong</Text>
                    </Pressable>
                </View>
            </SafeAreaView>
        );
    }

    if (!card || !queue) return null;
    const frontIsWord = mode === 'word2meaning';
    const maskedEx = card.example ? maskHeadword(card.example, card.headword) : null;
    /*
      Không dùng `total - remaining` nữa. Thẻ mới phải trả lời đúng 2 lần mới
      tốt nghiệp, chưa đủ thì SessionQueue đẩy nó lại cuối hàng đợi — nên
      `remaining` (số thẻ khác nhau còn lại) đứng yên suốt lượt đầu. Một phiên
      10 thẻ mới thì thanh nằm im ở 0/10 qua đúng 10 câu trả lời, nhìn như hỏng.

      `answered / (answered + remaining)`: mẫu số tự lớn ra khi phiên lộ dần
      lượng việc còn lại, nhưng tỉ lệ vẫn chỉ tăng — trả lời sai làm `remaining`
      +1 thì tử số cũng +1, mà tử số nhỏ hơn mẫu số nên giá trị vẫn nhích lên.
      Không bao giờ tụt lùi, và chạm đúng 100% khi hàng đợi rỗng.
    */
    const progress = answered / Math.max(1, answered + queue.remaining);

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <View style={s.topBar}>
                <Pressable onPress={exitEarly} hitSlop={10}><Text style={s.exitIcon}>✕</Text></Pressable>
                <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                {/* Số thẻ còn lại, không phải "đã xong/tổng": thẻ mới quay lại
                    nhiều lần nên "đã xong" tăng rất chậm và mâu thuẫn với thanh. */}
                <Text style={s.secondaryText}>còn {queue.remaining}</Text>
            </View>

            {/* Thẻ + hàng chấm điểm căn giữa phần còn lại của màn. Xếp thẳng
                từ trên xuống thì thẻ dính sát thanh tiến độ còn chỗ trống dồn
                hết xuống đáy. */}
            <View style={s.cardArea}>
            <Pressable onPress={flip}>
                <Animated.View style={[s.cardBox, { transform: [{ scale: flipAnim }] }]}>
                    {!flipped ? (
                        frontIsWord ? (
                            <>
                                <Text style={s.cardWord}>{card.headword}</Text>
                                {card.ipa ? <Text style={s.cardIpa}>{card.ipa}</Text> : null}
                                <Text style={s.tapHint}>Chạm để xem nghĩa</Text>
                            </>
                        ) : mode === 'image2word' ? (
                            <>
                                {card.images === undefined ? (
                                    <ActivityIndicator size="small" color={t.accent.bg} />
                                ) : card.images.length > 0 ? (
                                    <View style={s.imgGrid}>
                                        {/* % + aspectRatio đặt trên View bọc, ảnh flex:1 bên
                                            trong — đúng pattern lưới tab Ảnh đang chạy. Đặt
                                            width % thẳng lên ExpoImage thì ô có kích thước mà
                                            ảnh không vẽ (đã dính trên bản release New Arch). */}
                                        {card.images.map((u) => (
                                            <View key={u} style={s.imgCell}>
                                                <ExpoImage source={{ uri: u }} style={{ flex: 1 }} contentFit="cover" />
                                            </View>
                                        ))}
                                    </View>
                                ) : (
                                    // không có ảnh (offline / nguồn chặn / từ quá trừu tượng):
                                    // rơi về gợi ý bằng tai như thẻ nghe cũ, phiên không kẹt
                                    <>
                                        <Text style={{ fontSize: 32 }}>🔊</Text>
                                        <Text style={s.cardExample}>Không tải được ảnh — nghe phát âm và đoán</Text>
                                    </>
                                )}
                                <Text style={s.tapHint}>Chạm để xem từ</Text>
                            </>
                        ) : (
                            <>
                                <Text style={s.cardDef}>{card.definition}</Text>
                                {maskedEx ? <Text style={s.cardExample}>{maskedEx}</Text> : null}
                                <Text style={s.tapHint}>Chạm để xem từ</Text>
                            </>
                        )
                    ) : (
                        <>
                            <Text style={s.cardWord}>{card.headword}</Text>
                            {card.ipa ? <Text style={s.cardIpa}>{card.ipa}</Text> : null}
                            <Text style={[s.cardDef, { marginTop: 14 }]}>
                                {card.definition}
                                {card.isUserMeaning ? <Text style={s.userTag}>  · nghĩa của bạn</Text> : null}
                            </Text>
                            {card.dictDefinition ? <Text style={s.cardDictDef}>{card.dictDefinition}</Text> : null}
                            {card.example ? <Text style={s.cardExample}>{card.example}</Text> : null}
                            {card.forms ? <Text style={s.cardForms}>{card.forms}</Text> : null}
                            <Text style={s.tapHint}>Chạm để lật lại</Text>
                        </>
                    )}
                </Animated.View>
            </Pressable>

            {/* Luôn dựng hàng nút, chỉ ẩn đi khi chưa lật — không phải `flipped &&`.
                Bỏ hẳn ra khỏi cây thì lúc lật, hàng nút xuất hiện làm cụm cao
                thêm và thẻ bị đẩy nhảy lên. Ẩn bằng opacity thì chiều cao giữ
                nguyên nên thẻ đứng yên. Không dùng chiều cao cứng vì nút đổi cỡ
                theo cỡ chữ hệ thống. */}
            <View
                style={[s.rowGap, !flipped && { opacity: 0 }]}
                pointerEvents={flipped ? 'auto' : 'none'}
                accessibilityElementsHidden={!flipped}
                importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'}
            >
                <Pressable style={[s.gradeBtn, { backgroundColor: t.status.errorBg }]} onPress={() => answer(false)}>
                    <Text style={[s.gradeText, { color: t.text.error }]}>✕ Chưa nhớ</Text>
                </Pressable>
                <Pressable style={[s.gradeBtn, { backgroundColor: t.status.successBg }]} onPress={() => answer(true)}>
                    <Text style={[s.gradeText, { color: t.text.success }]}>✓ Đã nhớ</Text>
                </Pressable>
            </View>
            </View>
        </SafeAreaView>
    );
}

function makeStyles(t: Semantic, fs: number) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        cardArea: { flex: 1, justifyContent: 'center' },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface.canvas },
        big: { fontSize: 44, fontWeight: '600', color: t.text.primary },
        secondaryText: { color: t.text.secondary },
        hintText: { color: t.text.tertiary, marginTop: 10, fontSize: 13 },
        rowGap: { flexDirection: 'row', gap: 12, padding: 16, flexWrap: 'wrap', justifyContent: 'center' },
        primaryBtn: { marginTop: 20, backgroundColor: t.surface.inverse, paddingHorizontal: 36, paddingVertical: 13, borderRadius: 12 },
        primaryBtnText: { color: t.text.onInverse, fontSize: 15, fontWeight: '600' },
        ghostBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: t.border.default },
        ghostBtnText: { fontSize: 14, color: t.text.secondary, fontWeight: '600' },
        topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
        exitIcon: { fontSize: 18, color: t.text.primary },
        progressTrack: { flex: 1, height: 6, backgroundColor: t.surface.raised, borderRadius: 999, overflow: 'hidden' },
        progressFill: { height: 6, backgroundColor: t.accent.bg, borderRadius: 999 },
        cardBox: {
            margin: 16, padding: 24, minHeight: 300, borderRadius: 16,
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
            alignItems: 'center', justifyContent: 'center',
        },
        cardWord: { fontSize: 30 * fs, fontWeight: '600', textAlign: 'center', color: t.text.primary },
        cardIpa: { fontSize: 15 * fs, color: t.text.secondary, marginTop: 6 },
        cardDef: { fontSize: 16 * fs, lineHeight: 23 * fs, textAlign: 'center', color: t.text.primary },
        cardDictDef: { fontSize: 13 * fs, color: t.text.secondary, textAlign: 'center', marginTop: 8 },
        cardExample: { fontSize: 13 * fs, color: t.text.secondary, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
        cardForms: { fontSize: 12 * fs, color: t.text.tertiary, marginTop: 12 },
        // 2×2, mỗi ô vuông ~38% bề rộng thẻ: đủ nhận ra vật trong ảnh mà thẻ
        // không thành gallery; 4 ảnh cũng là số lượng prefetch của chế độ này.
        imgGrid: {
            flexDirection: 'row', flexWrap: 'wrap', gap: 8,
            justifyContent: 'center', alignSelf: 'stretch',
            // chừa chỗ cho tapHint (absolute, bottom 14) — không thì hàng ảnh
            // dưới đè lên chữ "Chạm để xem từ"
            marginBottom: 26,
        },
        imgCell: { width: '38%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: t.surface.raised },
        userTag: { fontSize: 11, color: t.text.warning },
        tapHint: { position: 'absolute', bottom: 14, fontSize: 12, color: t.text.tertiary },
        gradeBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
        gradeText: { fontSize: 15, fontWeight: '600' },
        wrongWord: { color: t.accent.bg, fontSize: 15 },
    });
}
