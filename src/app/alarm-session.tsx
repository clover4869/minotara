/**
 * Màn làm bài của báo thức — KHÔNG CÓ LỐI RA.
 *
 * Không nút ✕, không nút Bỏ qua, nút Back vật lý bị nuốt. Cách duy nhất để
 * màn này biến mất là trả lời đúng đủ số câu đã đặt.
 *
 * Phải nói thẳng giới hạn của "không có lối ra": nó chỉ đúng TRONG app.
 * Android không cho app thường chặn nút Home, nên người dùng luôn thoát ra
 * được — chặn Home cần quyền Device Owner (chỉ đặt được lúc factory reset)
 * hoặc Screen Pinning (người dùng tự bật, và tự thoát được). Cái màn này làm
 * được việc là nhờ không có lối ra *tiện tay*, không phải nhờ giam giữ.
 *
 * Vì không có lối ra, mọi nhánh hỏng đều phải dẫn tới một câu trả lời được
 * hoặc tới trạng thái xong — không bao giờ tới màn hình trắng. Xem
 * stores/alarm-session.ts.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
    ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, Vibration, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { openUser } from '@/db/open';
import { getAlarm } from '@/db/user';
import { QuizCard } from '@/components/quiz-card';
import { useAlarmSession } from '@/stores/alarm-session';
import { useApp, FONT_MULT } from '@/stores/app';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

/** Chọn đúng rồi thì đi tiếp nhanh; chọn sai thì nán lại đủ lâu để ĐỌC được
 *  đáp án đúng vừa lộ ra — sai mà lướt qua ngay thì không học được gì. */
const ADVANCE_MS_CORRECT = 900;
const ADVANCE_MS_WRONG = 2400;

export default function AlarmSessionScreen() {
    const t = usePalette();
    const fs = FONT_MULT[useApp((st) => st.fontScale)];
    const s = useMemo(() => makeStyles(t, fs), [t, fs]);

    const kind = useAlarmSession((st) => st.kind);
    const target = useAlarmSession((st) => st.target);
    const correct = useAlarmSession((st) => st.correct);
    const done = useAlarmSession((st) => st.done);
    const loading = useAlarmSession((st) => st.loading);
    const card = useAlarmSession((st) => st.card);
    const flipped = useAlarmSession((st) => st.flipped);
    const question = useAlarmSession((st) => st.question);
    const picked = useAlarmSession((st) => st.picked);
    const begin = useAlarmSession((st) => st.begin);
    const flip = useAlarmSession((st) => st.flip);
    const answerReview = useAlarmSession((st) => st.answerReview);
    const pick = useAlarmSession((st) => st.pick);
    const next = useAlarmSession((st) => st.next);
    const teardown = useAlarmSession((st) => st.teardown);

    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        (async () => {
            const cfg = await getAlarm(await openUser());
            await begin(cfg);
        })();
    }, [begin]);

    useEffect(() => () => teardown(), [teardown]);

    // Nuốt nút Back trong suốt phiên. Bỏ chặn ngay khi xong để nút Back lại
    // hoạt động bình thường ở màn kết quả.
    useEffect(() => {
        if (done) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
        return () => sub.remove();
    }, [done]);

    // Trắc nghiệm: chọn xong thì tự sang câu kế. Đặt hẹn giờ ở màn hình chứ
    // không ở store — store không nên giữ timer mà nó không huỷ được khi màn
    // bị gỡ giữa chừng.
    useEffect(() => {
        if (!picked || done) return;
        const wasRight = question?.choices.find((c) => c.key === picked)?.correct;
        const id = setTimeout(() => next(), wasRight ? ADVANCE_MS_CORRECT : ADVANCE_MS_WRONG);
        return () => clearTimeout(id);
    }, [picked, done, question, next]);

    if (done) {
        return (
            <SafeAreaView style={s.center} edges={['top', 'bottom']}>
                <Text style={s.doneMark}>✓</Text>
                <Text style={s.doneTitle}>Đã tắt báo thức</Text>
                <Text style={s.doneSub}>Đúng {target} câu. Chúc một ngày tỉnh táo.</Text>
                <Pressable style={s.primaryBtn} onPress={() => router.replace('/')}>
                    <Text style={s.primaryBtnText}>Xong</Text>
                </Pressable>
            </SafeAreaView>
        );
    }

    const progress = correct / Math.max(1, target);

    return (
        <SafeAreaView style={s.root} edges={['top', 'bottom']}>
            <View style={s.topBar}>
                <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                <Text style={s.counter}>đúng {correct}/{target}</Text>
            </View>

            {loading || !card ? (
                <View style={s.center}><ActivityIndicator size="large" color={t.accent.bg} /></View>
            ) : kind === 'quiz' ? (
                <QuizCard question={question} picked={picked} onPick={(k) => { Vibration.vibrate(10); pick(k); }} />
            ) : (
                <ReviewBody
                    s={s} card={card} flipped={flipped}
                    onFlip={flip}
                    onAnswer={(ok) => { Vibration.vibrate(12); answerReview(ok); }}
                />
            )}
        </SafeAreaView>
    );
}

type Styles = ReturnType<typeof makeStyles>;

function ReviewBody({ s, card, flipped, onFlip, onAnswer }: {
    s: Styles;
    card: NonNullable<ReturnType<typeof useAlarmSession.getState>['card']>;
    flipped: boolean;
    onFlip: () => void;
    onAnswer: (correct: boolean) => void;
}) {
    return (
        <View style={s.cardArea}>
            <Pressable onPress={onFlip}>
                <View style={s.cardBox}>
                    <Text style={s.cardWord}>{card.headword}</Text>
                    {card.ipa ? <Text style={s.cardIpa}>{card.ipa}</Text> : null}
                    {flipped ? (
                        <>
                            <Text style={[s.cardDef, { marginTop: 14 }]}>{card.definition}</Text>
                            {card.example ? <Text style={s.cardExample}>{card.example}</Text> : null}
                        </>
                    ) : (
                        <Text style={s.tapHint}>Chạm để xem nghĩa</Text>
                    )}
                </View>
            </Pressable>
            <View
                style={[s.rowGap, !flipped && { opacity: 0 }]}
                pointerEvents={flipped ? 'auto' : 'none'}
                accessibilityElementsHidden={!flipped}
                importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'}
            >
                <Pressable style={[s.gradeBtn, s.gradeWrong]} onPress={() => onAnswer(false)}>
                    <Text style={[s.gradeText, s.gradeTextWrong]}>✕ Chưa nhớ</Text>
                </Pressable>
                <Pressable style={[s.gradeBtn, s.gradeRight]} onPress={() => onAnswer(true)}>
                    <Text style={[s.gradeText, s.gradeTextRight]}>✓ Đã nhớ</Text>
                </Pressable>
            </View>
        </View>
    );
}

function makeStyles(t: Semantic, fs: number) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface.canvas, padding: 24 },
        topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
        progressTrack: { flex: 1, height: 6, backgroundColor: t.surface.raised, borderRadius: 999, overflow: 'hidden' },
        progressFill: { height: 6, backgroundColor: t.accent.bg, borderRadius: 999 },
        counter: { color: t.text.secondary, fontSize: 13 },

        // Style của câu trắc nghiệm nằm trong components/quiz-card.tsx.
        cardArea: { flex: 1, justifyContent: 'center' },
        cardBox: {
            margin: 16, padding: 24, minHeight: 280, borderRadius: 16,
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
            alignItems: 'center', justifyContent: 'center',
        },
        cardWord: { fontSize: 30 * fs, fontWeight: '600', textAlign: 'center', color: t.text.primary },
        cardIpa: { fontSize: 15 * fs, color: t.text.secondary, marginTop: 6 },
        cardDef: { fontSize: 16 * fs, lineHeight: 23 * fs, textAlign: 'center', color: t.text.primary },
        cardExample: { fontSize: 13 * fs, color: t.text.secondary, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
        tapHint: { position: 'absolute', bottom: 14, fontSize: 12, color: t.text.tertiary },
        rowGap: { flexDirection: 'row', gap: 12, padding: 16 },
        gradeBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
        gradeWrong: { backgroundColor: t.status.errorBg },
        gradeRight: { backgroundColor: t.status.successBg },
        gradeText: { fontSize: 15, fontWeight: '600' },
        gradeTextWrong: { color: t.text.error },
        gradeTextRight: { color: t.text.success },

        doneMark: { fontSize: 56, color: t.text.success },
        doneTitle: { fontSize: 22, fontWeight: '700', color: t.text.primary, marginTop: 8 },
        doneSub: { fontSize: 14, color: t.text.secondary, marginTop: 6, textAlign: 'center' },
        primaryBtn: {
            marginTop: 28, backgroundColor: t.surface.inverse,
            paddingHorizontal: 40, paddingVertical: 13, borderRadius: 12,
        },
        primaryBtnText: { color: t.text.onInverse, fontSize: 15, fontWeight: '600' },
    });
}
