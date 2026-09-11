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
import { useImagePool } from '@/components/use-image-pool';
import { usePalette } from '@/theme/use-palette';
import { FONT_MULT, useApp } from '@/stores/app';
import type { Semantic } from '@/theme/tokens';

/** Tối đa bao nhiêu ảnh trong carousel — khớp CACHE_KEEP trong image-search. */
const MAX_QUIZ_IMAGES = 12;

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

            {/* Carousel vuốt ngang, giữ chiều cao cố định kể cả khi chưa tải
                xong hoặc không có ảnh: ảnh về muộn mà làm cụm đáp án tụt xuống
                thì ngón tay đang chạm sẽ trúng nhầm ô. Thà chừa chỗ trống. */}
            <View style={s.images}>
                <QuizImages urls={question.images ?? []} s={s} />
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

type Styles = ReturnType<typeof makeStyles>;

/**
 * Ảnh của câu hỏi: vuốt ngang xem hết, không phải hai ô tĩnh.
 *
 * Không có dấu chấm chỉ trang — mép ảnh kế tiếp đã hở ra sẵn ở rìa phải, tự
 * nó là lời mời vuốt; thêm hàng chấm chỉ là thêm thứ để nhìn giữa từ và bốn
 * đáp án.
 *
 * `pagingEnabled` chứ không cuộn tự do: dừng đúng từng ảnh thì vuốt bằng ngón
 * cái lúc đang đọc đáp án không để lại một ảnh nằm nửa vời.
 *
 * Link chết thì loại khỏi pool và ảnh dự phòng lên thay (useImagePool). Ở đây
 * KHÔNG truyền refetch: đang giữa phiên ôn, gọi thêm mạng để cứu một ảnh minh
 * hoạ không đáng — còn ba nghĩa và cả bốn đáp án vẫn nguyên.
 */
function QuizImages({ urls, s }: { urls: string[]; s: Styles }) {
    const pool = useImagePool(urls, MAX_QUIZ_IMAGES);
    if (!pool.visible.length) return null;
    return (
        <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.carousel}
        >
            {pool.visible.map((u) => (
                <View key={u} style={s.imgCell}>
                    <ExpoImage
                        source={{ uri: u }}
                        style={{ flex: 1 }}
                        contentFit="cover"
                        onError={() => pool.markDead(u)}
                    />
                </View>
            ))}
        </ScrollView>
    );
}

function makeStyles(t: Semantic, fs: number) {
    return StyleSheet.create({
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
        scroll: { padding: 16, paddingBottom: 32, alignItems: 'stretch' },
        word: { fontSize: 34 * fs, fontWeight: '700', textAlign: 'center', color: t.text.primary },
        ipa: { fontSize: 15 * fs, color: t.text.secondary, textAlign: 'center', marginTop: 4 },
        images: { height: 160, marginTop: 14 },
        // Hở 8px bên phải mỗi ảnh: mép ảnh kế tiếp lộ ra đủ để người dùng
        // biết còn ảnh nữa mà vuốt, không cần dấu chấm chỉ trang.
        carousel: { gap: 8, paddingHorizontal: 4 },
        imgCell: { width: 160, height: 160, borderRadius: 12, overflow: 'hidden', backgroundColor: t.surface.raised },
        prompt: { fontSize: 13, color: t.text.tertiary, marginTop: 20, marginBottom: 10, textAlign: 'center' },
        choice: {
            borderWidth: 1, borderColor: t.border.default, borderRadius: 12,
            paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
            backgroundColor: t.surface.raised,
        },
        choiceText: { fontSize: 15 * fs, lineHeight: 21 * fs, color: t.text.primary },
    });
}
