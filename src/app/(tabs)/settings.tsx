/** SCR-06 — Settings: dialect, autoplay, review group, data, attribution. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { useApp } from '@/stores/app';
import { openDictionary, openUser, dictMeta, integrityCheckDictionary, recordDictionaryMeta, removeDictionaryFile } from '@/db/open';
import { clearHistory, clearViCache, listSaved } from '@/db/user';
import { clearAudioCache } from '@/services/audio';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

export default function SettingsScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const app = useApp();
    const [dictVer, setDictVer] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    useEffect(() => {
        app.loadSettings();
        openDictionary().then(dictMeta).then(setDictVer).catch(() => setDictVer(null));
    }, []);

    async function checkDictionary() {
        setChecking(true);
        try {
            const ok = await integrityCheckDictionary();
            if (ok) {
                await recordDictionaryMeta();
                Alert.alert('Từ điển ổn định', 'Không phát hiện lỗi.');
            } else {
                await removeDictionaryFile();
                Alert.alert('Từ điển bị hỏng', 'Đã xoá — mở lại màn này để tải lại từ điển.', [
                    { text: 'OK', onPress: () => { app.setDictReady(false); router.replace('/onboarding'); } },
                ]);
            }
        } finally {
            setChecking(false);
        }
    }

    function confirm(title: string, message: string, run: () => Promise<void>) {
        Alert.alert(title, message, [
            { text: 'Huỷ', style: 'cancel' },
            { text: 'Xoá', style: 'destructive', onPress: () => { run().catch(() => {}); } },
        ]);
    }

    async function exportSaved() {
        const words = await listSaved(await openUser(), 'az');
        const json = JSON.stringify(words.map((w) => ({
            headword: w.headword, pos: w.pos, cefr: w.cefr,
            user_meaning: w.user_meaning, note: w.note, saved_at: w.saved_at,
        })), null, 2);
        await Share.share({ message: json, title: 'Minotara saved words' });
    }

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <ScrollView>
                <Text style={s.section}>Giao diện</Text>
                <Row label="Giao diện" s={s}>
                    <Segmented
                        value={app.themeMode}
                        options={[
                            { v: 'system', label: 'Hệ thống' },
                            { v: 'light', label: 'Sáng' },
                            { v: 'dark', label: 'Tối' },
                        ]}
                        onChange={(v) => app.setThemeMode(v as 'system' | 'light' | 'dark')}
                        s={s}
                    />
                </Row>

                <Text style={s.section}>Phát âm</Text>
                <Row label="Giọng đọc" s={s}>
                    <Segmented
                        value={app.prefDialect}
                        options={[{ v: 'uk', label: 'Anh-Anh' }, { v: 'us', label: 'Anh-Mỹ' }]}
                        onChange={(v) => app.setPrefDialect(v as 'uk' | 'us')}
                        s={s}
                    />
                </Row>
                <Row label="Tự phát âm khi mở từ" s={s}>
                    <Switch value={app.autoplay} onValueChange={app.setAutoplay} />
                </Row>
                <Row label="Cỡ chữ nội dung" s={s}>
                    <Segmented
                        value={app.fontScale}
                        options={[{ v: 's', label: 'S' }, { v: 'm', label: 'M' }, { v: 'l', label: 'L' }]}
                        onChange={(v) => app.setFontScale(v as 's' | 'm' | 'l')}
                        s={s}
                    />
                </Row>

                <Text style={s.section}>Ôn tập</Text>
                <Row label="Tự động đọc từ" sub="Lặp mỗi 3 giây đến khi chấm điểm" s={s}>
                    <Switch value={app.reviewAutoplay} onValueChange={app.setReviewAutoplay} />
                </Row>
                <Row label="Giọng đọc khi ôn" sub="Dùng chung với cài đặt Phát âm" s={s}>
                    <Segmented
                        value={app.prefDialect}
                        options={[{ v: 'uk', label: 'UK' }, { v: 'us', label: 'US' }]}
                        onChange={(v) => app.setPrefDialect(v as 'uk' | 'us')}
                        s={s}
                    />
                </Row>

                <Text style={s.section}>Dữ liệu</Text>
                <LinkRow label="Xoá lịch sử tra cứu" danger s={s}
                    onPress={() => confirm('Xoá lịch sử?', 'Không thể hoàn tác.', async () => {
                        await clearHistory(await openUser());
                    })} />
                <LinkRow label="Xoá cache audio streaming" s={s}
                    onPress={() => confirm('Xoá cache audio?', 'Lần phát sau sẽ tải lại khi có mạng.', clearAudioCache)} />
                <LinkRow label="Xoá cache nghĩa Việt" s={s}
                    onPress={() => confirm('Xoá cache nghĩa Việt?', 'Sẽ gọi lại API khi mở từ.', async () => {
                        await clearViCache(await openUser());
                    })} />
                <LinkRow label="Export sổ từ (JSON)" s={s} onPress={exportSaved} />
                <LinkRow label={checking ? 'Đang kiểm tra…' : 'Kiểm tra từ điển'} s={s}
                    onPress={checking ? () => {} : checkDictionary} />
                <Row label="Gói audio offline" sub="Sắp ra mắt" s={s}>
                    <Text style={s.comingSoon}>Sắp ra mắt</Text>
                </Row>

                <Text style={s.section}>Về app</Text>
                <View style={s.about}>
                    <Text style={s.aboutLine}>
                        Minotara {Constants.expoConfig?.version ?? '1.0.0'}
                        {dictVer ? ` · dữ liệu ${dictVer}` : ''}
                    </Text>
                    <Text style={s.aboutLine}>
                        Audio & inflection data một phần từ Wiktionary (CC-BY-SA)
                    </Text>
                    <Pressable onPress={() => Linking.openURL('https://dict.minhqnd.com')}>
                        <Text style={[s.aboutLine, s.aboutLink]}>
                            Nghĩa tiếng Việt: @minhqnd — dict.minhqnd.com (CC BY-SA 4.0)
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

type Styles = ReturnType<typeof makeStyles>;

function Row({ label, sub, children, s }: { label: string; sub?: string; children: ReactNode; s: Styles }) {
    return (
        <View style={s.row}>
            <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>{label}</Text>
                {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
            </View>
            {children}
        </View>
    );
}

function LinkRow({ label, onPress, danger, s }: { label: string; onPress: () => void; danger?: boolean; s: Styles }) {
    return (
        <Pressable onPress={onPress} style={s.row}>
            <Text style={[s.rowLabel, danger && s.rowLabelDanger]}>{label}</Text>
        </Pressable>
    );
}

function Segmented<T extends string>({ value, options, onChange, s }:
    { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; s: Styles }) {
    return (
        <View style={s.seg}>
            {options.map((o) => (
                <Pressable key={o.v} onPress={() => onChange(o.v)}
                    style={[s.segItem, value === o.v && s.segActive]}>
                    <Text style={[s.segText, value === o.v && s.segTextActive]}>{o.label}</Text>
                </Pressable>
            ))}
        </View>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        section: { fontSize: 12, color: t.text.tertiary, letterSpacing: 0.4, paddingHorizontal: 16, marginTop: 20, marginBottom: 4 },
        row: {
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
        },
        rowLabel: { fontSize: 15, color: t.text.primary },
        rowLabelDanger: { color: t.text.error },
        rowSub: { fontSize: 12, color: t.text.tertiary, marginTop: 2 },
        comingSoon: { fontSize: 13, color: t.text.tertiary, fontStyle: 'italic' },
        seg: { flexDirection: 'row', borderRadius: 999, backgroundColor: t.surface.raised, padding: 3 },
        segItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
        segActive: { backgroundColor: t.surface.inverse },
        segText: { fontSize: 13, color: t.text.secondary },
        segTextActive: { color: t.text.onInverse },
        about: { paddingHorizontal: 16, paddingVertical: 8, gap: 8, paddingBottom: 32 },
        aboutLine: { fontSize: 13, color: t.text.secondary, lineHeight: 19 },
        aboutLink: { color: t.accent.bg },
    });
}
