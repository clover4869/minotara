/**
 * Câu trắc nghiệm — dùng chung cho phiên ôn tập (app/review-session.tsx) và
 * màn làm bài của báo thức (app/alarm-session.tsx). Hai chỗ hỏi cùng một kiểu
 * câu, nên phải là cùng một đoạn code: để hai bản song song thì chỉ cần một
 * lần sửa lệch nhịp là hai chỗ tô màu đáp án khác nhau.
 *
 * Component này không biết gì về hàng đợi hay chấm điểm — nó nhận một câu hỏi,
 * báo ra đáp án được chọn, hết. Chuyện lúc nào sang câu kế do màn hình quyết
 * định (mỗi màn có nhịp riêng).
 */
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import type { QuizQuestion } from '@/services/quiz';
import { usePalette } from '@/theme/use-palette';
import { FONT_MULT, useApp } from '@/stores/app';
import type { Semantic } from '@/theme/tokens';

export function QuizCard({ question, picked, onPick }: {
    question: QuizQuestion | null;
    /** key đáp án đã chọn; có giá trị nghĩa là đang ở trạng thái đã lộ đáp án. */
    picked: string | null;
    onPick: (key: string) => void;
}) {
    const t = usePalette();
    const fs = FONT_MULT[useApp((st) => st.fontScale)];
    const s = makeStyles(t, fs);

    if (!question) {
        return (
            <View style={s.center}><ActivityIndicator size="large" color={t.accent.bg} /></View>
        );
    }

    const reveal = picked !== null;
    return (
        <ScrollView contentContainerStyle={s.scroll}>
            <Text style={s.word}>{question.headword}</Text>
            {question.ipa ? <Text style={s.ipa}>{question.ipa}</Text> : null}

            {/* Hàng ảnh giữ chiều cao cố định kể cả khi chưa tải xong hoặc
                không có ảnh: ảnh về muộn mà làm cụm đáp án tụt xuống thì ngón
                tay đang chạm sẽ trúng nhầm ô. Thà chừa chỗ trống. */}
            <View style={s.images}>
                {(question.images ?? []).map((u) => (
                    <View key={u} style={s.imgCell}>
                        <ExpoImage source={{ uri: u }} style={{ flex: 1 }} contentFit="cover" />
                    </View>
                ))}
            </View>

            <Text style={s.prompt}>Nghĩa nào đúng?</Text>
            {question.choices.map((c) => {
                // Lộ đáp án thì tô xanh ô ĐÚNG (dù không chọn nó) và tô đỏ ô
                // vừa chọn nếu sai — người dùng cần thấy đáp án đúng là gì,
                // không chỉ thấy mình sai.
                const tone = !reveal ? null
                    : c.correct ? 'right'
                    : picked === c.key ? 'wrong'
                    : null;
                return (
                    <Pressable
                        key={c.key}
                        onPress={() => onPick(c.key)}
                        disabled={reveal}
                        accessibilityRole="button"
                        style={[
                            s.choice,
                            tone === 'right' && { backgroundColor: t.status.successBg, borderColor: t.text.success },
                            tone === 'wrong' && { backgroundColor: t.status.errorBg, borderColor: t.text.error },
                        ]}
                    >
                        <Text style={[
                            s.choiceText,
                            tone === 'right' && { color: t.text.success },
                            tone === 'wrong' && { color: t.text.error },
                        ]}>{c.text}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

function makeStyles(t: Semantic, fs: number) {
    return StyleSheet.create({
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
        scroll: { padding: 16, paddingBottom: 32, alignItems: 'stretch' },
        word: { fontSize: 34 * fs, fontWeight: '700', textAlign: 'center', color: t.text.primary },
        ipa: { fontSize: 15 * fs, color: t.text.secondary, textAlign: 'center', marginTop: 4 },
        images: { flexDirection: 'row', gap: 8, justifyContent: 'center', height: 120, marginTop: 14 },
        imgCell: { width: 120, height: 120, borderRadius: 12, overflow: 'hidden', backgroundColor: t.surface.raised },
        prompt: { fontSize: 13, color: t.text.tertiary, marginTop: 20, marginBottom: 10, textAlign: 'center' },
        choice: {
            borderWidth: 1, borderColor: t.border.default, borderRadius: 12,
            paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
            backgroundColor: t.surface.raised,
        },
        choiceText: { fontSize: 15 * fs, lineHeight: 21 * fs, color: t.text.primary },
    });
}
