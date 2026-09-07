import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

SplashScreen.preventAutoHideAsync();

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

export default function RootLayout() {
    const colorScheme = useColorScheme();
    useEffect(() => {
        SplashScreen.hideAsync();
        Linking.getInitialURL().then((u) => { if (u) handleDeepLink(u); });
        const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
        return () => sub.remove();
    }, []);
    return (
        <SafeAreaProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="word/[q]" />
                    <Stack.Screen name="import" options={{ presentation: 'modal' }} />
                    <Stack.Screen name="history" />
                    <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
                </Stack>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}
