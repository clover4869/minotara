/**
 * SCR-01 — Search. Type-forward list; Lucide chrome; Porcelain canvas.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { dictionaryReady, openDictionary, openUser } from '@/db/open';
import { suggest, randomB1B2 } from '@/services/lookup';
import { recentQueries, deleteRecentQuery, getSetting, setSetting } from '@/db/user';
import type { SuggestRow } from '@/db/types';
import { CefrBadge, IconButton, Icons, SectionLabel, UiIcon } from '@/components/dict-ui';
import { useApp } from '@/stores/app';
import { usePalette } from '@/theme/use-palette';
import { component, radius, space, type as typeScale } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

export default function SearchScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const [rows, setRows] = useState<SuggestRow[]>([]);
    const [recent, setRecent] = useState<string[]>([]);
    const [wotd, setWotd] = useState<{ headword: string; pos: string | null; cefr: string | null } | null>(null);
    const { dictReady, setDictReady, loadSettings } = useApp();
    const debounce = useRef<ReturnType<typeof setTimeout>>(null);

    useEffect(() => {
        (async () => {
            const ok = await dictionaryReady();
            setDictReady(ok);
            if (!ok) { router.replace('/onboarding'); return; }
            await loadSettings();
            const user = await openUser();
            const today = new Date().toISOString().slice(0, 10);
            const cachedDate = await getSetting(user, 'wotd_date');
            const cachedJson = await getSetting(user, 'wotd_json');
            if (cachedDate === today && cachedJson) {
                try { setWotd(JSON.parse(cachedJson)); return; } catch { /* fall through */ }
            }
            const row = await randomB1B2(await openDictionary());
            if (row) {
                setWotd(row);
                await setSetting(user, 'wotd_date', today);
                await setSetting(user, 'wotd_json', JSON.stringify(row));
            }
        })();
    }, []);

    useFocusEffect(useCallback(() => {
        openUser().then((u) => recentQueries(u).then(setRecent));
    }, []));

    function onChange(text: string) {
        setQuery(text);
        if (debounce.current) clearTimeout(debounce.current);
        if (!text.trim()) { setRows([]); return; }
        debounce.current = setTimeout(async () => {
            const dict = await openDictionary();
            setRows(await suggest(dict, text));
        }, 150);
    }

    const go = (q: string) => router.push(`/word/${encodeURIComponent(q)}`);
    const qNorm = query.trim().toLowerCase();
    const fallback = rows.length > 0 && !rows.some((r) =>
        r.display.toLowerCase().startsWith(qNorm) || (r.sub ?? '').toLowerCase().startsWith(qNorm));

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <View style={s.top}>
                <Text style={s.brand}>Minotara</Text>
                <IconButton
                    icon={Icons.History}
                    label="Lịch sử tra cứu"
                    onPress={() => router.push('/history')}
                />
            </View>
            <View style={[s.searchBar, focused && s.searchBarFocus, t.hairline && s.searchBarDark]}>
                <UiIcon icon={Icons.Search} color={focused ? t.accent.bg : t.text.tertiary} />
                <TextInput
                    style={s.input}
                    placeholder="abandon, walked, children…"
                    placeholderTextColor={t.text.tertiary}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={query}
                    onChangeText={onChange}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onSubmitEditing={() => (rows[0] ? go(rows[0].display) : query.trim() && go(query))}
                    editable={dictReady}
                    accessibilityLabel="Tra từ tiếng Anh"
                />
                {query ? (
                    <IconButton
                        icon={Icons.X}
                        label="Xoá ô tìm"
                        onPress={() => { setQuery(''); setRows([]); }}
                    />
                ) : null}
            </View>

            {query.trim() ? (
                <FlatList
                    data={rows}
                    keyExtractor={(r, i) => `${r.display}-${r.kind}-${i}`}
                    keyboardShouldPersistTaps="handled"
                    ListHeaderComponent={fallback
                        ? <Text style={s.empty}>Không khớp tiền tố — ý bạn là</Text>
                        : null}
                    ListEmptyComponent={
                        <View style={s.emptyBox}>
                            <UiIcon icon={Icons.Search} color={t.text.tertiary} />
                            <Text style={s.empty}>Không có “{query.trim()}” trong từ điển.</Text>
                            <Text style={s.emptyHint}>Thử dạng gốc, hoặc kiểm tra chính tả.</Text>
                        </View>
                    }
                    renderItem={({ item }) => (
                        <Pressable
                            style={({ pressed }) => [s.suggestRow, pressed && { backgroundColor: t.surface.raised }]}
                            onPress={() => go(item.display)}
                        >
                            <UiIcon
                                icon={item.kind === 'headword' ? Icons.BookOpen : Icons.CornerDownRight}
                                color={item.kind === 'headword' ? t.text.secondary : t.text.tertiary}
                            />
                            <View style={{ flex: 1 }}>
                                <Text style={[s.suggestWord, item.kind === 'headword' && s.suggestHeadword]}>
                                    {item.display}
                                </Text>
                                {item.kind === 'form' && item.sub ? (
                                    <Text style={s.suggestSub}>{item.sub}</Text>
                                ) : null}
                            </View>
                            {item.kind === 'headword' && item.sub ? (
                                <Text style={s.pos}>{item.sub}</Text>
                            ) : null}
                        </Pressable>
                    )}
                />
            ) : (
                <View style={{ paddingHorizontal: space.md }}>
                    {recent.length > 0 && (
                        <>
                            <SectionLabel>Gần đây</SectionLabel>
                            <View style={s.chips}>
                                {recent.map((r) => (
                                    <View key={r} style={s.chip}>
                                        <Pressable onPress={() => go(r)} hitSlop={4}>
                                            <Text style={s.chipText}>{r}</Text>
                                        </Pressable>
                                        <Pressable
                                            hitSlop={8}
                                            accessibilityLabel={`Xoá ${r} khỏi gần đây`}
                                            onPress={async () => {
                                                await deleteRecentQuery(await openUser(), r);
                                                setRecent(await recentQueries(await openUser()));
                                            }}
                                        >
                                            <UiIcon icon={Icons.X} size={14} color={t.text.tertiary} />
                                        </Pressable>
                                    </View>
                                ))}
                            </View>
                        </>
                    )}
                    {wotd && (
                        <View style={{ marginTop: space.md }}>
                            <SectionLabel>Từ hôm nay</SectionLabel>
                            <Pressable
                                style={({ pressed }) => [s.wotd, pressed && { opacity: 0.85 }]}
                                onPress={() => go(wotd.headword)}
                            >
                                <View>
                                    <Text style={s.wotdWord}>{wotd.headword}</Text>
                                    {wotd.pos ? <Text style={s.suggestSub}>{wotd.pos}</Text> : null}
                                </View>
                                <CefrBadge level={wotd.cefr} />
                            </Pressable>
                        </View>
                    )}
                </View>
            )}
        </SafeAreaView>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        top: {
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: space.sm,
        },
        brand: {
            flex: 1, fontSize: typeScale.size.lg, fontWeight: typeScale.weight.semibold,
            color: t.text.primary, letterSpacing: -0.3,
        },
        searchBar: {
            flexDirection: 'row', alignItems: 'center', gap: space.sm,
            marginHorizontal: space.md, marginBottom: space.sm,
            paddingHorizontal: 14, minHeight: 44,
            backgroundColor: t.surface.raised, borderRadius: component.search.radius,
            borderWidth: 1, borderColor: t.border.subtle,
        },
        searchBarFocus: { borderColor: t.border.focus },
        searchBarDark: { borderColor: t.border.default },
        input: { flex: 1, fontSize: 16, paddingVertical: 10, color: t.text.primary },
        suggestRow: {
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingHorizontal: space.lg, paddingVertical: 12, minHeight: 48,
        },
        suggestWord: { fontSize: 16, color: t.text.primary },
        suggestHeadword: { fontWeight: typeScale.weight.semibold },
        suggestSub: { fontSize: typeScale.size.xs, color: t.text.tertiary, marginTop: 2 },
        pos: { fontSize: typeScale.size.xs, color: t.text.tertiary },
        emptyBox: { alignItems: 'center', marginTop: space.xl, gap: space.sm, paddingHorizontal: space.lg },
        empty: { textAlign: 'center', color: t.text.secondary, fontSize: 15, marginTop: space.md },
        emptyHint: { textAlign: 'center', color: t.text.tertiary, fontSize: 13 },
        chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
        chip: {
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingLeft: 12, paddingRight: 8, paddingVertical: 6,
            borderRadius: radius.full, backgroundColor: t.surface.raised,
        },
        chipText: { fontSize: 13, color: t.text.secondary },
        wotd: {
            marginTop: space.sm, padding: space.md, borderRadius: radius.lg,
            backgroundColor: t.surface.raised,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        },
        wotdWord: {
            fontSize: typeScale.size.lg, fontWeight: typeScale.weight.semibold,
            color: t.text.primary, letterSpacing: -0.3,
        },
    });
}
