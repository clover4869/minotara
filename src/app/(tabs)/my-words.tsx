/**
 * SCR-04 — Từ của tôi. Signature: Leitner ladder ticks, not rainbow box pills.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openUser } from '@/db/open';
import { listSaved, savedStats, unsaveWord, type SavedOrder, type SavedWord } from '@/db/user';
import { CefrBadge, IconButton, Icons, LeitnerLadder, SectionLabel, UiIcon } from '@/components/dict-ui';
import { usePalette } from '@/theme/use-palette';
import { component, radius, space, type as typeScale } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

const ORDERS: { key: SavedOrder; label: string }[] = [
    { key: 'recent', label: 'Mới nhất' },
    { key: 'az', label: 'A-Z' },
    { key: 'cefr', label: 'CEFR' },
    { key: 'due', label: 'Đến hạn' },
];

export default function MyWordsScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [words, setWords] = useState<SavedWord[]>([]);
    const [stats, setStats] = useState({ total: 0, due: 0 });
    const [order, setOrder] = useState<SavedOrder>('recent');
    const [filter, setFilter] = useState('');

    const reload = useCallback(() => {
        openUser().then(async (u) => {
            setWords(await listSaved(u, order));
            setStats(await savedStats(u));
        });
    }, [order]);
    useFocusEffect(reload);

    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return words;
        return words.filter((w) => w.headword.toLowerCase().includes(q)
            || (w.user_meaning ?? '').toLowerCase().includes(q)
            || (w.note ?? '').toLowerCase().includes(q));
    }, [words, filter]);

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <View style={s.header}>
                <View style={{ flex: 1 }}>
                    <Text style={s.title}>Từ của tôi</Text>
                    <Text style={s.subtitle}>{stats.total} từ · {stats.due} đến hạn ôn</Text>
                </View>
                <IconButton icon={Icons.Upload} label="Nhập danh sách" onPress={() => router.push('/import')} />
            </View>

            {stats.due > 0 && (
                <Pressable style={s.reviewBtn} onPress={() => router.push('/review')}>
                    <Text style={s.reviewBtnText}>Ôn ngay · {stats.due} thẻ</Text>
                </Pressable>
            )}

            {words.length > 0 && (
                <View style={s.searchBar}>
                    <UiIcon icon={Icons.Search} color={t.text.tertiary} size={16} />
                    <TextInput
                        style={s.searchInput}
                        placeholder="Tìm trong sổ…"
                        placeholderTextColor={t.text.tertiary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={filter}
                        onChangeText={setFilter}
                    />
                </View>
            )}

            {words.length > 0 && (
                <View style={s.sortRow}>
                    {ORDERS.map((o) => (
                        <Pressable key={o.key} onPress={() => setOrder(o.key)}>
                            <Text style={[s.sortItem, order === o.key && s.sortOn]}>{o.label}</Text>
                        </Pressable>
                    ))}
                </View>
            )}

            <FlatList
                data={shown}
                keyExtractor={(w) => String(w.entry_id)}
                ListEmptyComponent={
                    <View style={s.emptyBox}>
                        <UiIcon icon={Icons.Bookmark} color={t.text.tertiary} />
                        <Text style={s.empty}>Lưu từ bằng bookmark khi tra, hoặc nhập danh sách.</Text>
                    </View>
                }
                renderItem={({ item }) => {
                    const preview = item.user_meaning || item.note;
                    return (
                        <Pressable
                            style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surface.raised }]}
                            onPress={() => router.push({
                                pathname: '/word/[q]',
                                params: { q: item.headword, id: String(item.entry_id) },
                            })}
                            onLongPress={async () => { await unsaveWord(await openUser(), item.entry_id); reload(); }}
                        >
                            <View style={{ flex: 1 }}>
                                <Text style={s.word}>
                                    {item.headword}
                                    <Text style={s.pos}>  {item.pos ?? ''}</Text>
                                </Text>
                                {preview ? <Text style={s.meaning} numberOfLines={1}>{preview}</Text> : null}
                            </View>
                            <CefrBadge level={item.cefr} size={11} />
                            <LeitnerLadder box={item.box ?? 1} />
                        </Pressable>
                    );
                }}
            />
            <Text style={s.hint}>Giữ lâu một dòng để xoá</Text>
        </SafeAreaView>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.md },
        title: { fontSize: typeScale.size.xl, fontWeight: typeScale.weight.semibold, color: t.text.primary, letterSpacing: -0.3 },
        subtitle: { fontSize: 13, color: t.text.secondary, marginTop: 2, fontVariant: ['tabular-nums'] },
        reviewBtn: {
            marginHorizontal: space.md, marginBottom: space.sm, paddingVertical: 12, minHeight: 44,
            borderRadius: radius.md, backgroundColor: t.surface.inverse, alignItems: 'center', justifyContent: 'center',
        },
        reviewBtnText: { color: t.text.onInverse, fontSize: 14, fontWeight: '600' },
        searchBar: {
            flexDirection: 'row', alignItems: 'center', gap: 8,
            marginHorizontal: space.md, marginBottom: 4, paddingHorizontal: 12, minHeight: 44,
            backgroundColor: t.surface.raised, borderRadius: component.input.radius,
        },
        searchInput: { flex: 1, fontSize: 14, padding: 0, color: t.text.primary },
        sortRow: { flexDirection: 'row', gap: 18, paddingHorizontal: space.md, paddingVertical: 8 },
        sortItem: { fontSize: 13, color: t.text.tertiary },
        sortOn: { color: t.text.primary, fontWeight: '600' },
        row: {
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingHorizontal: space.md, paddingVertical: 12, minHeight: 52,
            borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border.subtle,
        },
        word: { fontSize: 15, fontWeight: '500', color: t.text.primary },
        pos: { fontSize: 12, color: t.text.tertiary, fontWeight: '400' },
        meaning: { fontSize: 12, color: t.text.tertiary, fontStyle: 'italic', marginTop: 2 },
        emptyBox: { alignItems: 'center', marginTop: 48, paddingHorizontal: 32, gap: 12 },
        empty: { textAlign: 'center', color: t.text.tertiary, lineHeight: 20 },
        hint: { textAlign: 'center', fontSize: 11, color: t.text.tertiary, paddingVertical: 6 },
    });
}
