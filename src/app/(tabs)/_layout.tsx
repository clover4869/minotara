import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';
import { palette } from '@/theme/tokens';

export default function TabsLayout() {
    const scheme = useColorScheme();
    const t = palette(scheme === 'dark' ? 'dark' : 'light');

    return (
        <NativeTabs
            backgroundColor={t.surface.canvas}
            indicatorColor={t.surface.raised}
            labelStyle={{
                color: t.text.tertiary,
                selected: { color: t.accent.bg },
            }}>
            <NativeTabs.Trigger name="index">
                <NativeTabs.Trigger.Label>Tra cứu</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="my-words">
                <NativeTabs.Trigger.Label>Từ của tôi</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="bookmark" md="bookmark" />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="review">
                <NativeTabs.Trigger.Label>Ôn tập</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="rectangle.stack" md="style" />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="settings">
                <NativeTabs.Trigger.Label>Cài đặt</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
            </NativeTabs.Trigger>
        </NativeTabs>
    );
}
