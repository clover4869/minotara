/**
 * SCR-00 — First launch: download oxford-app.db, then PRAGMA integrity_check.
 * Resumable via expo-file-system DownloadResumable. For development, the URL
 * field accepts a LAN address (npx serve on your machine).
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';

import { DICT_PATH, integrityCheckDictionary, recordDictionaryMeta, removeDictionaryFile } from '@/db/open';
import { useApp } from '@/stores/app';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

const DEFAULT_URL = 'http://192.168.1.10:3000/oxford-app.db';

export default function Onboarding() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [url, setUrl] = useState(DEFAULT_URL);
    const [pct, setPct] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const setDictReady = useApp((st) => st.setDictReady);

    async function download() {
        setError(null);
        setPct(0);
        try {
            const dl = FileSystem.createDownloadResumable(url, DICT_PATH, {},
                (p) => setPct(p.totalBytesExpectedToWrite > 0
                    ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0));
            const res = await dl.downloadAsync();
            if (!res || res.status !== 200) throw new Error(`HTTP ${res?.status ?? '?'}`);
            const ok = await integrityCheckDictionary();
            if (!ok) {
                await removeDictionaryFile();
                throw new Error('File từ điển bị hỏng — thử tải lại');
            }
            await recordDictionaryMeta();
            setDictReady(true);
            router.replace('/');
        } catch (e: any) {
            const msg = String(e?.message ?? e);
            const disk = /enospc|no space|disk full|quota/i.test(msg);
            setError(disk
                ? 'Không đủ dung lượng. Cần vài trăm MB trống để tải từ điển.'
                : (e.message ?? 'Tải thất bại'));
            setPct(null);
        }
    }

    return (
        <SafeAreaView style={s.root}>
            <Text style={s.logo}>Minotara</Text>
            <Text style={s.title}>Chuẩn bị từ điển</Text>
            <Text style={s.sub}>
                Tải dữ liệu từ điển một lần (~vài trăm MB). Nên dùng Wi-Fi.
            </Text>
            <TextInput style={s.input} value={url} onChangeText={setUrl}
                placeholderTextColor={t.text.tertiary}
                autoCapitalize="none" autoCorrect={false} placeholder="URL oxford-app.db" />
            {pct === null ? (
                <Pressable style={s.btn} onPress={download}>
                    <Text style={s.btnText}>{error ? 'Thử lại' : 'Tải về'}</Text>
                </Pressable>
            ) : (
                <>
                    <Text style={s.status}>Đang chuẩn bị từ điển…</Text>
                    <View style={s.track}><View style={[s.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
                    <Text style={s.pct}>{Math.round(pct * 100)}%</Text>
                </>
            )}
            {error && <Text style={s.error}>{error}</Text>}
        </SafeAreaView>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas, alignItems: 'center', justifyContent: 'center', padding: 24 },
        logo: { fontSize: 28, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8, color: t.text.primary },
        title: { fontSize: 20, fontWeight: '600', color: t.text.primary },
        sub: { fontSize: 13, color: t.text.secondary, textAlign: 'center', marginTop: 8, lineHeight: 19 },
        input: {
            alignSelf: 'stretch', marginTop: 20, padding: 12, fontSize: 13, color: t.text.primary,
            borderWidth: 1, borderColor: t.border.default, borderRadius: 10,
        },
        btn: { marginTop: 16, backgroundColor: t.surface.inverse, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12 },
        btnText: { color: t.text.onInverse, fontWeight: '600' },
        status: { marginTop: 20, color: t.text.secondary, fontSize: 13 },
        track: { alignSelf: 'stretch', height: 8, backgroundColor: t.surface.raised, borderRadius: 999, marginTop: 10 },
        fill: { height: 8, backgroundColor: t.accent.bg, borderRadius: 999 },
        pct: { marginTop: 8, color: t.text.secondary, fontSize: 13 },
        error: { marginTop: 12, color: t.text.error, fontSize: 13, textAlign: 'center' },
    });
}
