/**
 * SCR-01 — Search. Type-forward list; Lucide chrome; Porcelain canvas.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { dictionaryReady, openDictionary, openUser } from '@/db/open';
import { suggest, dailyWords, type DailyWord } from '@/services/lookup';
import {
    recentQueries, deleteRecentQuery, getSetting, setSetting, savedEntryIds, saveWord,
} from '@/db/user';
import type { SuggestRow } from '@/db/types';
import { CefrBadge, IconButton, Icons, SectionLabel, UiIcon } from '@/components/dict-ui';
import { useTabBarSpace } from '@/components/glass-tab-bar';
import { useApp } from '@/stores/app';
import { usePalette } from '@/theme/use-palette';
import { component, radius, space, type as typeScale } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

/** Số từ gợi ý mỗi ngày. Tập B1/B2 có 2.476 từ nên 10/ngày đủ cho hơn 240 ngày. */
const DAILY_COUNT = 10;

export default function SearchScreen() {
    const t = usePalette();
    const tabSpace = useTabBarSpace();
    const s = useMemo(() => makeStyles(t), [t]);
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const [rows, setRows] = useState<SuggestRow[]>([]);
    const [recent, setRecent] = useState<string[]>([]);
    const [daily, setDaily] = useState<DailyWord[]>([]);
    const [addedAll, setAddedAll] = useState(false);
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
                try {
                    const parsed = JSON.parse(cachedJson);
                    // Bản cũ lưu một object; bản này lưu mảng. Bọc lại để máy
                    // đã dùng hôm nay không mất khối gợi ý cho tới nửa đêm.
                    const list: DailyWord[] = Array.isArray(parsed) ? parsed : [parsed];
                    if (list.every((w) => typeof w?.id === 'number')) { setDaily(list); return; }
                    // object cũ không có `id` → không gọi được saveWord, bỏ cache và lấy mới
                } catch { /* cache hỏng — rơi xuống lấy mới */ }
            }
            const rows = await dailyWords(await openDictionary(), DAILY_COUNT, await savedEntryIds(user));
            if (rows.length) {
                setDaily(rows);
                await setSetting(user, 'wotd_date', today);
                await setSetting(user, 'wotd_json', JSON.stringify(rows));
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

    // `entryId` để mở đúng mục khi từ đó có nhiều loại từ (homograph); không
    // có id thì màn chi tiết phải tự đoán và có thể mở sang mục khác.
    const go = (q: string, entryId?: number) =>
        (entryId != null
            ? router.push({ pathname: '/word/[q]', params: { q, id: String(entryId) } })
            : router.push(`/word/${encodeURIComponent(q)}`));

    async function addAllToReview() {
        const user = await openUser();
        // saveWord() đã tự chèn srs_state với due_at = now, nên từ vào là đến
        // hạn ôn ngay; và nó ON CONFLICT chứ không reset SRS của từ đã có.
        for (const w of daily) {
            await saveWord(user, { entry_id: w.id, headword: w.headword, pos: w.pos, cefr: w.cefr });
        }
        setAddedAll(true);
    }
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
                    contentContainerStyle={{ paddingBottom: tabSpace }}
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
                            // Chỉ truyền entry_id cho headword: hàng form đi theo chữ
                            // để màn chi tiết còn hiện banner "dạng của…". Với headword
                            // thì id thành bắt buộc từ khi có dòng nghĩa — hai hàng "run"
                            // giờ hiện hai nghĩa khác nhau, bấm hàng noun mà mở ra verb
                            // là sai lộ liễu.
                            onPress={() => go(item.display, item.kind === 'headword' ? item.entry_id ?? undefined : undefined)}
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
                                {item.def ? (
                                    <Text style={s.suggestDef} numberOfLines={1}>{item.def}</Text>
                                ) : null}
                            </View>
                            {item.kind === 'headword' && item.sub ? (
                                <Text style={s.pos}>{item.sub}</Text>
                            ) : null}
                        </Pressable>
                    )}
                />
            ) : (
                <View style={{ paddingHorizontal: space.md, paddingBottom: tabSpace }}>
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
                                            hitSlop={15}
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
                    {daily.length > 0 && (
                        <View style={{ marginTop: space.md }}>
                            <View style={s.dailyHead}>
                                <SectionLabel>Từ hôm nay</SectionLabel>
                                <Pressable onPress={addAllToReview} disabled={addedAll} hitSlop={8}>
                                    <Text style={[s.dailyAdd, addedAll && { color: t.text.tertiary }]}>
                                        {addedAll ? 'Đã thêm vào ôn tập' : `Thêm cả ${daily.length} vào ôn tập`}
                                    </Text>
                                </Pressable>
                            </View>
                            {/*
                              Từ đầu tiên giữ thẻ gradient như trước — một từ
                              nổi bật mỗi ngày vẫn là ý của khối này; chín từ
                              còn lại xếp thành hàng gọn, mười thẻ gradient thì
                              chẳng còn cái nào nổi bật nữa.
                            */}
                            <Pressable onPress={() => go(daily[0].headword, daily[0].id)}>
                                {({ pressed }) => (
                                    <LinearGradient
                                        colors={[t.accent.tint, t.surface.raised]}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                        style={[s.wotd, pressed && { opacity: 0.85 }]}
                                    >
                                        <View style={s.wotdHeadRow}>
                                            <Text style={s.wotdWord}>{daily[0].headword}</Text>
                                            <CefrBadge level={daily[0].cefr} />
                                        </View>
                                        {daily[0].pos ? <Text style={s.suggestSub}>{daily[0].pos}</Text> : null}
                                    </LinearGradient>
                                )}
                            </Pressable>
                            {daily.slice(1).map((w) => (
                                <Pressable
                                    key={w.id}
                                    style={({ pressed }) => [s.dailyRow, pressed && { opacity: 0.6 }]}
                                    onPress={() => go(w.headword, w.id)}
                                >
                                    <Text style={s.dailyWord}>{w.headword}</Text>
                                    <CefrBadge level={w.cefr} />
                                    <View style={{ flex: 1 }} />
                                    {w.pos ? <Text style={s.pos}>{w.pos}</Text> : null}
                                </Pressable>
                            ))}
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
        suggestDef: { fontSize: 12, color: t.text.tertiary, marginTop: 1 },
        pos: { fontSize: typeScale.size.xs, color: t.text.tertiary },
        emptyBox: { alignItems: 'center', marginTop: space.xl, gap: space.sm, paddingHorizontal: space.lg },
        empty: { textAlign: 'center', color: t.text.secondary, fontSize: 15, marginTop: space.md },
        emptyHint: { textAlign: 'center', color: t.text.tertiary, fontSize: 13 },
        chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
        chip: {
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingLeft: 12, paddingRight: 8, paddingVertical: 6,
            borderRadius: radius.full, backgroundColor: t.surface.raised,
        },
        chipText: { fontSize: 13, color: t.text.secondary },
        wotd: {
            marginTop: space.sm, padding: space.md, borderRadius: radius.lg,
            overflow: 'hidden', // clip the gradient to the rounded corners on Android
        },
        wotdHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        wotdWord: {
            fontSize: typeScale.size.lg, fontWeight: typeScale.weight.semibold,
            color: t.text.primary, letterSpacing: -0.3,
        },
        dailyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        dailyAdd: { fontSize: 13, color: t.accent.bg, fontWeight: typeScale.weight.semibold },
        dailyRow: {
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: t.border.subtle,
        },
        dailyWord: { fontSize: typeScale.size.md, color: t.text.primary },
    });
}
