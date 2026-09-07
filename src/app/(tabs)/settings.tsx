/** SCR-06 — Settings: dialect, autoplay, review group, data, attribution. */
import { useEffect, useState, type ReactNode } from 'react';
import {
    Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { useApp } from '@/stores/app';
import { C } from '@/components/dict-ui';
import { openDictionary, openUser, dictMeta } from '@/db/open';
import { clearHistory, clearViCache, listSaved } from '@/db/user';
import { clearAudioCache } from '@/services/audio';

export default function SettingsScreen() {
    const app = useApp();
    const [dictVer, setDictVer] = useState<string | null>(null);
    useEffect(() => {
        app.loadSettings();
        openDictionary().then(dictMeta).then(setDictVer).catch(() => setDictVer(null));
    }, []);

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
                <Text style={s.section}>Phát âm</Text>
                <Row label="Giọng đọc">
                    <Segmented
                        value={app.prefDialect}
                        options={[{ v: 'uk', label: 'Anh-Anh' }, { v: 'us', label: 'Anh-Mỹ' }]}
                        onChange={(v) => app.setPrefDialect(v as 'uk' | 'us')}
                    />
                </Row>
                <Row label="Tự phát âm khi mở từ">
                    <Switch value={app.autoplay} onValueChange={app.setAutoplay} />
                </Row>
                <Row label="Cỡ chữ nội dung">
                    <Segmented
                        value={app.fontScale}
                        options={[{ v: 's', label: 'S' }, { v: 'm', label: 'M' }, { v: 'l', label: 'L' }]}
                        onChange={(v) => app.setFontScale(v as 's' | 'm' | 'l')}
                    />
                </Row>

                <Text style={s.section}>Ôn tập</Text>
                <Row label="Tự động đọc từ" sub="Lặp mỗi 3 giây đến khi chấm điểm">
                    <Switch value={app.reviewAutoplay} onValueChange={app.setReviewAutoplay} />
                </Row>
                <Row label="Giọng đọc khi ôn" sub="Dùng chung với cài đặt Phát âm">
                    <Segmented
                        value={app.prefDialect}
                        options={[{ v: 'uk', label: 'UK' }, { v: 'us', label: 'US' }]}
                        onChange={(v) => app.setPrefDialect(v as 'uk' | 'us')}
                    />
                </Row>

                <Text style={s.section}>Dữ liệu</Text>
                <LinkRow label="Xoá lịch sử tra cứu" danger
                    onPress={() => confirm('Xoá lịch sử?', 'Không thể hoàn tác.', async () => {
                        await clearHistory(await openUser());
                    })} />
                <LinkRow label="Xoá cache audio streaming"
                    onPress={() => confirm('Xoá cache audio?', 'Lần phát sau sẽ tải lại khi có mạng.', clearAudioCache)} />
                <LinkRow label="Xoá cache nghĩa Việt"
                    onPress={() => confirm('Xoá cache nghĩa Việt?', 'Sẽ gọi lại API khi mở từ.', async () => {
                        await clearViCache(await openUser());
                    })} />
                <LinkRow label="Export sổ từ (JSON)" onPress={exportSaved} />

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
                        <Text style={[s.aboutLine, { color: C.accent }]}>
                            Nghĩa tiếng Việt: @minhqnd — dict.minhqnd.com (CC BY-SA 4.0)
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
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

function LinkRow({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
    return (
        <Pressable onPress={onPress} style={s.row}>
            <Text style={[s.rowLabel, danger && { color: C.danger }]}>{label}</Text>
        </Pressable>
    );
}

function Segmented<T extends string>({ value, options, onChange }:
    { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
    return (
        <View style={s.seg}>
            {options.map((o) => (
                <Pressable key={o.v} onPress={() => onChange(o.v)}
                    style={[s.segItem, value === o.v && s.segActive]}>
                    <Text style={{ fontSize: 13, color: value === o.v ? '#fff' : C.secondary }}>{o.label}</Text>
                </Pressable>
            ))}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff' },
    section: { fontSize: 12, color: C.muted, letterSpacing: 0.4, paddingHorizontal: 16, marginTop: 20, marginBottom: 4 },
    row: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border,
    },
    rowLabel: { fontSize: 15 },
    rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
    seg: { flexDirection: 'row', borderRadius: 999, backgroundColor: C.soft, padding: 3 },
    segItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
    segActive: { backgroundColor: '#1B1B1F' },
    about: { paddingHorizontal: 16, paddingVertical: 8, gap: 8, paddingBottom: 32 },
    aboutLine: { fontSize: 13, color: C.secondary, lineHeight: 19 },
});
