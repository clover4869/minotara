/**
 * SCR-05 — Review (flashcards). Three sub-states in one screen:
 * start → card loop (SessionQueue drives learning steps) → results.
 * Auto-read per 05B-03b: plays when the WORD side is visible, repeats every
 * 3s until graded; silent when audio is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { openDictionary, openUser } from '@/db/open';
import { loadSrsStates, persistGrades, nextDueAt, type NextDue, type SavedWord } from '@/db/user';
import {
    buildSession, buildAheadSession, dueBoxCounts, SessionQueue, shuffle, maskHeadword, type SrsState,
} from '@/services/srs';
import { formsOfEntry } from '@/services/lookup';
import { parseEntryData } from '@/db/types';
import { playRepeating, stopRepeat, playUrl } from '@/services/audio';
import { useApp } from '@/stores/app';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

type Mode = 'word2meaning' | 'meaning2word' | 'listen';
type Phase = 'start' | 'card' | 'done';

interface CardContent {
    entry_id: number;
    headword: string;
    ipa: string | null;
    audio: string | null;
    definition: string;
    isUserMeaning: boolean;
    dictDefinition: string | null;
    example: string | null;
    forms: string;
}

export default function ReviewScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const dialect = useApp((st) => st.prefDialect);
    const reviewAutoplay = useApp((st) => st.reviewAutoplay);

    const [phase, setPhase] = useState<Phase>('start');
    const [mode, setMode] = useState<Mode>('word2meaning');
    const [dueCount, setDueCount] = useState(0);
    const [aheadCount, setAheadCount] = useState(0);
    const [boxes, setBoxes] = useState([0, 0, 0, 0, 0]);
    const [queue, setQueue] = useState<SessionQueue | null>(null);
    const [card, setCard] = useState<CardContent | null>(null);
    const [flipped, setFlipped] = useState(false);
    const [nextDue, setNextDue] = useState<NextDue | null>(null);
    const [noGrade, setNoGrade] = useState(false);
    const cache = useRef(new Map<number, CardContent>());
    const statesRef = useRef<SrsState[]>([]);
    const flipAnim = useRef(new Animated.Value(1)).current;

    async function refreshCounts() {
        const states = await loadSrsStates(await openUser());
        statesRef.current = states;
        const now = new Date();
        const nowIso = now.toISOString();
        // Matches savedStats() in my-words.tsx: new cards are immediately due too,
        // so they must count here (they're excluded from dueBoxCounts below on
        // purpose — that chart is Leitner box distribution, where "new" isn't a box).
        setDueCount(states.filter((st) => st.due_at <= nowIso).length);
        setAheadCount(buildAheadSession(states, now).length);
        setBoxes(dueBoxCounts(states, now));
    }

    useEffect(() => {
        refreshCounts();
        return () => stopRepeat();
    }, []);

    // A card's cache is only valid within the session it was fetched for — the
    // user could edit `user_meaning` on the Search tab between sessions, and
    // since tabs stay mounted (NativeTabs), this ref would otherwise outlive
    // that edit and keep showing stale content.
    useFocusEffect(useCallback(() => () => { cache.current.clear(); }, []));

    async function loadCard(entryId: number): Promise<CardContent> {
        if (cache.current.has(entryId)) return cache.current.get(entryId)!;
        const dict = await openDictionary();
        const user = await openUser();
        const entry = await dict.getFirstAsync<any>(
            'SELECT id, headword, data FROM entries WHERE id = ?', entryId);
        const saved = await user.getFirstAsync<SavedWord>(
            'SELECT * FROM saved_words WHERE entry_id = ?', entryId);
        const data = parseEntryData(entry.data);
        const pron = data.pronunciations?.[dialect === 'us' ? 'us' : 'uk'];
        const firstSense = data.senses.find((x) => x.definition);
        const inf = await formsOfEntry(dict, entryId);
        const forms = inf
            .filter((f) => f.form_type === 'past' || f.form_type === 'past_participle')
            .map((f) => `${f.form_type === 'past' ? 'V2' : 'V3'} ${f.form}`)
            .join(' · ');
        const content: CardContent = {
            entry_id: entryId,
            headword: entry.headword,
            ipa: pron?.phon ?? null,
            audio: pron?.audio_mp3 ?? data.pronunciations?.uk?.audio_mp3 ?? null,
            definition: saved?.user_meaning ?? firstSense?.definition ?? '(chưa có nghĩa)',
            isUserMeaning: !!saved?.user_meaning,
            dictDefinition: saved?.user_meaning ? firstSense?.definition ?? null : null,
            example: firstSense?.examples[0]?.text ?? null,
            forms,
        };
        cache.current.set(entryId, content);
        return content;
    }

    async function begin(cards: SrsState[], skipGrade = false) {
        if (!cards.length) return;
        cache.current.clear();
        setNoGrade(skipGrade);
        const q = skipGrade
            ? new SessionQueue(shuffle(cards), new Date(), Math.random, { reinforcement: true })
            : new SessionQueue(shuffle(cards), new Date());
        setQueue(q);
        setPhase('card');
        await showCurrent(q);
    }

    async function start() {
        await begin(buildSession(statesRef.current, new Date()));
    }
    async function startAhead() {
        await begin(buildAheadSession(statesRef.current, new Date()));
    }

    async function showCurrent(q: SessionQueue) {
        stopRepeat();
        setFlipped(false);
        flipAnim.setValue(1);
        const cur = q.current;
        if (!cur) { await finish(q); return; }
        const c = await loadCard(cur.entry_id);
        setCard(c);
        const wordVisible = mode === 'word2meaning' || mode === 'listen';
        if (reviewAutoplay && wordVisible) playRepeating(c.audio);
        else if (mode === 'listen') playUrl(c.audio);
    }

    function flip() {
        if (flipped || !card) return;
        Animated.sequence([
            Animated.timing(flipAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
            Animated.timing(flipAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
        ]).start();
        setFlipped(true);
        if (reviewAutoplay && mode === 'meaning2word') playRepeating(card.audio);
    }

    async function answer(correct: boolean) {
        if (!queue) return;
        Vibration.vibrate(12);
        stopRepeat();
        queue.answer(correct);
        await showCurrent(queue);
    }

    async function finish(q: SessionQueue) {
        if (!noGrade) await persistGrades(await openUser(), q.graded);
        setNextDue(await nextDueAt(await openUser()));
        setPhase('done');
    }

    async function exitEarly() {
        if (queue && !noGrade) await persistGrades(await openUser(), queue.graded);
        stopRepeat();
        router.back();
    }

    async function retryMissed() {
        if (!queue) return;
        const missed = statesRef.current.filter((st) => queue.missed.has(st.entry_id));
        if (!missed.length) return;
        await begin(missed, true);
    }

    if (phase === 'start') {
        const maxBox = Math.max(1, ...boxes);
        return (
            <SafeAreaView style={s.center} edges={['top']}>
                <Text style={s.big}>{dueCount}</Text>
                <Text style={s.secondaryText}>thẻ đến hạn hôm nay</Text>
                <View style={s.bars}>
                    {boxes.map((n, i) => (
                        <View key={i} style={s.barCol}>
                            <View style={[s.bar, { height: 8 + (n / maxBox) * 36 }]} />
                            <Text style={s.barLabel}>{i + 1}</Text>
                        </View>
                    ))}
                </View>
                <View style={[s.rowGap, { marginTop: 20 }]}>
                    <ModeChip label="Từ → Nghĩa" active={mode === 'word2meaning'} onPress={() => setMode('word2meaning')} s={s} />
                    <ModeChip label="Nghĩa → Từ" active={mode === 'meaning2word'} onPress={() => setMode('meaning2word')} s={s} />
                    <ModeChip label="Nghe → Từ" active={mode === 'listen'} onPress={() => setMode('listen')} s={s} />
                </View>
                <Pressable
                    style={[s.primaryBtn, !dueCount && { opacity: 0.4 }]}
                    disabled={!dueCount}
                    onPress={start}
                >
                    <Text style={s.primaryBtnText}>Bắt đầu</Text>
                </Pressable>
                {!dueCount && aheadCount > 0 && (
                    <Pressable style={s.ghostBtn} onPress={startAhead}>
                        <Text style={s.ghostBtnText}>Ôn trước hạn · {aheadCount} thẻ</Text>
                    </Pressable>
                )}
                {!dueCount && !aheadCount && (
                    <Text style={s.hintText}>Lưu từ ở tab Tra cứu để có thẻ ôn</Text>
                )}
            </SafeAreaView>
        );
    }

    if (phase === 'done' && queue) {
        const wrongIds = [...queue.missed];
        const wrong = wrongIds.length;
        const right = Math.max(0, queue.total - wrong);
        const nextLabel = nextDue
            ? `Lần ôn tiếp theo: ${nextDue.count} thẻ ${formatNext(nextDue.due_at)}`
            : 'Chưa có thẻ đến hạn tiếp theo';
        return (
            <SafeAreaView style={s.center} edges={['top']}>
                <Text style={s.big}>{queue.total ? Math.round((right / queue.total) * 100) : 0}%</Text>
                <Text style={s.secondaryText}>{right} đúng · {wrong} chưa nhớ</Text>
                <Text style={s.hintText}>{nextLabel}</Text>
                {wrong > 0 && (
                    <View style={{ marginTop: 16, alignItems: 'center', gap: 8 }}>
                        {wrongIds.slice(0, 8).map((id) => {
                            const c = cache.current.get(id);
                            if (!c) return null;
                            return (
                                <Pressable key={id} onPress={() => router.push({
                                    pathname: '/word/[q]', params: { q: c.headword, id: String(id) },
                                })}>
                                    <Text style={s.wrongWord}>{c.headword}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                    {wrong > 0 && (
                        <Pressable style={s.ghostBtn} onPress={retryMissed}>
                            <Text style={s.ghostBtnText}>Ôn tiếp thẻ sai</Text>
                        </Pressable>
                    )}
                    <Pressable style={s.primaryBtn} onPress={async () => {
                        await refreshCounts();
                        setQueue(null);
                        setPhase('start');
                    }}>
                        <Text style={s.primaryBtnText}>Xong</Text>
                    </Pressable>
                </View>
            </SafeAreaView>
        );
    }

    if (!card || !queue) return null;
    const frontIsWord = mode === 'word2meaning';
    const maskedEx = card.example ? maskHeadword(card.example, card.headword) : null;
    const doneUnique = queue.total - queue.remaining;

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <View style={s.topBar}>
                <Pressable onPress={exitEarly} hitSlop={10}><Text style={s.exitIcon}>✕</Text></Pressable>
                <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${(doneUnique / Math.max(1, queue.total)) * 100}%` }]} />
                </View>
                <Text style={s.secondaryText}>{doneUnique}/{queue.total}</Text>
            </View>

            <Pressable onPress={flip}>
                <Animated.View style={[s.cardBox, { transform: [{ scale: flipAnim }] }]}>
                    {!flipped ? (
                        frontIsWord ? (
                            <>
                                <Text style={s.cardWord}>{card.headword}</Text>
                                {card.ipa ? <Text style={s.cardIpa}>{card.ipa}</Text> : null}
                                <Text style={s.tapHint}>Chạm để xem nghĩa</Text>
                            </>
                        ) : mode === 'listen' ? (
                            <>
                                <Text style={{ fontSize: 32 }}>🔊</Text>
                                <Text style={s.tapHint}>Chạm thẻ để xem từ</Text>
                            </>
                        ) : (
                            <>
                                <Text style={s.cardDef}>{card.definition}</Text>
                                {maskedEx ? <Text style={s.cardExample}>{maskedEx}</Text> : null}
                                <Text style={s.tapHint}>Chạm để xem từ</Text>
                            </>
                        )
                    ) : (
                        <>
                            <Text style={s.cardWord}>{card.headword}</Text>
                            {card.ipa ? <Text style={s.cardIpa}>{card.ipa}</Text> : null}
                            <Text style={[s.cardDef, { marginTop: 14 }]}>
                                {card.definition}
                                {card.isUserMeaning ? <Text style={s.userTag}>  · nghĩa của bạn</Text> : null}
                            </Text>
                            {card.dictDefinition ? <Text style={s.cardDictDef}>{card.dictDefinition}</Text> : null}
                            {card.example ? <Text style={s.cardExample}>{card.example}</Text> : null}
                            {card.forms ? <Text style={s.cardForms}>{card.forms}</Text> : null}
                        </>
                    )}
                </Animated.View>
            </Pressable>

            {flipped && (
                <View style={s.rowGap}>
                    <Pressable style={[s.gradeBtn, { backgroundColor: t.status.errorBg }]} onPress={() => answer(false)}>
                        <Text style={[s.gradeText, { color: t.text.error }]}>✕ Chưa nhớ</Text>
                    </Pressable>
                    <Pressable style={[s.gradeBtn, { backgroundColor: t.status.successBg }]} onPress={() => answer(true)}>
                        <Text style={[s.gradeText, { color: t.text.success }]}>✓ Đã nhớ</Text>
                    </Pressable>
                </View>
            )}
        </SafeAreaView>
    );
}

function formatNext(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString() || d.toDateString() === today.toDateString()) {
        return 'vào ngày mai';
    }
    return d.toLocaleDateString('vi-VN');
}

type Styles = ReturnType<typeof makeStyles>;

function ModeChip({ label, active, onPress, s }: { label: string; active: boolean; onPress: () => void; s: Styles }) {
    return (
        <Pressable onPress={onPress} style={[s.modeChip, active && s.modeChipActive]}>
            <Text style={[s.modeChipText, active && s.modeChipTextActive]}>{label}</Text>
        </Pressable>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface.canvas },
        big: { fontSize: 44, fontWeight: '600', color: t.text.primary },
        secondaryText: { color: t.text.secondary },
        hintText: { color: t.text.tertiary, marginTop: 10, fontSize: 13 },
        rowGap: { flexDirection: 'row', gap: 12, padding: 16, flexWrap: 'wrap', justifyContent: 'center' },
        primaryBtn: { marginTop: 20, backgroundColor: t.surface.inverse, paddingHorizontal: 36, paddingVertical: 13, borderRadius: 12 },
        primaryBtnText: { color: t.text.onInverse, fontSize: 15, fontWeight: '600' },
        ghostBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: t.border.default },
        ghostBtnText: { fontSize: 14, color: t.text.secondary, fontWeight: '600' },
        modeChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: t.border.default },
        modeChipActive: { backgroundColor: t.surface.inverse, borderColor: t.surface.inverse },
        modeChipText: { fontSize: 13, color: t.text.secondary },
        modeChipTextActive: { color: t.text.onInverse },
        topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
        exitIcon: { fontSize: 18, color: t.text.primary },
        progressTrack: { flex: 1, height: 6, backgroundColor: t.surface.raised, borderRadius: 999, overflow: 'hidden' },
        progressFill: { height: 6, backgroundColor: t.accent.bg, borderRadius: 999 },
        cardBox: {
            margin: 16, padding: 24, minHeight: 300, borderRadius: 16,
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
            alignItems: 'center', justifyContent: 'center',
        },
        cardWord: { fontSize: 30, fontWeight: '600', textAlign: 'center', color: t.text.primary },
        cardIpa: { fontSize: 15, color: t.text.secondary, marginTop: 6 },
        cardDef: { fontSize: 16, lineHeight: 23, textAlign: 'center', color: t.text.primary },
        cardDictDef: { fontSize: 13, color: t.text.secondary, textAlign: 'center', marginTop: 8 },
        cardExample: { fontSize: 13, color: t.text.secondary, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
        cardForms: { fontSize: 12, color: t.text.tertiary, marginTop: 12 },
        userTag: { fontSize: 11, color: t.text.warning },
        tapHint: { position: 'absolute', bottom: 14, fontSize: 12, color: t.text.tertiary },
        gradeBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
        gradeText: { fontSize: 15, fontWeight: '600' },
        bars: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginTop: 16, height: 56 },
        barCol: { alignItems: 'center', width: 22 },
        bar: { width: 14, backgroundColor: t.accent.bg, borderRadius: 4 },
        barLabel: { fontSize: 10, color: t.text.tertiary, marginTop: 4 },
        wrongWord: { color: t.accent.bg, fontSize: 15 },
    });
}
