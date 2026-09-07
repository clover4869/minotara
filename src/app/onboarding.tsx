/**
 * SCR-00 — First launch: download oxford-app.db, then PRAGMA integrity_check.
 * Resumable via expo-file-system DownloadResumable. For development, the URL
 * field accepts a LAN address (npx serve on your machine).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';

import { DICT_PATH, integrityCheckDictionary, removeDictionaryFile } from '@/db/open';
import { useApp } from '@/stores/app';
import { C } from '@/components/dict-ui';

const DEFAULT_URL = 'http://192.168.1.10:3000/oxford-app.db';

export default function Onboarding() {
    const [url, setUrl] = useState(DEFAULT_URL);
    const [pct, setPct] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const setDictReady = useApp((s) => s.setDictReady);

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

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
    logo: { fontSize: 28, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8 },
    title: { fontSize: 20, fontWeight: '600' },
    sub: { fontSize: 13, color: C.secondary, textAlign: 'center', marginTop: 8, lineHeight: 19 },
    input: {
        alignSelf: 'stretch', marginTop: 20, padding: 12, fontSize: 13,
        borderWidth: 1, borderColor: C.border, borderRadius: 10,
    },
    btn: { marginTop: 16, backgroundColor: '#1B1B1F', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12 },
    btnText: { color: '#fff', fontWeight: '600' },
    status: { marginTop: 20, color: C.secondary, fontSize: 13 },
    track: { alignSelf: 'stretch', height: 8, backgroundColor: C.soft, borderRadius: 999, marginTop: 10 },
    fill: { height: 8, backgroundColor: C.accent, borderRadius: 999 },
    pct: { marginTop: 8, color: C.secondary, fontSize: 13 },
    error: { marginTop: 12, color: C.danger, fontSize: 13, textAlign: 'center' },
});
