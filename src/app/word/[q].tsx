/**
 * SCR-02 — Word Detail.
 * Signature bet: form-of as a typeset sentence + IPA in mono, terracotta spine —
 * not a filled accent card (brief: the entry is the chrome).
 */
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Network from 'expo-network';

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
import { usePalette } from '@/theme/use-palette';
import { primitive, radius, space, type as typeScale } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

const IPA_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export default function WordDetail() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const { q, id } = useLocalSearchParams<{ q: string; id?: string }>();
    const dialect = useApp((st) => st.prefDialect);
    const autoplay = useApp((st) => st.autoplay);
    const fontScale = useApp((st) => st.fontScale);
    const fs = FONT_MULT[fontScale];

    const [result, setResult] = useState<LookupResult | null>(null);
    const [tab, setTab] = useState(0);
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
            setTab(idx);
            await addHistory(user, r.query || (q ?? ''), r.entries[idx]?.id ?? r.entries[0]?.id ?? null);
            Network.getNetworkStateAsync().then((n) => alive && setOnline(!!n.isConnected)).catch(() => {});
        })();
        return () => { alive = false; };
    }, [q, id]);

    const entry: EntryRow | undefined = result?.entries[tab];
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

    const viForTab = vi ? meaningsForPos(vi.list, entry?.pos ?? null) : null;
    const viOther = vi ? meaningsOtherPos(vi.list, entry?.pos ?? null) : [];
    const formWord = result.formOf[0]?.form ?? result.query;
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

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
                <View style={s.header}>
                    <IconButton icon={Icons.ArrowLeft} label="Quay lại" onPress={() => router.back()} />
                    <Text style={s.headQuery}>{result.query}</Text>
                    {entry && (
                        <IconButton
                            icon={saved ? Icons.BookmarkCheck : Icons.Bookmark}
                            label={saved ? 'Bỏ lưu' : 'Lưu từ'}
                            active={saved}
                            onPress={toggleSave}
                        />
                    )}
                </View>

                {grouped.length > 0 && (
                    <View style={s.formOf}>
                        <View style={s.formOfSpine} />
                        <View style={{ flex: 1 }}>
                            {grouped.map((f, i) => (
                                <View key={i} style={{ marginTop: i ? space.sm : 0 }}>
                                    <Text style={s.formOfText}>
                                        <Text style={s.formOfEm}>{f.form}</Text>
                                        {' — '}{f.labels.join(' · ')} của{' '}
                                        <Text style={s.formOfEm}>{f.lemma}</Text>
                                        {f.lemma_pos ? ` (${f.lemma_pos})` : ''}
                                    </Text>
                                    <View style={s.row}>
                                        {f.ipa_uk ? <Text style={s.ipa}>UK {f.ipa_uk}</Text> : null}
                                        <Speaker url={f.audio_uk} />
                                        {f.ipa_us ? <Text style={s.ipa}>US {f.ipa_us}</Text> : null}
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

                {result.entries.length > 1 && (
                    <View style={[s.row, { paddingHorizontal: space.md, marginTop: space.md }]}>
                        {result.entries.map((e, i) => (
                            <Chip key={e.id} active={i === tab} label={e.pos ?? '—'} onPress={() => setTab(i)} />
                        ))}
                    </View>
                )}

                {entry && data && (
                    <>
                        <View style={{ paddingHorizontal: space.md, marginTop: space.md }}>
                            <View style={[s.row, { alignItems: 'baseline' }]}>
                                <Text style={[s.headword, { fontSize: 30 * fs }]}>{entry.headword}</Text>
                                {data.homograph != null ? <Text style={s.hom}>{data.homograph}</Text> : null}
                                <CefrBadge level={entry.cefr} />
                            </View>
                            <Text style={s.posLine}>
                                {[entry.pos, data.grammar, data.labels].filter(Boolean).join(' · ')}
                            </Text>
                            {!isStub && (
                                <>
                                    <View style={[s.row, { marginTop: space.sm }]}>
                                        {data.pronunciations?.uk?.phon ? <Text style={s.ipa}>UK {data.pronunciations.uk.phon}</Text> : null}
                                        <Speaker url={data.pronunciations?.uk?.audio_mp3} />
                                        {data.pronunciations?.us?.phon ? <Text style={s.ipa}>US {data.pronunciations.us.phon}</Text> : null}
                                        <Speaker url={data.pronunciations?.us?.audio_mp3} />
                                    </View>
                                    {online && (
                                        <Pressable
                                            onPress={() => Linking.openURL(youglish)}
                                            style={[s.row, { marginTop: space.sm }]}
                                            accessibilityRole="link"
                                            accessibilityLabel="Nghe trong video thật"
                                        >
                                            <UiIcon icon={Icons.ExternalLink} size={14} color={t.accent.bg} />
                                            <Text style={s.youglish}>Nghe trong video thật</Text>
                                        </Pressable>
                                    )}
                                </>
                            )}
                        </View>

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
                                                <Text style={s.formLabel}>{f.label_vi}</Text>
                                                <Text style={s.formWord}>{f.form}</Text>
                                                <Text style={s.formIpa}>{(dialect === 'us' ? f.ipa_us : f.ipa_uk) ?? '—'}</Text>
                                                <Speaker url={pickAudioUrl(f, dialect)} />
                                            </View>
                                        ))}
                                    </View>
                                )}

                                <View style={s.section}>
                                    <Text style={s.cardTitle}>Nghĩa</Text>
                                    {senses.map((sense, i) => (
                                        <SenseBlock key={i} n={i + 1} sense={sense} fs={fs} onChip={openRelated} s={s} t={t} />
                                    ))}
                                </View>

                                <View style={s.section}>
                                    <View style={[s.row, { justifyContent: 'space-between' }]}>
                                        <Text style={s.cardTitle}>Ghi chú nghĩa của bạn</Text>
                                        <Pressable onPress={() => {
                                            setMeaningDraft(savedRow?.user_meaning ?? '');
                                            setEditingMeaning((v) => !v);
                                        }}>
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
                                        <Text style={[s.definition, { marginTop: 8 }]}>{savedRow.user_meaning}</Text>
                                    ) : (
                                        <Text style={[s.viFail, { marginTop: 6 }]}>Chưa có — flashcard dùng nghĩa từ điển.</Text>
                                    )}
                                </View>

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
                                    {viForTab?.slice(0, 6).map((m, i) => (
                                        <View key={i} style={{ marginTop: 8 }}>
                                            <Text style={[s.definition, { fontSize: 15 * fs }]}>{m.definition}</Text>
                                            {m.example ? <Text style={s.example}>{m.example}</Text> : null}
                                        </View>
                                    ))}
                                    {viOther.length > 0 && (
                                        <>
                                            <Text style={[s.cardTitle, { marginTop: 12 }]}>Nghĩa khác</Text>
                                            {viOther.slice(0, 4).map((m, i) => (
                                                <Text key={i} style={[s.definition, { marginTop: 6, fontSize: 14 * fs }]}>{m.definition}</Text>
                                            ))}
                                        </>
                                    )}
                                    {vi && !vi.failed && vi.list.length > 0 && (
                                        <Pressable onPress={() => Linking.openURL('https://dict.minhqnd.com')}>
                                            <Text style={s.attribution}>Nguồn: dict.minhqnd.com</Text>
                                        </Pressable>
                                    )}
                                </View>

                                {data.idioms.length > 0 && (
                                    <Accordion title={`Idioms (${data.idioms.length})`} s={s} t={t}>
                                        {data.idioms.map((idm, i) => (
                                            <View key={i} style={{ marginTop: 8 }}>
                                                <Text style={{ fontWeight: '600', fontSize: 14 * fs, color: t.text.primary }}>{idm.idiom}</Text>
                                                {idm.senses[0]?.definition ? <Text style={s.definition}>{idm.senses[0].definition}</Text> : null}
                                                {idm.senses[0]?.examples[0]?.text ? <Text style={s.example}>{idm.senses[0].examples[0].text}</Text> : null}
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
                                    <Accordion title="Word origin" s={s} t={t}><Text style={s.definition}>{data.word_origin}</Text></Accordion>
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
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

type Styles = ReturnType<typeof makeStyles>;

function SenseBlock({ n, sense, fs, onChip, s, t }: {
    n: number;
    sense: ReturnType<typeof parseEntryData>['senses'][number];
    fs: number;
    onChip: (text: string, url?: string | null) => void;
    s: Styles;
    t: Semantic;
}) {
    const [more, setMore] = useState(false);
    const examples = sense.examples ?? [];
    const shown = more ? examples : examples.slice(0, 2);
    return (
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <View style={{ width: 22, alignItems: 'center' }}>
                <Text style={s.senseNum}>{n}</Text>
                {sense.cefr ? <View style={[s.cefrDot, { backgroundColor: t.accent.bg }]} /> : null}
            </View>
            <View style={{ flex: 1 }}>
                {sense.guideword ? <Text style={s.guideword}>{sense.guideword}</Text> : null}
                <Text style={[s.definition, { fontSize: 15 * fs }]}>{sense.definition}</Text>
                {(sense.grammar || sense.labels) ? (
                    <Text style={s.posLine}>{[sense.grammar, sense.labels].filter(Boolean).join(' · ')}</Text>
                ) : null}
                {shown.map((ex, j) => (
                    <Text key={j} style={s.example}>{ex.text}</Text>
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
        posLine: { color: t.text.tertiary, fontSize: 13, marginTop: 2 },
        ipa: { fontSize: 13, color: t.text.secondary, fontFamily: IPA_FONT },
        youglish: { color: t.accent.bg, fontSize: 13 },
        section: { marginTop: space.lg, paddingHorizontal: space.md },
        cardTitle: { fontSize: 12, color: t.text.tertiary, letterSpacing: 0.3 },
        formLabel: { width: 140, fontSize: 13, color: t.text.secondary },
        formWord: { fontSize: 14, fontWeight: '500', flex: 1, color: t.text.primary },
        formIpa: { fontSize: 13, color: t.text.secondary, fontFamily: IPA_FONT },
        senseNum: { fontWeight: '600', color: t.text.secondary, fontSize: 14, fontVariant: ['tabular-nums'] },
        cefrDot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
        guideword: {
            fontSize: 11, color: t.text.tertiary, backgroundColor: t.surface.raised,
            alignSelf: 'flex-start', paddingHorizontal: 6, borderRadius: 4, overflow: 'hidden', marginBottom: 2,
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
