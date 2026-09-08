/**
 * Văn bản đọc được trong màn chi tiết: chọn-copy được (long-press) và
 * double-tap vào một từ thì mở luôn màn chi tiết của từ đó.
 *
 * Mỗi từ là một <Text> lồng — trên Android cả cụm vẫn render thành MỘT
 * TextView với các span, không phải mỗi từ một view, nên định nghĩa dài
 * mấy chục từ không làm cây view phình ra.
 *
 * Double-tap tự đếm bằng ref thay vì GestureDetector: chỉ cần "hai lần
 * onPress trên cùng token trong 350ms", kéo gesture-handler vào đây là
 * thừa. Tap đơn cố tình không làm gì — chạm hờ khi đang đọc mà nhảy màn
 * thì phiền hơn là tiện.
 */
import { useRef } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { router } from 'expo-router';

import { splitWords, normalizeWord } from '@/services/tokenize';

const DOUBLE_TAP_MS = 350;

export function TappableText({ children, style, ignore }: {
    children: string;
    style?: StyleProp<TextStyle>;
    /** Headword của màn đang mở — double-tap đúng nó thì bỏ qua, đỡ push một màn trùng lên stack. */
    ignore?: string;
}) {
    const last = useRef({ i: -1, t: 0 });
    const parts = splitWords(children);
    return (
        <Text style={style} selectable>
            {parts.map((p, i) => {
                if (i % 2 === 0) return p; // đoạn ngoài-từ: trả chuỗi trần, không tốn span
                const onPress = () => {
                    const now = Date.now();
                    if (last.current.i === i && now - last.current.t < DOUBLE_TAP_MS) {
                        last.current = { i: -1, t: 0 };
                        const w = normalizeWord(p);
                        if (w && w !== (ignore ?? '').toLowerCase()) {
                            router.push(`/word/${encodeURIComponent(w)}`);
                        }
                    } else {
                        last.current = { i, t: now };
                    }
                };
                return (
                    <Text key={i} onPress={onPress} suppressHighlighting>
                        {p}
                    </Text>
                );
            })}
        </Text>
    );
}
