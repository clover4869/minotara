import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';
import { GlassTabBar } from '@/components/glass-tab-bar';

export default function TabsLayout() {
    return (
        <Tabs>
            <TabSlot />
            {/* Routes are declared here so file-based routing still resolves them;
                the visible bar itself is GlassTabBar, driven by its own TabTriggers below. */}
            <TabList style={{ display: 'none' }}>
                <TabTrigger name="index" href="/" />
                <TabTrigger name="my-words" href="/my-words" />
                <TabTrigger name="review" href="/review" />
                <TabTrigger name="settings" href="/settings" />
            </TabList>
            <GlassTabBar />
        </Tabs>
    );
}
