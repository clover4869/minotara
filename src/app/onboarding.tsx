/**
 * SCR-00 — First launch: fetch oxford-app.db, then PRAGMA integrity_check.
 *
 * Mặc định tải bản `.zip` từ GitHub Release: 26MB thay vì 143MB, tức là nhanh
 * hơn ~5,5 lần trên cùng đường truyền. `.so` và `.db` đều không nén thêm được
 * lúc truyền nên chỗ tiết kiệm này chỉ có được bằng cách nén sẵn file.
 *
 * Màn này tự tải ngay khi mở, không nút không ô nhập: chưa có từ điển thì
 * chẳng có gì để người dùng quyết. Ô URL chỉ hiện khi lỗi VÀ đang ở bản dev —
 * luồng vẫn nhận cả `.db` thô, vì `npx serve` một file .db trong LAN là cách
 * debug nhanh nhất, đừng làm mất nó. Bản release chặn HTTP thô (xem `hintFor`)
 * nên địa chỉ LAN chỉ chạy được ở bản debug, đúng chỗ ô đó xuất hiện.
 *
 * Tải xuống resumable qua expo-file-system; giải nén bằng react-native-zip-archive
 * vì expo-file-system SDK 56 không có API giải nén nào.
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { subscribe, unzip } from 'react-native-zip-archive';

import { DICT_PATH, integrityCheckDictionary, recordDictionaryMeta, removeDictionaryFile } from '@/db/open';
import { useApp } from '@/stores/app';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

const DEFAULT_URL = 'https://github.com/clover4869/minotara/releases/download/db-v1/oxford-app.db.zip';
const ZIP_PATH = `${DICT_PATH}.zip`;

type Phase =
    | { kind: 'download'; pct: number }
    | { kind: 'unzip'; pct: number }
    | { kind: 'check' };

const LABEL: Record<Phase['kind'], string> = {
    download: 'Đang tải từ điển…',
    unzip: 'Đang giải nén…',
    check: 'Đang kiểm tra dữ liệu…',
};

/**
 * Một thanh tiến độ duy nhất cho cả hai việc: 80% đầu là tải, 20% sau là giải
 * nén. Hai thanh nối tiếp nhau, mỗi thanh tự chạy 0→100%, làm người dùng
 * tưởng đã xong rồi lại thấy quay về đầu.
 *
 * Tỉ lệ 80/20 là theo cảm nhận, không phải theo thời gian thật: đo trên
 * emulator thì tải 26MB mất khoảng 30s còn giải nén 143MB chỉ vài giây. Chia
 * đúng theo thời gian thì phần giải nén gần như vô hình, mà nó lại là lúc dễ
 * hết dung lượng nhất — cần thấy được là đang làm gì.
 */
const DOWNLOAD_SHARE = 0.8;

function overallPct(p: Phase): number {
    if (p.kind === 'download') return p.pct * DOWNLOAD_SHARE;
    if (p.kind === 'unzip') return DOWNLOAD_SHARE + p.pct * (1 - DOWNLOAD_SHARE);
    return 1;
}

/**
 * react-native-zip-archive nhận đường dẫn hệ thống, còn expo-file-system trả
 * về URI `file:///…`. Truyền nguyên URI vào thì zip4j hiểu "file:" là một
 * thư mục và tạo ra đúng thư mục đó thay vì báo lỗi, nên lỗi sẽ hiện ở tận
 * bước integrity_check dưới dạng "không tìm thấy file" — rất khó truy.
 */
function fsPath(uri: string): string {
    const p = uri.replace(/^file:\/\//, '');
    try {
        return decodeURIComponent(p);
    } catch {
        return p; // đường dẫn có '%' thật thì cứ để nguyên, còn hơn là throw
    }
}

/** Gợi ý cho những lỗi mà nguyên văn của hệ thống không nói được phải làm gì. */
function hintFor(msg: string): string {
    if (/enospc|no space|disk full|quota/i.test(msg)) {
        return 'Không đủ dung lượng. Cần khoảng 200MB trống: 26MB cho file nén cộng 143MB sau khi giải nén.';
    }
    // Android chặn HTTP thô từ targetSdk 28 trở lên, và bản release không bật
    // usesCleartextTraffic như bản debug. Nguyên văn của hệ thống là
    // "CLEARTEXT communication to … not permitted" — đọc xong vẫn không biết sửa gì.
    if (/cleartext/i.test(msg)) {
        return 'Bản phát hành không cho tải qua HTTP thô. Dùng địa chỉ bắt đầu bằng https://';
    }
    return msg;
}

export default function Onboarding() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [url, setUrl] = useState(DEFAULT_URL);
    // Khởi tạo ở 0% chứ không null: hiệu ứng tự tải chỉ chạy sau lần render
    // đầu, để null thì có một frame màn hình trống không rõ đang chờ gì.
    const [phase, setPhase] = useState<Phase | null>({ kind: 'download', pct: 0 });
    const [error, setError] = useState<string | null>(null);
    const setDictReady = useApp((st) => st.setDictReady);
    const started = useRef(false);

    // Chưa có từ điển thì việc duy nhất ở màn này là tải nó về — không có gì
    // để người dùng chọn, nên đừng bắt họ bấm. `started` chặn chạy hai lần:
    // Fast Refresh cho hiệu ứng chạy lại, mà hai luồng tải cùng ghi một file
    // đích là đường tới file .zip hỏng.
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        download();
    }, []);

    async function download() {
        const src = url.trim();
        const isZip = /\.zip($|\?)/i.test(src);
        setError(null);
        setPhase({ kind: 'download', pct: 0 });
        try {
            // Dọn trước khi ghi: file .db cũ kèm -wal/-shm của nó, và cả file
            // zip còn sót của lần thử trước. Giải nén lên một .db cũ mà để lại
            // WAL cũ là đường ngắn nhất tới "file is not a database".
            await removeDictionaryFile();
            await FileSystem.deleteAsync(ZIP_PATH, { idempotent: true });

            const dl = FileSystem.createDownloadResumable(src, isZip ? ZIP_PATH : DICT_PATH, {},
                (p) => setPhase({
                    kind: 'download',
                    pct: p.totalBytesExpectedToWrite > 0
                        ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0,
                }));
            const res = await dl.downloadAsync();
            if (!res || res.status !== 200) throw new Error(`HTTP ${res?.status ?? '?'}`);

            if (isZip) {
                setPhase({ kind: 'unzip', pct: 0 });
                const sub = subscribe(({ progress }) => setPhase({ kind: 'unzip', pct: progress }));
                try {
                    // Trong zip, file tên đúng là oxford-app.db nên nó rơi
                    // thẳng vào DICT_PATH, không cần đổi tên sau.
                    await unzip(fsPath(ZIP_PATH), fsPath(FileSystem.documentDirectory!));
                } finally {
                    sub.remove();
                    // Xoá zip kể cả khi giải nén lỗi: 26MB nằm lại chẳng ai
                    // đọc, và bấm "Thử lại" là tải bản mới chứ không dùng lại nó.
                    await FileSystem.deleteAsync(ZIP_PATH, { idempotent: true });
                }
            }

            setPhase({ kind: 'check' });
            const ok = await integrityCheckDictionary();
            if (!ok) {
                await removeDictionaryFile();
                throw new Error('File từ điển bị hỏng — thử tải lại');
            }
            await recordDictionaryMeta();
            setDictReady(true);
            router.replace('/');
        } catch (e: any) {
            setError(hintFor(String(e?.message ?? e)));
            setPhase(null);
        }
    }

    return (
        <SafeAreaView style={s.root}>
            <Text style={s.logo}>Minotara</Text>
            <Text style={s.title}>Chuẩn bị từ điển</Text>
            <Text style={s.sub}>
                Tải dữ liệu một lần: 26MB, giải nén ra 143MB trên máy. Nên dùng Wi-Fi.
            </Text>
            {/*
              Đường đi thành công không có nút và không có ô URL: chưa có từ
              điển thì việc duy nhất là tải, người dùng không có gì để quyết.
              Chỉ khi lỗi mới hiện lối ra — và ô URL thì chỉ hiện ở bản dev,
              nơi trỏ vào `npx serve` trong LAN vẫn là cách debug nhanh nhất.
            */}
            {phase !== null && (
                <>
                    <View style={s.track}>
                        <View style={[s.fill, { width: `${Math.round(overallPct(phase) * 100)}%` }]} />
                    </View>
                    <Text style={s.status}>
                        {LABEL[phase.kind]}  {Math.round(overallPct(phase) * 100)}%
                    </Text>
                </>
            )}
            {error && (
                <>
                    <Text style={s.error}>{error}</Text>
                    {__DEV__ && (
                        <TextInput style={s.input} value={url} onChangeText={setUrl}
                            placeholderTextColor={t.text.tertiary}
                            autoCapitalize="none" autoCorrect={false}
                            placeholder="URL oxford-app.db.zip hoặc .db" />
                    )}
                    <Pressable style={s.btn} onPress={download}>
                        <Text style={s.btnText}>Thử lại</Text>
                    </Pressable>
                </>
            )}
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
        status: { marginTop: 12, color: t.text.secondary, fontSize: 13, fontVariant: ['tabular-nums'] },
        track: { alignSelf: 'stretch', height: 8, backgroundColor: t.surface.raised, borderRadius: 999, marginTop: 28 },
        fill: { height: 8, backgroundColor: t.accent.bg, borderRadius: 999 },
        error: { marginTop: 12, color: t.text.error, fontSize: 13, textAlign: 'center' },
    });
}
