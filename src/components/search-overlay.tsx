/**
 * Tra từ tiếp ngay trên màn chi tiết, không phải back về tab Tra cứu.
 *
 * Là một <Modal> phủ lên chứ không phải route mới: đóng lại là về đúng từ đang
 * đọc, và back stack không phình thêm một tầng chỉ để gõ chữ. Chọn một gợi ý
 * thì mới `push` — chuỗi otter → fish → river back ngược lại được, vì người học
 * hay đi theo liên tưởng rồi quay lại chỗ cũ.
 *
 * Dùng lại `suggest()` của services/lookup — cùng một hàm màn Tra cứu đang gọi,
 * nên thứ tự gợi ý và cách khớp form-of giống hệt, không có "hai kiểu tìm".
 */
import { useEffect, useRef, useState } from 'react';
import {
    FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { openDictionary } from '@/db/open';
import { suggest } from '@/services/lookup';
import type { SuggestRow } from '@/db/types';
import { UiIcon, Icons } from '@/components/dict-ui';
import { usePalette } from '@/theme/use-palette';
import { space, radius, type as typeScale } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

const DEBOUNCE_MS = 150; // khớp màn Tra cứu — SQLite cục bộ, không phải gọi mạng

export function SearchOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const t = usePalette();
    const s = makeStyles(t);
    const [query, setQuery] = useState('');
    const [rows, setRows] = useState<SuggestRow[]>([]);
    const debounce = useRef<ReturnType<typeof setTimeout>>(null);
    const input = useRef<TextInput>(null);

    // Mở ra là gõ được ngay. Không có bước này thì mỗi lần tra tiếp tốn thêm 1 tap.
    useEffect(() => {
        if (!visible) { setQuery(''); setRows([]); return; }
        const id = setTimeout(() => input.current?.focus(), 120); // chờ modal vào xong mới focus, nếu không bàn phím bị nuốt
        return () => clearTimeout(id);
    }, [visible]);

    function onChange(text: string) {
        setQuery(text);
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(async () => {
            const dict = await openDictionary();
            setRows(await suggest(dict, text));
        }, DEBOUNCE_MS);
    }

    function go(q: string, entryId?: number | null) {
        onClose();
        if (entryId != null) router.push({ pathname: '/word/[q]', params: { q, id: String(entryId) } });
        else router.push(`/word/${encodeURIComponent(q)}`);
    }

    return (
        <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={onClose}>
            <SafeAreaView style={s.root} edges={['top']}>
                <View style={s.bar}>
                    <UiIcon icon={Icons.Search} color={t.text.tertiary} />
                    <TextInput
                        ref={input}
                        style={s.input}
                        placeholder="Tra từ khác…"
                        placeholderTextColor={t.text.tertiary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                        value={query}
                        onChangeText={onChange}
                        onSubmitEditing={() => query.trim() && go(query.trim())}
                        accessibilityLabel="Tra từ khác"
                    />
                    <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Đóng tìm kiếm">
                        <Text style={s.cancel}>Huỷ</Text>
                    </Pressable>
                </View>

                <FlatList
                    data={rows}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(item, i) => `${item.display}-${item.kind}-${i}`}
                    ItemSeparatorComponent={() => <View style={s.sep} />}
                    renderItem={({ item }) => (
                        <Pressable
                            style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surface.raised }]}
                            // form đi theo chữ để giữ banner "dạng của…" ở màn chi tiết
                            onPress={() => go(item.display, item.kind === 'headword' ? item.entry_id : null)}
                        >
                            <Text style={[s.word, item.kind === 'headword' && s.headword]}>{item.display}</Text>
                            {item.sub ? <Text style={s.sub}>{item.sub}</Text> : null}
                            {item.def ? <Text style={s.def} numberOfLines={1}>{item.def}</Text> : null}
                        </Pressable>
                    )}
                />
            </SafeAreaView>
        </Modal>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        bar: {
            flexDirection: 'row', alignItems: 'center', gap: space.sm,
            marginHorizontal: space.md, marginVertical: space.sm,
            paddingHorizontal: 14, minHeight: 44,
            backgroundColor: t.surface.raised, borderRadius: radius.lg,
            borderWidth: 1, borderColor: t.border.subtle,
        },
        input: { flex: 1, fontSize: 16, paddingVertical: 10, color: t.text.primary },
        cancel: { fontSize: 14, color: t.accent.bg },
        row: { paddingHorizontal: space.md, paddingVertical: 12 },
        word: { fontSize: 16, color: t.text.primary },
        headword: { fontWeight: typeScale.weight.semibold },
        sub: { fontSize: typeScale.size.xs, color: t.text.tertiary, marginTop: 2 },
        def: { fontSize: 12, color: t.text.tertiary, marginTop: 1 },
        sep: { height: StyleSheet.hairlineWidth, backgroundColor: t.border.subtle, marginLeft: space.md },
    });
}
