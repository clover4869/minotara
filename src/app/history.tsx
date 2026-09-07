/** SCR-03 — History, grouped by day; confirm before wiping. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openUser } from '@/db/open';
import { historyByDay, deleteHistoryRow, clearHistory } from '@/db/user';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

interface Row { id: number; query: string; entry_id: number | null; looked_at: string }
interface Section { title: string; data: Row[] }

/** SQLite's `datetime('now')` yields 'YYYY-MM-DD HH:MM:SS' (space, no timezone) representing UTC — normalize to a real Date before using any local-time accessor, otherwise day grouping and the time-of-day shown are off by the device's UTC offset. */
function toLocalDate(sqliteDatetime: string): Date {
    return new Date(sqliteDatetime.replace(' ', 'T') + 'Z');
}
function pad2(n: number): string {
    return String(n).padStart(2, '0');
}
function dayKey(iso: string): string {
    const d = toLocalDate(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dayLabel(iso: string): string {
    const d = toLocalDate(iso);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Hôm nay';
    if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
function timeLabel(iso: string): string {
    const d = toLocalDate(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function HistoryScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [rows, setRows] = useState<Row[]>([]);
    const [offset, setOffset] = useState(0);
    const [done, setDone] = useState(false);

    const reload = useCallback(() => {
        openUser().then(async (u) => {
            const first = await historyByDay(u, 50, 0);
            setRows(first);
            setOffset(first.length);
            setDone(first.length < 50);
        });
    }, []);
    useFocusEffect(reload);

    const sections: Section[] = useMemo(() => {
        const map = new Map<string, Row[]>();
        for (const r of rows) {
            const k = dayKey(r.looked_at);
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(r);
        }
        return [...map.entries()].map(([k, data]) => ({
            title: dayLabel(data[0]?.looked_at ?? k),
            data,
        }));
    }, [rows]);

    async function loadMore() {
        if (done) return;
        const more = await historyByDay(await openUser(), 50, offset);
        setRows((prev) => [...prev, ...more]);
        setOffset((n) => n + more.length);
        if (more.length < 50) setDone(true);
    }

    function confirmClear() {
        Alert.alert('Xoá tất cả lịch sử?', 'Không thể hoàn tác.', [
            { text: 'Huỷ', style: 'cancel' },
            { text: 'Xoá', style: 'destructive', onPress: async () => {
                await clearHistory(await openUser());
                reload();
            } },
        ]);
    }

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <View style={s.header}>
                <Pressable onPress={() => router.back()} hitSlop={10}><Text style={s.back}>←</Text></Pressable>
                <Text style={s.title}>Lịch sử</Text>
                {rows.length > 0 && (
                    <Pressable onPress={confirmClear}>
                        <Text style={s.clearAll}>Xoá tất cả</Text>
                    </Pressable>
                )}
            </View>
            <SectionList
                sections={sections}
                keyExtractor={(r) => String(r.id)}
                onEndReached={loadMore}
                onEndReachedThreshold={0.4}
                ListEmptyComponent={
                    <View style={{ alignItems: 'center', marginTop: 40, gap: 12 }}>
                        <Text style={s.empty}>Chưa tra từ nào</Text>
                        <Pressable onPress={() => router.replace('/')}>
                            <Text style={s.emptyLink}>Về tra cứu</Text>
                        </Pressable>
                    </View>
                }
                renderSectionHeader={({ section }) => (
                    <Text style={s.section}>{section.title}</Text>
                )}
                renderItem={({ item }) => (
                    <Pressable
                        style={s.row}
                        onPress={() => router.push(
                            item.entry_id
                                ? { pathname: '/word/[q]', params: { q: item.query, id: String(item.entry_id) } }
                                : `/word/${encodeURIComponent(item.query)}`,
                        )}
                        onLongPress={async () => { await deleteHistoryRow(await openUser(), item.id); reload(); }}
                    >
                        <Text style={s.query}>{item.query}</Text>
                        <Text style={s.time}>{timeLabel(item.looked_at)}</Text>
                    </Pressable>
                )}
            />
        </SafeAreaView>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
        back: { fontSize: 18, color: t.text.primary },
        title: { flex: 1, fontSize: 17, fontWeight: '600', color: t.text.primary },
        clearAll: { fontSize: 13, color: t.text.error },
        section: {
            fontSize: 12, color: t.text.tertiary, letterSpacing: 0.3,
            paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: t.surface.canvas,
        },
        row: {
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
            borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
        },
        query: { flex: 1, fontSize: 15, color: t.text.primary },
        time: { fontSize: 12, color: t.text.tertiary },
        empty: { textAlign: 'center', color: t.text.tertiary },
        emptyLink: { color: t.accent.bg, fontSize: 15 },
    });
}
