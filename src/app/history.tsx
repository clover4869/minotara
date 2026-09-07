/** SCR-03 — History, grouped by day; confirm before wiping. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openUser } from '@/db/open';
import { historyByDay, deleteHistoryRow, clearHistory } from '@/db/user';
import { C } from '@/components/dict-ui';

interface Row { id: number; query: string; entry_id: number | null; looked_at: string }
interface Section { title: string; data: Row[] }

function dayKey(iso: string): string {
    return iso.slice(0, 10);
}
function dayLabel(iso: string): string {
    const key = dayKey(iso);
    const today = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const yesterday = new Date(today.getTime() - 86400000);
    if (key === ymd(today)) return 'Hôm nay';
    if (key === ymd(yesterday)) return 'Hôm qua';
    const [y, m, d] = key.split('-');
    return `${d}/${m}/${y?.slice(2)}`;
}
function timeLabel(iso: string): string {
    const t = iso.includes('T') ? iso.slice(11, 16) : iso.slice(11, 16);
    return t || iso.slice(5, 16);
}

export default function HistoryScreen() {
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
                <Pressable onPress={() => router.back()} hitSlop={10}><Text style={{ fontSize: 18 }}>←</Text></Pressable>
                <Text style={s.title}>Lịch sử</Text>
                {rows.length > 0 && (
                    <Pressable onPress={confirmClear}>
                        <Text style={{ fontSize: 13, color: C.danger }}>Xoá tất cả</Text>
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
                            <Text style={{ color: C.accent, fontSize: 15 }}>Về tra cứu</Text>
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
                        <Text style={{ flex: 1, fontSize: 15 }}>{item.query}</Text>
                        <Text style={{ fontSize: 12, color: C.muted }}>{timeLabel(item.looked_at)}</Text>
                    </Pressable>
                )}
            />
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
    title: { flex: 1, fontSize: 17, fontWeight: '600' },
    section: {
        fontSize: 12, color: C.muted, letterSpacing: 0.3,
        paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: '#fff',
    },
    row: {
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border,
    },
    empty: { textAlign: 'center', color: C.muted },
});
