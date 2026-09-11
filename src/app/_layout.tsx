import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { Image, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { dictionaryReady, openUser, removeDictionaryFile, setOnDictionaryCorrupted } from '@/db/open';
import { getAlarm } from '@/db/user';
import { isAlarmNotification, rescheduleAlarm } from '@/services/alarm';
import { useApp } from '@/stores/app';
import { useEffectiveColorScheme } from '@/theme/use-palette';

SplashScreen.preventAutoHideAsync();

/**
 * Mặc định expo-notifications NUỐT thông báo khi app đang mở. Với báo thức
 * thì đó là hỏng: đang cầm máy lúc 7 giờ là đúng lúc cần thấy nó nhất.
 */
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

/** Chỉ mở màn làm bài cho ĐÚNG thông báo báo thức, không phải mọi thông báo. */
function openAlarmIfOurs(response: Notifications.NotificationResponse | null): void {
    if (!response) return;
    if (!isAlarmNotification(response.notification.request.content.data)) return;
    // navigate (không phải push): chạm hai lần vào thông báo không được xếp
    // chồng hai màn làm bài lên nhau.
    router.navigate('/alarm-session');
}

/** Must match `expo.plugins["expo-splash-screen"].backgroundColor` in app.json — same color on both sides of the native→JS splash handoff. */
const SPLASH_BG = '#6CC6BD';

/** spec: dict://word/{headword} → SCR-02 */
function handleDeepLink(url: string) {
    const parsed = Linking.parse(url);
    const host = parsed.hostname ?? '';
    const path = (parsed.path ?? '').replace(/^\//, '');
    let q: string | null = null;
    if (host === 'word') q = path.split('/')[0] || null;
    else if (path.startsWith('word/')) q = path.slice(5).split('/')[0] || null;
    if (q) router.push(`/word/${encodeURIComponent(q)}`);
}

/**
 * Shown the instant the native splash hides, until the dictionary/settings
 * checks resolve — same background + icon as the native splash config in
 * app.json so there's no visible handoff between the two.
 */
function BootScreen() {
    return (
        <View style={bootStyles.root}>
            {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
            <Image source={require('@/assets/icons/splash-icon.png')} style={bootStyles.icon} resizeMode="contain" />
            <SafeAreaView style={bootStyles.footer} edges={['bottom']}>
                <Text style={bootStyles.credit}>Implement by Clover</Text>
            </SafeAreaView>
        </View>
    );
}

const bootStyles = StyleSheet.create({
    root: { flex: 1, backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center' },
    icon: { width: 76, height: 76 },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingBottom: 16 },
    credit: { color: 'rgba(255,255,255,0.72)', fontSize: 12, letterSpacing: 0.2 },
});

export default function RootLayout() {
    const colorScheme = useEffectiveColorScheme();
    const [booted, setBooted] = useState(false);
    const loadSettings = useApp((s) => s.loadSettings);
    const setDictReady = useApp((s) => s.setDictReady);

    useEffect(() => {
        const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

        setOnDictionaryCorrupted(() => {
            removeDictionaryFile().finally(() => {
                setDictReady(false);
                router.replace('/onboarding');
            });
        });

        const notifSub = Notifications.addNotificationResponseReceivedListener(openAlarmIfOurs);

        (async () => {
            try {
                const ok = await dictionaryReady();
                setDictReady(ok);
                await loadSettings();
            } catch (e) {
                if (__DEV__) console.warn('[boot] startup check failed', e);
            } finally {
                await SplashScreen.hideAsync();
                setBooted(true);
            }
            // Đặt lại lịch mỗi lần mở app, sau khi splash đã tắt nên không làm
            // chậm khởi động. Lịch nằm ở tầng hệ điều hành và sống qua cả khởi
            // động lại máy, nhưng đổi múi giờ / nâng cấp OS / trình dọn pin của
            // hãng đều có thể xoá mất — đặt lại là cách rẻ nhất để bù.
            try {
                const cfg = await getAlarm(await openUser());
                if (cfg.enabled) await rescheduleAlarm(cfg);
            } catch (e) {
                if (__DEV__) console.warn('[boot] reschedule alarm failed', e);
            }
        })();

        return () => {
            sub.remove();
            notifSub.remove();
            setOnDictionaryCorrupted(null);
        };
    }, []);

    // The cold-start deep link needs a mounted <Stack> to navigate into — fire
    // it only once the navigator actually exists, not while BootScreen is up.
    useEffect(() => {
        if (!booted) return;
        Linking.getInitialURL().then((u) => { if (u) handleDeepLink(u); });
        // App bị tắt hẳn rồi người dùng chạm thông báo: lượt chạm đó không đi
        // qua listener ở trên vì lúc nó nổ chưa có JS nào chạy. Hỏi lại lượt
        // chạm đã mở app — cũng phải đợi <Stack> mounted mới điều hướng được.
        Notifications.getLastNotificationResponseAsync()
            .then(openAlarmIfOurs)
            .catch(() => {});
    }, [booted]);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                {!booted ? <BootScreen /> : (
                    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                        <Stack screenOptions={{ headerShown: false }}>
                            <Stack.Screen name="(tabs)" />
                            <Stack.Screen name="word/[q]" />
                            <Stack.Screen name="import" options={{ presentation: 'modal' }} />
                            <Stack.Screen name="history" />
                            <Stack.Screen name="review-session" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
                            <Stack.Screen name="alarm-settings" />
                            {/* gestureEnabled: false — vuốt để quay lại cũng là
                                một lối thoát, mà màn này cố ý không có lối nào. */}
                            <Stack.Screen name="alarm-session" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
                            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
                        </Stack>
                    </ThemeProvider>
                )}
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
