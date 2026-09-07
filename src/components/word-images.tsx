/**
 * "Ảnh minh hoạ" — photos for the word being read, rendered inside SCR-02
 * Word Detail rather than as a tab of its own. A picture is a memory aid for
 * *this* word; searching images from a standalone tab meant retyping the word
 * with none of its meaning on screen, which is the wrong place to look at them.
 *
 * Lazy by construction: SCR-02 chỉ mount view "Ảnh" khi người dùng bấm sang
 * nó (xem `visited` trong app/word/[q].tsx) — nên chính việc mở tab LÀ hành vi
 * "tôi muốn xem ảnh". Từ nào không bấm vào thì không tốn một request nào, và
 * điều đó quan trọng vì endpoint phía sau (Bing, xem services/image-search.ts)
 * không có tài liệu và có chặn tốc độ.
 *
 * Fail-soft like the Vietnamese-meaning block above it: no network → a
 * "cần mạng" row with a retry, never an error state that blocks the entry.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Network from 'expo-network';

import { openUser } from '@/db/open';
import { searchImages, type ImageResult } from '@/services/image-search';
import { UiIcon, Icons } from '@/components/dict-ui';
import { usePalette } from '@/theme/use-palette';
import { space, radius } from '@/theme/tokens';
import type { Semantic } from '@/theme/tokens';

/** 3×3 — enough to recognise the word, not a gallery. Keeps the section from swallowing the entry. */
const MAX_SHOWN = 9;

function hostOf(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * `searchImages()` bật `failed` cho mọi kiểu thất bại — 403, timeout, đổi
 * HTML, JSON hỏng — và nó không biết gì về thiết bị. Trước đây màn hình đọc cờ
 * đó rồi in "Cần mạng để xem ảnh", nên khi nguồn ảnh chết người dùng đi kiểm
 * tra Wi-Fi. Hỏi trạng thái mạng ở đây để nói đúng thứ đang sai.
 */
async function whyFailed(): Promise<'offline' | 'source'> {
    try {
        const n = await Network.getNetworkStateAsync();
        return n.isConnected ? 'source' : 'offline';
    } catch {
        return 'source'; // không đọc được trạng thái mạng thì đừng đoán là do mạng
    }
}

export function WordImages({ word }: { word: string }) {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [results, setResults] = useState<ImageResult[] | null>(null);
    const [failed, setFailed] = useState<'offline' | 'source' | null>(null);
    const [tick, setTick] = useState(0);
    const [preview, setPreview] = useState<ImageResult | null>(null);

    useEffect(() => {
        const q = word.trim();
        if (!q) { setResults([]); setFailed(null); return; }
        let alive = true;
        setResults(null);
        setFailed(null);
        (async () => {
            try {
                const r = await searchImages(await openUser(), q);
                if (!alive) return;
                setResults(r.results);
                // Chỉ hỏi trạng thái mạng khi đã fail — hỏi trước là thêm một
                // lần chờ vô ích cho đường đi thành công.
                setFailed(r.failed ? await whyFailed() : null);
            } catch {
                if (!alive) return;
                setResults([]);
                setFailed(await whyFailed());
            }
        })();
        return () => { alive = false; };
    }, [word, tick]);

    if (results === null) {
        return <ActivityIndicator size="small" color={t.accent.bg} style={{ marginTop: space.sm }} />;
    }

    if (failed && results.length === 0) {
        return (
            <View style={[s.row, { marginTop: space.sm }]}>
                <Text style={s.dim}>
                    {failed === 'offline'
                        ? 'Cần mạng để xem ảnh'
                        : 'Nguồn ảnh đang không phản hồi — không phải do mạng của bạn'}
                </Text>
                <Pressable onPress={() => setTick((n) => n + 1)} style={s.row} hitSlop={8}>
                    <UiIcon icon={Icons.RotateCcw} size={14} color={t.accent.bg} />
                    <Text style={s.link}>Thử lại</Text>
                </Pressable>
            </View>
        );
    }

    if (results.length === 0) {
        return <Text style={s.dim}>Không tìm thấy ảnh nào cho “{word}”.</Text>;
    }

    return (
        <>
            <View style={s.grid}>
                {results.slice(0, MAX_SHOWN).map((item, i) => (
                    <Pressable
                        key={`${item.thumbnail}-${i}`}
                        style={s.cell}
                        onPress={() => setPreview(item)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={item.title || `Ảnh ${i + 1} của ${word}`}
                    >
                        <Image source={{ uri: item.thumbnail }} style={s.thumb} contentFit="cover" />
                    </Pressable>
                ))}
            </View>
            <Text style={s.attribution}>Ảnh từ Bing — chỉ để tham khảo trong app.</Text>

            <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
                <Pressable style={s.modalBackdrop} onPress={() => setPreview(null)}>
                    {/* swallow taps on the card so only the backdrop dismisses */}
                    <Pressable style={s.modalCard} onPress={() => {}}>
                        {preview && (
                            <>
                                <Image source={{ uri: preview.image }} style={s.previewImage} contentFit="contain" />
                                {preview.title ? <Text style={s.previewTitle} numberOfLines={2}>{preview.title}</Text> : null}
                                <Pressable onPress={() => preview.sourceUrl && Linking.openURL(preview.sourceUrl)}>
                                    <Text style={s.previewSource}>
                                        Nguồn: {hostOf(preview.sourceUrl) || preview.source || 'không rõ'}
                                    </Text>
                                </Pressable>
                                <Pressable style={s.closeBtn} onPress={() => setPreview(null)} hitSlop={8}>
                                    <UiIcon icon={Icons.X} color={t.text.secondary} />
                                </Pressable>
                            </>
                        )}
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        dim: { fontSize: 13, color: t.text.tertiary, marginTop: 8 },
        link: { color: t.accent.bg, fontSize: 14 },
        // Plain flex-wrap, not a FlatList: this lives inside SCR-02's ScrollView,
        // and a nested VirtualizedList there breaks scrolling (and warns).
        grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm },
        cell: { width: '31.5%', aspectRatio: 1 },
        thumb: { flex: 1, borderRadius: radius.sm, backgroundColor: t.surface.raised },
        attribution: { fontSize: 11, color: t.text.tertiary, marginTop: 10 },
        modalBackdrop: {
            flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
            alignItems: 'center', justifyContent: 'center', padding: space.lg,
        },
        modalCard: {
            backgroundColor: t.surface.overlay, borderRadius: radius.lg,
            padding: space.md, width: '100%', maxWidth: 480, gap: space.sm,
        },
        previewImage: { width: '100%', height: 260, borderRadius: radius.md, backgroundColor: t.surface.raised },
        previewTitle: { fontSize: 14, color: t.text.primary },
        previewSource: { fontSize: 12, color: t.accent.bg },
        closeBtn: {
            position: 'absolute', top: 8, right: 8, padding: 6, borderRadius: 999,
            backgroundColor: t.surface.raised,
        },
    });
}
