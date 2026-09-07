import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { Image, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { dictionaryReady, removeDictionaryFile, setOnDictionaryCorrupted } from '@/db/open';
import { useApp } from '@/stores/app';
import { useEffectiveColorScheme } from '@/theme/use-palette';

SplashScreen.preventAutoHideAsync();

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
        })();

        return () => {
            sub.remove();
            setOnDictionaryCorrupted(null);
        };
    }, []);

    // The cold-start deep link needs a mounted <Stack> to navigate into — fire
    // it only once the navigator actually exists, not while BootScreen is up.
    useEffect(() => {
        if (!booted) return;
        Linking.getInitialURL().then((u) => { if (u) handleDeepLink(u); });
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
                            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
                        </Stack>
                    </ThemeProvider>
                )}
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
