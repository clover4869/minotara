/**
 * Cấu hình báo thức học bài.
 *
 * Mọi thay đổi đặt lại lịch NGAY, không có nút "Lưu". Màn cấu hình có nút Lưu
 * là màn có hai trạng thái — cái đang hiện và cái đang chạy thật — và người
 * dùng chỉ phát hiện chúng lệch nhau vào sáng hôm sau, lúc báo thức không kêu.
 */
import { useCallback, useMemo, useState } from 'react';
import {
    Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { openUser } from '@/db/open';
import {
    getAlarm, setAlarm, recentAlarmEvents, ALARM_DEFAULT,
    type AlarmConfig, type AlarmEventStatus,
} from '@/db/user';
import { rescheduleAlarm, cancelAlarm, requestAlarmPermission, hasAlarmPermission, scheduledCount } from '@/services/alarm';
import { UiIcon, Icons } from '@/components/dict-ui';
import { usePalette } from '@/theme/use-palette';
import type { Semantic } from '@/theme/tokens';

/** expo-notifications đánh số 1 = Chủ nhật. Mảng này xếp lại theo thói quen
 *  Việt Nam (tuần bắt đầu từ thứ hai) nhưng vẫn mang đúng số của thư viện. */
const WEEKDAYS: { n: number; label: string }[] = [
    { n: 2, label: 'T2' }, { n: 3, label: 'T3' }, { n: 4, label: 'T4' },
    { n: 5, label: 'T5' }, { n: 6, label: 'T6' }, { n: 7, label: 'T7' },
    { n: 1, label: 'CN' },
];

const TARGETS = [1, 3, 5, 10];

const EVENT_LABEL: Record<AlarmEventStatus, string> = {
    fired: 'đã mở bài',
    completed: 'đã làm xong',
    missed: 'bỏ lỡ',
};

export default function AlarmSettingsScreen() {
    const t = usePalette();
    const s = useMemo(() => makeStyles(t), [t]);
    const [cfg, setCfg] = useState<AlarmConfig>(ALARM_DEFAULT);
    const [granted, setGranted] = useState(true);
    const [scheduled, setScheduled] = useState(0);
    const [events, setEvents] = useState<{ status: AlarmEventStatus; at: string }[]>([]);

    const refresh = useCallback(async () => {
        const db = await openUser();
        setCfg(await getAlarm(db));
        setEvents(await recentAlarmEvents(db, 3));
        setGranted(await hasAlarmPermission());
        setScheduled(await scheduledCount());
    }, []);

    useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

    /**
     * Ghi cấu hình + đặt lại lịch trong một bước. Không tách ra được: cấu hình
     * đã lưu mà lịch chưa đổi là đúng cái sai khó tìm nhất ở đây.
     *
     * Đặt lịch hỏng thì PHẢI báo ra màn hình. Đã dính đúng một lần: trigger
     * sai nền tảng ném lỗi, cấu hình vẫn lưu, công tắc vẫn hiện "Bật", và thứ
     * duy nhất tố cáo là dòng "đang đặt 0 lịch" ở cuối trang. Nuốt lỗi ở đây
     * nghĩa là người dùng chỉ biết mình hỏng vào sáng hôm sau.
     */
    async function apply(next: AlarmConfig) {
        setCfg(next);
        try {
            const db = await openUser();
            await setAlarm(db, next);
            if (next.enabled) {
                await rescheduleAlarm(next);
            } else {
                await cancelAlarm();
            }
            setScheduled(await scheduledCount());
        } catch (e) {
            setScheduled(0);
            Alert.alert(
                'Không đặt được lịch báo thức',
                `Cấu hình đã lưu nhưng hệ thống từ chối đặt lịch, nên đến giờ sẽ không có gì kêu.\n\n${
                    e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    async function toggleEnabled(on: boolean) {
        if (!on) { await apply({ ...cfg, enabled: false }); return; }
        const ok = await requestAlarmPermission();
        setGranted(ok);
        if (!ok) {
            Alert.alert(
                'Chưa có quyền thông báo',
                'Không có quyền này thì lịch vẫn đặt được nhưng đến giờ sẽ không hiện gì.',
                [
                    { text: 'Để sau', style: 'cancel' },
                    { text: 'Mở cài đặt', onPress: () => Linking.openSettings() },
                ],
            );
            return;
        }
        await apply({ ...cfg, enabled: true });
    }

    function toggleDay(n: number) {
        const has = cfg.days.includes(n);
        const days = has ? cfg.days.filter((d) => d !== n) : [...cfg.days, n].sort();
        // Bỏ hết ngày thì báo thức không bao giờ kêu, nhưng công tắc vẫn "Bật"
        // — một trạng thái nói dối. Giữ lại ít nhất một ngày.
        if (!days.length) return;
        apply({ ...cfg, days });
    }

    function shiftTime(field: 'hour' | 'minute', delta: number) {
        const mod = field === 'hour' ? 24 : 60;
        const step = field === 'hour' ? 1 : 5;
        const v = (cfg[field] + delta * step + mod) % mod;
        apply({ ...cfg, [field]: v });
    }

    const pad = (n: number) => String(n).padStart(2, '0');

    return (
        <SafeAreaView style={s.root} edges={['top']}>
            <View style={s.header}>
                <Pressable onPress={() => router.back()} hitSlop={10}>
                    <UiIcon icon={Icons.ArrowLeft} size={24} color={t.text.primary} />
                </Pressable>
                <Text style={s.headerTitle}>Báo thức học bài</Text>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <View style={s.row}>
                    <View style={{ flex: 1 }}>
                        <Text style={s.rowLabel}>Bật báo thức</Text>
                        <Text style={s.rowSub}>
                            Đến giờ sẽ có thông báo. Chạm vào để làm bài — làm đủ số câu đúng mới tắt được.
                        </Text>
                    </View>
                    <Switch value={cfg.enabled} onValueChange={toggleEnabled} />
                </View>

                {!granted && cfg.enabled ? (
                    <Pressable style={s.warn} onPress={() => Linking.openSettings()}>
                        <Text style={s.warnText}>
                            Chưa có quyền thông báo — đến giờ sẽ không hiện gì. Chạm để mở cài đặt.
                        </Text>
                    </Pressable>
                ) : null}

                <Text style={s.section}>Giờ</Text>
                <View style={s.clock}>
                    <TimeColumn value={pad(cfg.hour)} onUp={() => shiftTime('hour', 1)} onDown={() => shiftTime('hour', -1)} s={s} t={t} />
                    <Text style={s.clockColon}>:</Text>
                    <TimeColumn value={pad(cfg.minute)} onUp={() => shiftTime('minute', 1)} onDown={() => shiftTime('minute', -1)} s={s} t={t} />
                </View>

                <Text style={s.section}>Ngày lặp</Text>
                <View style={s.days}>
                    {WEEKDAYS.map((d) => {
                        const on = cfg.days.includes(d.n);
                        return (
                            <Pressable key={d.n} onPress={() => toggleDay(d.n)}
                                style={[s.day, on && s.dayOn]}>
                                <Text style={[s.dayText, on && s.dayTextOn]}>{d.label}</Text>
                            </Pressable>
                        );
                    })}
                </View>

                <Text style={s.section}>Kiểu bài</Text>
                <KindOption
                    s={s} active={cfg.kind === 'quiz'}
                    title="Trắc nghiệm 4 đáp án"
                    sub="Một từ kèm ảnh, chọn nghĩa đúng trong bốn nghĩa. Bấm bừa không qua được."
                    onPress={() => apply({ ...cfg, kind: 'quiz' })}
                />
                <KindOption
                    s={s} active={cfg.kind === 'review'}
                    title="Thẻ ôn tập"
                    sub="Như phiên ôn bình thường: lật thẻ rồi tự chấm nhớ hay chưa nhớ."
                    onPress={() => apply({ ...cfg, kind: 'review' })}
                />

                <Text style={s.section}>Số câu đúng cần đạt</Text>
                <View style={s.targets}>
                    {TARGETS.map((n) => (
                        <Pressable key={n} onPress={() => apply({ ...cfg, target: n })}
                            style={[s.target, cfg.target === n && s.targetOn]}>
                            <Text style={[s.targetText, cfg.target === n && s.targetTextOn]}>{n}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={s.note}>
                    Đếm câu ĐÚNG, không phải câu đã xem — sai thì từ đó quay lại cuối hàng đợi.
                </Text>

                <Text style={s.section}>Cần biết</Text>
                <Text style={s.note}>
                    Không chạm vào thông báo thì app không tự mở được — Android không cho app
                    thường chiếm màn hình. Chuông cũng chỉ kêu vài giây theo giới hạn của hệ điều hành.
                </Text>
                {Platform.OS === 'android' ? (
                    <Text style={s.note}>
                        Máy Xiaomi/Oppo/Vivo/Samsung có thể chặn app chạy nền và nuốt luôn báo thức.
                        Nếu sáng ra không thấy gì, vào phần tiết kiệm pin của máy và cho Minotara chạy nền.
                    </Text>
                ) : null}

                {cfg.enabled ? (
                    <Text style={s.note}>Đang đặt {scheduled} lịch trong hệ thống.</Text>
                ) : null}

                {events.length ? (
                    <>
                        <Text style={s.section}>Gần đây</Text>
                        {events.map((e, i) => (
                            <Text key={`${e.at}-${i}`} style={s.note}>
                                {new Date(e.at.replace(' ', 'T') + 'Z').toLocaleString('vi-VN')} — {EVENT_LABEL[e.status]}
                            </Text>
                        ))}
                    </>
                ) : null}
            </ScrollView>
        </SafeAreaView>
    );
}

type Styles = ReturnType<typeof makeStyles>;

function TimeColumn({ value, onUp, onDown, s, t }: {
    value: string; onUp: () => void; onDown: () => void; s: Styles; t: Semantic;
}) {
    return (
        <View style={s.timeCol}>
            <Pressable onPress={onUp} hitSlop={12} style={s.timeArrow}>
                <UiIcon icon={Icons.ChevronUp} size={22} color={t.text.secondary} />
            </Pressable>
            <Text style={s.timeValue}>{value}</Text>
            <Pressable onPress={onDown} hitSlop={12} style={s.timeArrow}>
                <UiIcon icon={Icons.ChevronDown} size={22} color={t.text.secondary} />
            </Pressable>
        </View>
    );
}

function KindOption({ s, active, title, sub, onPress }: {
    s: Styles; active: boolean; title: string; sub: string; onPress: () => void;
}) {
    return (
        <Pressable onPress={onPress} style={[s.kind, active && s.kindOn]}>
            <View style={[s.radio, active && s.radioOn]}>{active ? <View style={s.radioDot} /> : null}</View>
            <View style={{ flex: 1 }}>
                <Text style={s.kindTitle}>{title}</Text>
                <Text style={s.kindSub}>{sub}</Text>
            </View>
        </Pressable>
    );
}

function makeStyles(t: Semantic) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: t.surface.canvas },
        header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
        headerTitle: { fontSize: 17, fontWeight: '600', color: t.text.primary },
        section: { fontSize: 12, color: t.text.tertiary, letterSpacing: 0.4, paddingHorizontal: 16, marginTop: 22, marginBottom: 6 },
        row: {
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
        },
        rowLabel: { fontSize: 15, color: t.text.primary },
        rowSub: { fontSize: 12, color: t.text.tertiary, marginTop: 3, lineHeight: 17 },
        warn: { margin: 16, padding: 12, borderRadius: 10, backgroundColor: t.status.warningBg },
        warnText: { fontSize: 13, color: t.text.warning, lineHeight: 18 },

        clock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
        timeCol: { alignItems: 'center' },
        timeArrow: { padding: 4 },
        timeValue: { fontSize: 44, fontWeight: '300', color: t.text.primary, fontVariant: ['tabular-nums'] },
        clockColon: { fontSize: 40, color: t.text.tertiary, marginBottom: 4 },

        days: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, justifyContent: 'space-between' },
        day: {
            flex: 1, aspectRatio: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
        },
        dayOn: { backgroundColor: t.accent.bg, borderColor: t.accent.bg },
        dayText: { fontSize: 12, color: t.text.secondary },
        dayTextOn: { color: t.text.onInverse, fontWeight: '600' },

        kind: {
            flexDirection: 'row', gap: 12, alignItems: 'flex-start',
            marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 12,
            borderWidth: 1, borderColor: t.border.default,
        },
        kindOn: { borderColor: t.accent.bg, backgroundColor: t.surface.raised },
        kindTitle: { fontSize: 15, color: t.text.primary, fontWeight: '600' },
        kindSub: { fontSize: 12, color: t.text.tertiary, marginTop: 3, lineHeight: 17 },
        radio: {
            width: 20, height: 20, borderRadius: 999, marginTop: 2,
            borderWidth: 2, borderColor: t.border.default, alignItems: 'center', justifyContent: 'center',
        },
        radioOn: { borderColor: t.accent.bg },
        radioDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: t.accent.bg },

        targets: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
        target: {
            flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default,
        },
        targetOn: { backgroundColor: t.surface.inverse, borderColor: t.surface.inverse },
        targetText: { fontSize: 16, color: t.text.secondary },
        targetTextOn: { color: t.text.onInverse, fontWeight: '700' },

        note: { fontSize: 12, color: t.text.tertiary, paddingHorizontal: 16, marginTop: 8, lineHeight: 18 },
    });
}
