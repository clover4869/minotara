/**
 * 04-B — Import word list. Paste-first (file picker can come later);
 * lenient format `word` / `word,meaning` / `word<TAB>meaning`.
 * Help sheet (B0) + low-match rescue (B2b) share the same guideline box.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
    KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openDictionary, openUser } from '@/db/open';
import { parseImportText, shouldSuggestTemplate } from '@/services/import-parser';
import { matchImport, type ImportMatchResult, type MatchedImport } from '@/services/import-matcher';
import { saveWord } from '@/db/user';
import { usePalette } from '@/theme/use-palette';
import { primitive } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

const SAMPLE = `word,meaning
ubiquitous,
meticulous,tỉ mỉ đến từng chi tiết
ran,chạy (quá khứ của run)
`;

export default function ImportScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [text, setText] = useState('');
    const [help, setHelp] = useState(false);
    const [result, setResult] = useState<ImportMatchResult | null>(null);
    const [skipped, setSkipped] = useState(0);
    const [checked, setChecked] = useState<Set<number>>(new Set());
    const [picked, setPicked] = useState<Record<number, number>>({}); // input index → entry_id
    const [doneMsg, setDoneMsg] = useState<string | null>(null);

    async function analyze() {
        const { items, skipped: sk } = parseImportText(text);
        if (!items.length) return;
        const dict = await openDictionary();
        const user = await openUser();
        const r = await matchImport(dict, user, items);
        setResult(r);
        setSkipped(sk);
        setChecked(new Set(r.matched.map((m) => m.entry_id)));
        const init: Record<number, number> = {};
        r.matched.forEach((m, i) => { init[i] = m.entry_id; });
        setPicked(init);
        if (shouldSuggestTemplate(items.length, r.matched.length)) setHelp(true);
    }

    function currentMatch(m: MatchedImport, i: number): MatchedImport {
        const id = picked[i] ?? m.entry_id;
        const alt = m.homographs.find((h) => h.entry_id === id);
        if (!alt || alt.entry_id === m.entry_id) return m;
        return { ...m, entry_id: alt.entry_id, headword: alt.headword, pos: alt.pos, cefr: alt.cefr };
    }

    async function apply() {
        if (!result) return;
        const user = await openUser();
        let added = 0;
        for (let i = 0; i < result.matched.length; i++) {
            const m = currentMatch(result.matched[i], i);
            const on = checked.has(m.entry_id) || checked.has(result.matched[i].entry_id);
            if (!on) continue;
            await saveWord(user, {
                entry_id: m.entry_id, headword: m.headword,
                pos: m.pos, cefr: m.cefr, user_meaning: m.meaning,
            });
            if (!m.alreadySaved) added++;
        }
        setDoneMsg(`Đã thêm ${added} từ · sẽ vào ôn tập dần, tối đa 20 thẻ mới/ngày`);
        setTimeout(() => router.back(), 1600);
    }

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={s.header}>
                    <Pressable onPress={() => router.back()} hitSlop={10}><Text style={s.headerIcon}>←</Text></Pressable>
                    <Text style={s.title}>Nhập danh sách</Text>
                    <Pressable onPress={() => setHelp(!help)} hitSlop={10}>
                        <Text style={s.helpIcon}>?</Text>
                    </Pressable>
                </View>

                {help && (
                    <View style={s.helpBox}>
                        <Text style={s.helpTitle}>Mỗi dòng một từ, nghĩa là tuỳ chọn:</Text>
                        <Text style={s.helpCode}>ubiquitous{'\n'}meticulous, tỉ mỉ đến từng chi tiết{'\n'}ran	chạy (quá khứ)</Text>
                        <Text style={s.helpNote}>Nhập dạng đã chia (ran, worst…) sẽ tự lưu từ gốc. Có nghĩa riêng thì flashcard dùng nghĩa của bạn.</Text>
                        <Pressable onPress={() => { setText(SAMPLE); setHelp(false); }} style={{ marginTop: 8 }}>
                            <Text style={s.sampleLink}>Tải file mẫu (.csv)</Text>
                        </Pressable>
                    </View>
                )}

                {!result ? (
                    <>
                        <TextInput
                            style={s.textarea}
                            multiline
                            placeholder={'Dán danh sách từ vào đây…\nubiquitous\nmeticulous, tỉ mỉ'}
                            placeholderTextColor={t.text.tertiary}
                            value={text}
                            onChangeText={setText}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Pressable style={[s.primaryBtn, !text.trim() && { opacity: 0.4 }]} disabled={!text.trim()} onPress={analyze}>
                            <Text style={s.primaryBtnText}>Đối chiếu với từ điển</Text>
                        </Pressable>
                    </>
                ) : doneMsg ? (
                    <View style={s.center}><Text style={s.doneText}>{doneMsg}</Text></View>
                ) : (
                    <>
                        <ScrollView style={{ flex: 1 }}>
                            <Text style={s.groupLabel}>✓ Tìm thấy ({result.matched.length})</Text>
                            {result.matched.map((raw, i) => {
                                const m = currentMatch(raw, i);
                                const on = checked.has(raw.entry_id) || checked.has(m.entry_id);
                                return (
                                    <View key={raw.entry_id} style={s.matchRow}>
                                        <Pressable
                                            onPress={() => {
                                                const next = new Set(checked);
                                                if (on) { next.delete(raw.entry_id); next.delete(m.entry_id); }
                                                else next.add(m.entry_id);
                                                setChecked(next);
                                            }}
                                        >
                                            <Text style={[s.checkbox, { color: on ? t.accent.bg : t.text.tertiary }]}>{on ? '☑' : '☐'}</Text>
                                        </Pressable>
                                        <View style={{ flex: 1 }}>
                                            <Text style={s.wordText}>{m.headword}</Text>
                                            {m.viaForm && (
                                                <Text style={s.viaForm}>
                                                    bạn nhập {m.inputWords.map((w) => `"${w}"`).join(', ')} → từ gốc {m.headword}
                                                </Text>
                                            )}
                                            {m.meaning ? <Text style={s.meaningPrev}>{m.meaning}</Text> : null}
                                            {raw.homographs.length > 1 && (
                                                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                                    {raw.homographs.map((h) => (
                                                        <Pressable
                                                            key={h.entry_id}
                                                            onPress={() => setPicked((p) => ({ ...p, [i]: h.entry_id }))}
                                                            style={[s.posPick, (picked[i] ?? raw.entry_id) === h.entry_id && s.posPickOn]}
                                                        >
                                                            <Text style={[s.posPickText, (picked[i] ?? raw.entry_id) === h.entry_id && s.posPickTextOn]}>{h.pos ?? '—'}</Text>
                                                        </Pressable>
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                        {m.alreadySaved
                                            ? <Text style={s.savedTag}>đã lưu — cập nhật nghĩa</Text>
                                            : <Text style={s.posTag}>{m.pos ?? ''}</Text>}
                                    </View>
                                );
                            })}
                            {result.unmatched.length > 0 && (
                                <>
                                    <Text style={s.groupLabel}>? Không có trong từ điển ({result.unmatched.length})</Text>
                                    <Text style={s.unmatched}>{result.unmatched.join(', ')}</Text>
                                </>
                            )}
                            {skipped > 0 && (
                                <Text style={s.skippedNote}>
                                    Đã bỏ qua {skipped} dòng (trùng từ trong danh sách hoặc vượt giới hạn 500 từ/lần)
                                </Text>
                            )}
                        </ScrollView>
                        <Pressable style={s.primaryBtn} onPress={apply}>
                            <Text style={s.primaryBtnText}>Thêm {checked.size} từ</Text>
                        </Pressable>
                        <Text style={s.limitNote}>Vào ôn tập dần — tối đa 20 thẻ mới mỗi ngày</Text>
                    </>
                )}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
        header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
        headerIcon: { fontSize: 18, color: t.text.primary },
        title: { flex: 1, fontSize: 17, fontWeight: '600', color: t.text.primary },
        helpIcon: { fontSize: 18, color: t.accent.bg },
        helpBox: { marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: t.accent.tint },
        helpTitle: { fontSize: 13, fontWeight: '600', color: primitive.accent[700] },
        helpCode: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: primitive.accent[700], marginTop: 6, lineHeight: 18 },
        helpNote: { fontSize: 12, color: primitive.accent[700], marginTop: 8, lineHeight: 17 },
        sampleLink: { color: primitive.accent[700], fontWeight: '600', fontSize: 13 },
        textarea: {
            flex: 1, margin: 16, marginTop: 4, padding: 14, fontSize: 15, color: t.text.primary,
            borderWidth: 1, borderColor: t.border.default, borderRadius: 12, textAlignVertical: 'top',
        },
        primaryBtn: { margin: 16, marginBottom: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: t.surface.inverse, alignItems: 'center' },
        primaryBtnText: { color: t.text.onInverse, fontSize: 15, fontWeight: '600' },
        doneText: { fontSize: 15, textAlign: 'center', color: t.text.success },
        groupLabel: { fontSize: 12, fontWeight: '600', color: t.text.secondary, paddingHorizontal: 16, marginTop: 12 },
        matchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
        checkbox: { fontSize: 17 },
        wordText: { fontSize: 14, color: t.text.primary },
        viaForm: { fontSize: 11, color: t.text.tertiary },
        meaningPrev: { fontSize: 12, color: t.text.secondary, fontStyle: 'italic' },
        savedTag: { fontSize: 11, color: t.text.tertiary, backgroundColor: t.surface.raised, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
        posTag: { fontSize: 12, color: t.text.tertiary },
        unmatched: { fontSize: 13, color: t.text.tertiary, paddingHorizontal: 16, marginTop: 6 },
        skippedNote: { fontSize: 12, color: t.text.tertiary, paddingHorizontal: 16, marginTop: 12, fontStyle: 'italic' },
        limitNote: { textAlign: 'center', fontSize: 11, color: t.text.tertiary, marginBottom: 12 },
        posPick: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: t.border.default },
        posPickOn: { backgroundColor: t.surface.inverse, borderColor: t.surface.inverse },
        posPickText: { fontSize: 11, color: t.text.secondary },
        posPickTextOn: { color: t.text.onInverse },
    });
}
