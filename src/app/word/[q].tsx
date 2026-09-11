/**
 * SCR-02 — Word Detail.
 * Signature bet: form-of as a typeset sentence + IPA in mono, terracotta spine —
 * not a filled accent card (brief: the entry is the chrome).
 */
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Network from 'expo-network';
import { WebView } from 'react-native-webview';

import { openDictionary, openUser } from '@/db/open';
import { parseEntryData, type EntryRow, type FormRow } from '@/db/types';
import {
    lookup, lookupByEntryId, initialEntryIndex, formsOfEntry, groupFormOf, entryByUrl,
    type LookupResult,
} from '@/services/lookup';
import { getViMeanings, meaningsForPos, meaningsOtherPos, type ViMeaning } from '@/services/vi-meaning';
import { playUrl, pickAudioUrl } from '@/services/audio';
import { addHistory, getSaved, saveWord, unsaveWord, updateUserMeaning, type SavedWord } from '@/db/user';
import { useApp, FONT_MULT } from '@/stores/app';
import { Speaker, Chip, CefrBadge, IconButton, Icons, UiIcon } from '@/components/dict-ui';
import { Image as ExpoImage } from 'expo-image';
import { searchImages, imageQueryFor } from '@/services/image-search';
import { WordImages, MAX_SHOWN } from '@/components/word-images';
import { TappableText } from '@/components/tappable-text';
import { SearchOverlay } from '@/components/search-overlay';
import { usePalette } from '@/theme/use-palette';
import { primitive, radius, space, type as typeScale } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

const IPA_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/**
 * Ba view của cùng một entry, chia theo NGUỒN DỮ LIỆU chứ không theo section.
 * Chia theo section thì tab "Idioms" rỗng với 94,5% số từ và tab "Phrasal verbs"
 * rỗng với 96% — một tab rỗng gần như luôn luôn thì dạy người dùng đừng bấm nó.
 * Ba nguồn dưới đây thì gần như luôn có nội dung.
 *
 * Anh–Anh đứng đầu vì đây là view DUY NHẤT chạy offline (brief §3.1 "English
 * first, network never blocks") — mặc định mở ra một tab có thể hiện "Cần mạng"
 * là trải nghiệm tệ.
 *
 * "Video" là tab thứ tư — nhúng YouGlish thẳng trong app bằng WebView thay vì
 * mở trình duyệt ngoài (Linking.openURL cũ). Không cần giữ nguyên hành vi mở
 * ngoài vì bản build này không lên Play.
 */
const VIEWS = ['Anh–Anh', 'Ảnh', 'Tiếng Việt', 'Video'] as const;
const V_EN = 0, V_IMG = 1, V_VI = 2, V_VIDEO = 3;

export default function WordDetail() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const { q, id } = useLocalSearchParams<{ q: string; id?: string }>();
    const dialect = useApp((st) => st.prefDialect);
    const autoplay = useApp((st) => st.autoplay);
    const fontScale = useApp((st) => st.fontScale);
    const fs = FONT_MULT[fontScale];

    const [result, setResult] = useState<LookupResult | null>(null);
    /** Entry nào đang xem (homograph: bank-noun / bank-verb). Trục khác hẳn `view`. */
    const [entryIdx, setEntryIdx] = useState(0);
    /** View nào đang xem. Đổi `entryIdx` KHÔNG đụng tới đây — đang đọc Tiếng Việt
     *  của bank-noun mà bấm sang verb thì vẫn ở Tiếng Việt, không bị đá về đầu. */
    const [view, setView] = useState<number>(V_EN);
    /** View đã từng mở. View chưa mở thì không mount → tab Ảnh không gọi nguồn ảnh
     *  cho tới khi người dùng thật sự bấm vào. Mở rồi thì giữ mount (chỉ display:none)
     *  nên vị trí cuộn và ảnh đã tải của từng view được giữ nguyên khi chuyển qua lại. */
    const [visited, setVisited] = useState<Set<number>>(() => new Set([V_EN]));
    const [searchOpen, setSearchOpen] = useState(false);
    const [inflections, setInflections] = useState<FormRow[]>([]);
    const [vi, setVi] = useState<{ list: ViMeaning[]; failed: boolean } | null>(null);
    const [viTick, setViTick] = useState(0);
    const [savedRow, setSavedRow] = useState<SavedWord | null>(null);
    const [editingMeaning, setEditingMeaning] = useState(false);
    const [meaningDraft, setMeaningDraft] = useState('');
    const [online, setOnline] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            const dict = await openDictionary();
            const user = await openUser();
            const entryId = id ? Number(id) : NaN;
            const r = Number.isFinite(entryId)
                ? await lookupByEntryId(dict, entryId)
                : await lookup(dict, q ?? '');
            if (!alive) return;
            const idx = Number.isFinite(entryId)
                ? Math.max(0, r.entries.findIndex((e) => e.id === entryId))
                : initialEntryIndex(r.entries, r.formOf);
            setResult(r);
            setEntryIdx(idx);
            await addHistory(user, r.query || (q ?? ''), r.entries[idx]?.id ?? r.entries[0]?.id ?? null);
            Network.getNetworkStateAsync().then((n) => alive && setOnline(!!n.isConnected)).catch(() => {});
        })();
        return () => { alive = false; };
    }, [q, id]);

    const entry: EntryRow | undefined = result?.entries[entryIdx];
    const data = useMemo(() => (entry ? parseEntryData(entry.data) : null), [entry]);
    const senses = (data?.senses ?? []).filter((x) => x.definition);
    const isStub = !!result && result.formOf.length > 0 && senses.length === 0;

    useEffect(() => {
        if (!entry) { setInflections([]); setSavedRow(null); return; }
        let alive = true;
        (async () => {
            const dict = await openDictionary();
            const rows = await formsOfEntry(dict, entry.id);
            if (alive) setInflections(rows);
            setSavedRow(await getSaved(await openUser(), entry.id));
        })();
        return () => { alive = false; };
    }, [entry?.id]);

    useEffect(() => {
        if (!result) return;
        const lemma = result.formOf[0]?.lemma ?? result.entries[0]?.headword ?? result.query;
        let alive = true;
        setVi(null);
        openUser().then((user) => getViMeanings(user, lemma))
            .then((r) => alive && setVi({ list: r.meanings, failed: r.failed }))
            .catch(() => alive && setVi({ list: [], failed: true }));
        return () => { alive = false; };
    }, [result?.query, viTick]);

    useEffect(() => {
        if (!autoplay || !data) return;
        playUrl(data.pronunciations?.[dialect]?.audio_mp3 ?? null);
    }, [entry?.id, autoplay]);

    /*
      Prefetch ảnh ngay khi mở từ, để lúc bấm tab Ảnh không phải ngồi nhìn
      spinner chờ Bing. Ba chốt giữ cho nó không phá trải nghiệm:

      - Chờ 600ms: render màn từ + autoplay phát âm đi trước, prefetch xếp sau.
      - useFocusEffect chứ không useEffect: double-tap tra chuỗi container →
        bottle → glass trong vài giây thì các màn bị che huỷ luôn prefetch còn
        chờ — không bắn N request cho những từ chỉ đi ngang qua.
      - Phân theo mạng: Wi-Fi tải cả kết quả lẫn 9 thumbnail (~200KB, mở tab là
        hiện tức thì); 4G chỉ tải kết quả tìm — phần chậm nhất, ~50-80KB đã
        gzip — thumbnail để lúc thật sự mở tab, đỡ tốn data cho người không xem.

      Đã mở tab rồi (visited có V_IMG) thì thôi — WordImages tự lo. Trùng lời
      gọi với WordImages thì map inflight trong image-search.ts gộp làm một.
    */
    const visitedRef = useRef(visited);
    visitedRef.current = visited;
    useFocusEffect(useCallback(() => {
        if (!result || result.kind === 'miss') return;
        const q = result.formOf[0]?.lemma ?? result.entries[0]?.headword ?? result.query;
        if (!q) return;
        // Phải DÙNG ĐÚNG truy vấn của tab Ảnh: cache key là truy vấn, lệch một
        // chữ là prefetch xong tab vẫn miss cache rồi tải lại lần nữa.
        const defn = (() => {
            try {
                const d0 = result.entries[0];
                return d0 ? parseEntryData(d0.data).senses.find((x) => x.definition)?.definition ?? null : null;
            } catch { return null; }
        })();
        let alive = true;
        const timer = setTimeout(async () => {
            try {
                if (visitedRef.current.has(V_IMG)) return;
                const net = await Network.getNetworkStateAsync();
                if (!alive || !net.isConnected) return;
                const wifi = net.type === Network.NetworkStateType.WIFI
                    || net.type === Network.NetworkStateType.ETHERNET;
                const r = await searchImages(await openUser(), imageQueryFor(q, defn));
                if (!alive || r.failed || !wifi) return;
                ExpoImage.prefetch(r.results.slice(0, MAX_SHOWN).map((x) => x.thumbnail));
            } catch { /* prefetch là cơ hội, không phải nghĩa vụ — hỏng thì tab Ảnh tự lo như cũ */ }
        }, 600);
        return () => { alive = false; clearTimeout(timer); };
    }, [result?.query]));

    if (!result) {
        return (
            <SafeAreaView style={[s.root, s.center]} edges={['top']}>
                <ActivityIndicator color={t.accent.bg} />
            </SafeAreaView>
        );
    }

    if (result.kind === 'miss') {
        return (
            <SafeAreaView style={[s.root, s.center]} edges={['top']}>
                <Text style={s.missTitle}>Không tìm thấy “{result.query}”</Text>
                <Pressable onPress={() => router.replace('/')}>
                    <Text style={s.link}>Về tra cứu</Text>
                </Pressable>
            </SafeAreaView>
        );
    }

    const viForPos = vi ? meaningsForPos(vi.list, entry?.pos ?? null) : null;
    const viOther = vi ? meaningsOtherPos(vi.list, entry?.pos ?? null) : [];
    const formWord = result.formOf[0]?.form ?? result.query;
    // Same lemma-first priority the Vietnamese lookup uses: searching images for
    // "ran" returns noise, images for "run" are the ones that aid memory.
    const imageQuery = result.formOf[0]?.lemma ?? entry?.headword ?? result.query;
    const youglish = `https://youglish.com/pronounce/${encodeURIComponent(formWord)}/english/${dialect === 'us' ? 'us' : 'uk'}`;
    const grouped = groupFormOf(result.formOf);
    const saved = !!savedRow;

    async function toggleSave() {
        if (!entry) return;
        const user = await openUser();
        if (saved) {
            await unsaveWord(user, entry.id);
            setSavedRow(null);
        } else {
            await saveWord(user, { entry_id: entry.id, headword: entry.headword, pos: entry.pos, cefr: entry.cefr });
            setSavedRow(await getSaved(user, entry.id));
        }
    }

    async function saveMeaning() {
        if (!entry) return;
        const meaning = meaningDraft.trim() || null;
        const user = await openUser();
        if (!saved) {
            await saveWord(user, {
                entry_id: entry.id, headword: entry.headword, pos: entry.pos, cefr: entry.cefr, user_meaning: meaning,
            });
        } else {
            await updateUserMeaning(user, entry.id, meaning);
        }
        setSavedRow(await getSaved(user, entry.id));
        setEditingMeaning(false);
    }

    async function openRelated(text: string, url?: string | null) {
        if (url) {
            const hit = await entryByUrl(await openDictionary(), url);
            if (hit) {
                router.push({ pathname: '/word/[q]', params: { q: hit.headword, id: String(hit.id) } });
                return;
            }
        }
        router.push(`/word/${encodeURIComponent(text)}`);
    }

    function selectView(i: number) {
        setView(i);
        if (!visited.has(i)) setVisited((prev) => new Set(prev).add(i));
    }

    /* Khối nhận diện từ. Nằm TRONG mỗi ScrollView chứ không ghim trên đầu: loa
       phát âm dùng lúc mới mở từ, không dùng liên tục, nên để nó cuộn đi và
       nhường màn hình cho nội dung. Thanh tab mới là thứ được ghim.
       Cùng một element dùng lại cho cả 3 view — React tự tạo 3 instance riêng. */
    const identity = (
        <>
            {grouped.length > 0 && (
                    <View style={s.formOf}>
                        <View style={s.formOfSpine} />
                        <View style={{ flex: 1 }}>
                            {grouped.map((f, i) => (
                                <View key={i} style={{ marginTop: i ? space.sm : 0 }}>
                                    <Text style={[s.formOfText, { fontSize: 14 * fs }]}>
                                        <Text style={s.formOfEm}>{f.form}</Text>
                                        {' — '}{f.labels.join(' · ')} của{' '}
                                        <Text style={s.formOfEm}>{f.lemma}</Text>
                                        {f.lemma_pos ? ` (${f.lemma_pos})` : ''}
                                    </Text>
                                    <View style={s.row}>
                                        {f.ipa_uk ? <Text style={[s.ipa, { fontSize: 13 * fs }]}>UK {f.ipa_uk}</Text> : null}
                                        <Speaker url={f.audio_uk} />
                                        {f.ipa_us ? <Text style={[s.ipa, { fontSize: 13 * fs }]}>US {f.ipa_us}</Text> : null}
                                        <Speaker url={f.audio_us} />
                                    </View>
                                </View>
                            ))}
                            {result.kind === 'form-only' && grouped[0].entry_id != null && (
                                <Pressable
                                    onPress={() => router.replace(`/word/${encodeURIComponent(grouped[0].lemma)}`)}
                                    style={{ marginTop: space.sm }}
                                >
                                    <Text style={s.link}>Xem từ gốc</Text>
                                </Pressable>
                            )}
                        </View>
                    </View>
                )}

            {entry && data && (
                <View style={{ paddingHorizontal: space.md, marginTop: space.md }}>
                    <View style={[s.row, { alignItems: 'baseline' }]}>
                        <Text style={[s.headword, { fontSize: 30 * fs }]}>{entry.headword}</Text>
                        {data.homograph != null ? <Text style={[s.hom, { fontSize: 12 * fs }]}>{data.homograph}</Text> : null}
                        <CefrBadge level={entry.cefr} />
                    </View>

                    {/* Từ loại — thay hẳn dòng chữ xám "noun · grammar · labels" cũ.
                        91,3% số từ chỉ có 1 từ loại: vẫn tô đậm y hệt (nó đọc ra là
                        TRẠNG THÁI "từ này là danh từ"), chỉ bỏ onPress nên bấm vào
                        không nhấp nháy như một cái nút hỏng. */}
                    <View style={[s.row, { marginTop: space.sm, gap: 6 }]}>
                        {result.entries.map((e, i) => (
                            <Chip
                                key={e.id}
                                active={i === entryIdx}
                                label={e.pos ?? '—'}
                                onPress={result.entries.length > 1 ? () => setEntryIdx(i) : undefined}
                            />
                        ))}
                    </View>

                    {/* grammar/labels xuống dòng riêng: 45,6% số từ có chúng, và gộp
                        cùng hàng với chip thì hàng đó vừa chọn được vừa không, khó đọc. */}
                    {(data.grammar || data.labels) ? (
                        <View style={[s.row, { marginTop: 6, gap: 6 }]}>
                            {data.grammar ? <Text style={[s.tagBadge, { fontSize: 11 * fs }]}>{data.grammar.replace(/^\[|\]$/g, '')}</Text> : null}
                            {data.labels ? <Text style={[s.tagBadge, { fontSize: 11 * fs }]}>{data.labels.replace(/^\(|\)$/g, '')}</Text> : null}
                        </View>
                    ) : null}

                    {!isStub && (
                        <>
                            <View style={[s.row, { marginTop: space.sm }]}>
                                {data.pronunciations?.uk?.phon ? <Text style={[s.ipa, { fontSize: 13 * fs }]}>UK {data.pronunciations.uk.phon}</Text> : null}
                                <Speaker url={data.pronunciations?.uk?.audio_mp3} />
                                {data.pronunciations?.us?.phon ? <Text style={[s.ipa, { fontSize: 13 * fs }]}>US {data.pronunciations.us.phon}</Text> : null}
                                <Speaker url={data.pronunciations?.us?.audio_mp3} />
                            </View>
                            {online && (
                                <Pressable
                                    onPress={() => selectView(V_VIDEO)}
                                    style={[s.row, { marginTop: space.sm }]}
                                    accessibilityRole="button"
                                    accessibilityLabel="Nghe trong video thật"
                                >
                                    <UiIcon icon={Icons.Play} size={14} color={t.accent.bg} />
                                    <Text style={s.youglish}>Nghe trong video thật</Text>
                                </Pressable>
                            )}
                        </>
                    )}
                </View>
            )}
        </>
    );

    /* View 1 — Anh–Anh. Nguồn offline, luôn có nội dung. Idioms/phrasal/origin ở
       lại đây dạng accordion vì chỉ 5,5% / 4,0% số từ có chúng. */
    const viewEn = entry && data && (
        <>
            {isStub ? (
                            <Text style={[s.viFail, { paddingHorizontal: space.md }]}>
                                Đây là dạng biến thể — dùng “Xem từ gốc” ở trên.
                            </Text>
                        ) : (
                            <>
                                {inflections.length > 0 && (
                                    <View style={s.section}>
                                        <Text style={s.cardTitle}>Biến thể</Text>
                                        {inflections.map((f, i) => (
                                            <View key={i} style={[s.row, { marginTop: 8 }]}>
                                                <Text style={[s.formLabel, { fontSize: 13 * fs }]}>{f.label_vi}</Text>
                                                <Text style={[s.formWord, { fontSize: 14 * fs }]}>{f.form}</Text>
                                                <Text style={[s.formIpa, { fontSize: 13 * fs }]}>{(dialect === 'us' ? f.ipa_us : f.ipa_uk) ?? '—'}</Text>
                                                <Speaker url={pickAudioUrl(f, dialect)} />
                                            </View>
                                        ))}
                                    </View>
                                )}

                                <View style={s.section}>
                                    <Text style={s.cardTitle}>Nghĩa</Text>
                                    {senses.map((sense, i) => (
                                        <SenseBlock key={i} n={i + 1} sense={sense} fs={fs} onChip={openRelated} headword={entry?.headword} s={s} t={t} />
                                    ))}
                                </View>

                                {data.idioms.length > 0 && (
                                    <Accordion title={`Idioms (${data.idioms.length})`} s={s} t={t}>
                                        {data.idioms.map((idm, i) => (
                                            <View key={i} style={{ marginTop: 8 }}>
                                                <Text style={{ fontWeight: '600', fontSize: 14 * fs, color: t.text.primary }}>{idm.idiom}</Text>
                                                {idm.senses[0]?.definition ? <TappableText style={[s.definition, { fontSize: 15 * fs }]}>{idm.senses[0].definition}</TappableText> : null}
                                                {idm.senses[0]?.examples[0]?.text ? <TappableText style={[s.example, { fontSize: 13 * fs }]}>{idm.senses[0].examples[0].text}</TappableText> : null}
                                            </View>
                                        ))}
                                    </Accordion>
                                )}
                                {data.phrasal_verbs.length > 0 && (
                                    <Accordion title={`Phrasal verbs (${data.phrasal_verbs.length})`} s={s} t={t}>
                                        <View style={[s.row, { marginTop: 8 }]}>
                                            {data.phrasal_verbs.map((p, i) => (
                                                <Pressable key={i} style={s.wordChip} onPress={() => openRelated(p.text, p.url)}>
                                                    <Text style={s.chipLabel}>{p.text}</Text>
                                                </Pressable>
                                            ))}
                                        </View>
                                    </Accordion>
                                )}
                                {data.word_origin ? (
                                    <Accordion title="Word origin" s={s} t={t}><TappableText style={[s.definition, { fontSize: 15 * fs }]}>{data.word_origin}</TappableText></Accordion>
                                ) : null}
                                {data.see_also.length > 0 && (
                                    <View style={s.section}>
                                        <Text style={s.cardTitle}>See also</Text>
                                        <View style={[s.row, { marginTop: 8 }]}>
                                            {data.see_also.map((x, i) => (
                                                <Pressable key={i} style={s.wordChip} onPress={() => openRelated(x.text, x.url)}>
                                                    <Text style={s.chipLabel}>{x.text}</Text>
                                                </Pressable>
                                            ))}
                                        </View>
                                    </View>
                                )}
                            </>
                        )}
        </>
    );

    /* View 2 — Ảnh. Không còn accordion: chính việc mở tab là tín hiệu "tôi muốn
       xem ảnh", vì view chưa vào thì không nằm trong `visited` nên không mount,
       nên không gọi ra mạng. Cùng hợp đồng lazy cũ, ít hơn một lớp bọc. */
    const viewImg = (
        // Padding phải ở đây: trước kia <Accordion> cấp lề cho lưới ảnh, bỏ accordion
        // đi thì lưới tràn sát mép trong khi mọi thứ khác vẫn thụt vào.
        <View style={s.section}>
            <WordImages word={imageQuery} definition={senses[0]?.definition ?? null} />
        </View>
    );

    /* View 3 — Tiếng Việt + ghi chú của bạn. Hai thứ này đi cùng nhau vì cùng trả
       lời một câu hỏi ("từ này nghĩa là gì bằng tiếng mình"), và ghi chú của user
       là thứ thắng nghĩa từ điển trên flashcard (brief §3.3). */
    const viewVi = (
        <>
            <View style={[s.section, { backgroundColor: t.surface.raised, marginHorizontal: space.md, padding: space.md, borderRadius: radius.lg }]}>
                <Text style={s.cardTitle}>Nghĩa tiếng Việt</Text>
                {vi === null && <ActivityIndicator size="small" color={t.accent.bg} style={{ marginTop: 8 }} />}
                {vi?.failed && vi.list.length === 0 && (
                    <View style={[s.row, { marginTop: 8 }]}>
                        <Text style={s.viFail}>Cần mạng để xem nghĩa Việt</Text>
                        <Pressable onPress={() => setViTick((n) => n + 1)} style={s.row}>
                            <UiIcon icon={Icons.RotateCcw} size={14} color={t.accent.bg} />
                            <Text style={s.link}>Thử lại</Text>
                        </Pressable>
                    </View>
                )}
                {viForPos?.slice(0, 6).map((m, i) => (
                    <View key={i} style={{ marginTop: 8 }}>
                        <Text style={[s.definition, { fontSize: 15 * fs }]} selectable>{m.definition}</Text>
                        {m.example ? <Text style={[s.example, { fontSize: 13 * fs }]}>{m.example}</Text> : null}
                    </View>
                ))}
                {viOther.length > 0 && (
                    <>
                        <Text style={[s.cardTitle, { marginTop: 12 }]}>Nghĩa khác</Text>
                        {viOther.slice(0, 4).map((m, i) => (
                            <Text key={i} style={[s.definition, { marginTop: 6, fontSize: 14 * fs }]} selectable>{m.definition}</Text>
                        ))}
                    </>
                )}
                {vi && !vi.failed && vi.list.length > 0 && (
                    <Pressable onPress={() => Linking.openURL('https://dict.minhqnd.com')}>
                        <Text style={s.attribution}>Nguồn: dict.minhqnd.com</Text>
                    </Pressable>
                )}
            </View>

            <View style={[s.section, { backgroundColor: t.surface.raised, marginHorizontal: space.md, padding: space.md, borderRadius: radius.lg }]}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                    <Text style={s.cardTitle}>Ghi chú nghĩa của bạn</Text>
                    <Pressable
                        style={s.row}
                        onPress={() => {
                            setMeaningDraft(savedRow?.user_meaning ?? '');
                            setEditingMeaning((v) => !v);
                        }}
                    >
                        {!editingMeaning && <UiIcon icon={Icons.SquarePen} size={14} color={t.accent.bg} />}
                        <Text style={s.link}>{editingMeaning ? 'Huỷ' : 'Sửa'}</Text>
                    </Pressable>
                </View>
                {editingMeaning ? (
                    <>
                        <TextInput
                            style={s.meaningInput}
                            value={meaningDraft}
                            onChangeText={setMeaningDraft}
                            placeholder="Nghĩa / ghi chú riêng…"
                            placeholderTextColor={t.text.tertiary}
                            multiline
                        />
                        <Pressable onPress={saveMeaning} style={{ alignSelf: 'flex-end', marginTop: 6 }}>
                            <Text style={[s.link, { fontWeight: '600' }]}>Lưu</Text>
                        </Pressable>
                    </>
                ) : savedRow?.user_meaning ? (
                    <Text style={[s.definition, { marginTop: 8, fontSize: 15 * fs }]} selectable>{savedRow.user_meaning}</Text>
                ) : (
                    <Text style={[s.viFail, { marginTop: 6 }]}>Chưa có — flashcard dùng nghĩa từ điển.</Text>
                )}
            </View>
        </>
    );

    /* View 4 — Video (YouGlish). Nhúng thẳng bằng WebView, không phải ScrollView:
       WebView tự cuộn bên trong trang của nó, lồng thêm một ScrollView bọc ngoài
       chỉ gây xung đột cuộn kép và co chiều cao về 0. Vì vậy tab này được vẽ
       riêng ở vòng lặp render bên dưới, không đi qua `panels`. */
    const viewVideo = online ? (
        <WebView source={{ uri: youglish }} style={{ flex: 1 }} />
    ) : (
        <View style={[s.center, { flex: 1 }]}>
            <Text style={s.viFail}>Cần mạng để xem video</Text>
        </View>
    );

    const panels = [viewEn, viewImg, viewVi];

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <View style={s.header}>
                {/* Icon nhà thay cho mũi tên back: tra chuỗi container → bottle
                    → glass xong thì một chạm về thẳng Trang chủ, khỏi lùi từng
                    màn. Lùi TỪNG BƯỚC vẫn còn nguyên qua nút/vuốt back hệ thống
                    của Android — nút này chỉ là lối tắt thoát hẳn, không thay
                    thế back. dismissTo pop tới '/', không có trong lịch sử thì
                    replace, đường nào cũng về home. */}
                <IconButton icon={Icons.House} label="Về Trang chủ" onPress={() => router.dismissTo('/')} />
                <Text style={s.headQuery}>{result.query}</Text>
                <IconButton icon={Icons.Search} label="Tra từ khác" onPress={() => setSearchOpen(true)} />
                {entry && (
                    <IconButton
                        icon={saved ? Icons.BookmarkCheck : Icons.Bookmark}
                        label={saved ? 'Bỏ lưu' : 'Lưu từ'}
                        active={saved}
                        onPress={toggleSave}
                    />
                )}
            </View>

            {/* Thanh view ghim ngay dưới header, KHÔNG nằm dưới khối headword: đặt
                dưới thì vị trí của nó xê dịch theo từng từ (banner biến thể có/không,
                headword dài/ngắn). Ở đây thì nó đứng yên một chỗ với mọi từ. */}
            <View style={s.viewTabs} accessibilityRole="tablist">
                {VIEWS.map((label, i) => (
                    <Pressable
                        key={label}
                        onPress={() => selectView(i)}
                        style={[s.viewTab, i === view && s.viewTabOn]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: i === view }}
                    >
                        <Text style={[s.viewTabLabel, i === view && s.viewTabLabelOn]}>{label}</Text>
                    </Pressable>
                ))}
            </View>

            {/* Mỗi view một ScrollView riêng, ẩn bằng display chứ không unmount —
                nhờ vậy vị trí cuộn và ảnh đã tải của từng view được giữ nguyên khi
                chuyển qua lại. View chưa vào bao giờ thì chưa nằm trong `visited`
                nên chưa tồn tại, giữ được tính lazy. */}
            {VIEWS.map((_, i) => {
                if (!visited.has(i)) return null;
                const display = i === view ? 'flex' : 'none';
                if (i === V_VIDEO) {
                    return (
                        <View key={i} style={{ flex: 1, display }}>
                            {viewVideo}
                        </View>
                    );
                }
                return (
                    <ScrollView
                        key={i}
                        style={{ display }}
                        contentContainerStyle={{ paddingBottom: 48 }}
                    >
                        {identity}
                        {panels[i]}
                    </ScrollView>
                );
            })}

            <SearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
        </SafeAreaView>
    );
}

type Styles = ReturnType<typeof makeStyles>;

function SenseBlock({ n, sense, fs, onChip, headword, s, t }: {
    n: number;
    sense: ReturnType<typeof parseEntryData>['senses'][number];
    fs: number;
    onChip: (text: string, url?: string | null) => void;
    headword?: string;
    s: Styles;
    t: Semantic;
}) {
    const [more, setMore] = useState(false);
    const examples = sense.examples ?? [];
    const shown = more ? examples : examples.slice(0, 2);
    return (
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <View style={{ width: 22, alignItems: 'center' }}>
                {/* lineHeight khớp dòng ĐẦU TIÊN của cột bên phải — guideword (20) khi
                    có, nếu không thì definition (23) — nên chân chữ trùng nhau. Xem
                    senseNum trong makeStyles. */}
                <Text style={[s.senseNum, { fontSize: 14 * fs, lineHeight: sense.guideword ? 20 : 23 }]}>{n}</Text>
                {sense.cefr ? <View style={[s.cefrDot, { backgroundColor: t.accent.bg }]} /> : null}
            </View>
            <View style={{ flex: 1 }}>
                {sense.guideword ? <Text style={[s.guideword, { fontSize: 11 * fs }]}>{sense.guideword}</Text> : null}
                <TappableText style={[s.definition, { fontSize: 15 * fs }]} ignore={headword}>{sense.definition}</TappableText>
                {(sense.grammar || sense.labels) ? (
                    <View style={[s.row, { marginTop: 4, gap: 6 }]}>
                        {sense.grammar ? <Text style={[s.tagBadge, { fontSize: 11 * fs }]}>{sense.grammar.replace(/^\[|\]$/g, '')}</Text> : null}
                        {sense.labels ? <Text style={[s.tagBadge, { fontSize: 11 * fs }]}>{sense.labels.replace(/^\(|\)$/g, '')}</Text> : null}
                    </View>
                ) : null}
                {shown.map((ex, j) => (
                    <TappableText key={j} style={[s.example, { fontSize: 13 * fs }]} ignore={headword}>{ex.text}</TappableText>
                ))}
                {examples.length > 2 && (
                    <Pressable onPress={() => setMore((v) => !v)}>
                        <Text style={[s.link, { fontSize: 12, marginTop: 4 }]}>{more ? 'Thu gọn' : 'Xem thêm'}</Text>
                    </Pressable>
                )}
                {(sense.synonyms.length > 0 || sense.xrefs.length > 0) && (
                    <View style={[s.row, { marginTop: 6 }]}>
                        {sense.synonyms.map((w, i) => (
                            <Pressable key={`s${i}`} style={s.wordChip} onPress={() => onChip(w)}>
                                <Text style={s.chipLabel}>{w}</Text>
                            </Pressable>
                        ))}
                        {sense.xrefs.map((x, i) => (
                            <Pressable key={`x${i}`} style={s.wordChip} onPress={() => onChip(x.text, x.url)}>
                                <Text style={s.chipLabel}>{x.text}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </View>
        </View>
    );
}

function Accordion({ title, children, s, t }: { title: string; children: ReactNode; s: Styles; t: Semantic }) {
    const [open, setOpen] = useState(false);
    return (
        <View style={s.accordion}>
            <Pressable onPress={() => setOpen(!open)} style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={{ fontWeight: '600', fontSize: 14, color: t.text.primary }}>{title}</Text>
                <UiIcon icon={open ? Icons.ChevronUp : Icons.ChevronDown} size={18} color={t.text.tertiary} />
            </Pressable>
            {open && children}
        </View>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
        header: {
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: space.sm, paddingVertical: space.sm,
            borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border.subtle,
        },
        headQuery: { flex: 1, color: t.text.tertiary, fontSize: 14 },
        viewTabs: {
            flexDirection: 'row', gap: space.lg, paddingHorizontal: space.md,
            borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border.subtle,
        },
        viewTab: {
            paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: 'transparent',
            marginBottom: -StyleSheet.hairlineWidth, // đè lên đường kẻ dưới để gạch chân liền mạch
        },
        viewTabOn: { borderBottomColor: t.accent.bg },
        viewTabLabel: { fontSize: 14, color: t.text.tertiary },
        viewTabLabelOn: { color: t.text.link, fontWeight: '600' },
        formOf: {
            flexDirection: 'row', gap: 14,
            paddingHorizontal: space.md, paddingVertical: space.md,
        },
        formOfSpine: { width: 2, borderRadius: 1, backgroundColor: t.accent.bg },
        formOfText: { color: t.text.secondary, fontSize: 14, lineHeight: 21 },
        formOfEm: { fontWeight: '600', color: t.text.primary },
        row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        headword: {
            fontSize: 30, fontWeight: typeScale.weight.semibold, color: t.text.primary,
            letterSpacing: -0.5,
        },
        hom: { fontSize: 12, color: t.text.tertiary, fontWeight: '600' },
        tagBadge: {
            fontSize: 11, color: t.text.secondary, backgroundColor: t.surface.raised,
            paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden',
        },
        ipa: { fontSize: 13, color: t.text.secondary, fontFamily: IPA_FONT },
        youglish: { color: t.accent.bg, fontSize: 13 },
        section: { marginTop: space.lg, paddingHorizontal: space.md },
        cardTitle: { fontSize: 12, color: t.text.tertiary, letterSpacing: 0.3 },
        formLabel: { width: 140, fontSize: 13, color: t.text.secondary },
        formWord: { fontSize: 14, fontWeight: '500', flex: 1, color: t.text.primary },
        formIpa: { fontSize: 13, color: t.text.secondary, fontFamily: IPA_FONT },
        /**
         * `lineHeight` ở đây và ở `guideword` phải BẰNG NHAU. Trước đó số nghĩa
         * cỡ 14 còn guideword cỡ 11, mỗi cái tự tính hộp dòng riêng rồi cùng canh
         * mép trên — nên chân chữ lệch nhau. Cho chung một hộp dòng thì chữ tự
         * canh giữa trong hộp và hai bên trùng nhau, không phải căn tay.
         * Chỉ 1,5% số từ có guideword, nhưng nhóm đó trung bình 7,5 nghĩa/từ
         * (phần còn lại: 1,4) — tức lỗi rơi đúng vào những từ dài nhất.
         */
        senseNum: {
            fontWeight: '600', color: t.text.secondary, fontSize: 14,
            lineHeight: 20, fontVariant: ['tabular-nums'],
        },
        cefrDot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
        guideword: {
            fontSize: 11, color: t.text.tertiary, backgroundColor: t.surface.raised,
            alignSelf: 'flex-start', paddingHorizontal: 6, borderRadius: 4, overflow: 'hidden', marginBottom: 2,
            lineHeight: 20, // phải khớp senseNum.lineHeight — xem ghi chú ở đó
        },
        definition: { fontSize: 15, lineHeight: 23, color: t.text.primary },
        example: { fontSize: 13, color: t.text.secondary, fontStyle: 'italic', marginTop: 3 },
        viFail: { fontSize: 13, color: t.text.tertiary, marginTop: 8 },
        attribution: { fontSize: 11, color: t.text.tertiary, marginTop: 10 },
        accordion: {
            marginHorizontal: space.md, marginTop: space.md, padding: space.md,
            borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border.subtle,
        },
        missTitle: { fontSize: 17, fontWeight: '600', color: t.text.primary },
        link: { color: t.accent.bg, fontSize: 14 },
        wordChip: {
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
            backgroundColor: t.accent.tint,
        },
        chipLabel: { fontSize: 12, color: primitive.accent[700] },
        meaningInput: {
            marginTop: 8, padding: 10, minHeight: 64,
            borderWidth: 1, borderColor: t.border.default,
            borderRadius: radius.md, fontSize: 14, textAlignVertical: 'top',
            color: t.text.primary, backgroundColor: t.surface.raised,
        },
    });
}
