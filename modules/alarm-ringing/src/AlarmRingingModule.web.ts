import { registerWebModule, NativeModule } from 'expo';

/** Không áp dụng trên web — báo thức thật là tính năng riêng của Android. */
class AlarmRingingModule extends NativeModule<{}> {
    scheduleAlarm(_hour: number, _minute: number, _weekdays: number[]): void {}
    cancelAllAlarms(): void {}
    getScheduledCount(): number { return 0; }
    pauseAlarmRinging(): void {}
    resumeAlarmRinging(): void {}
    stopAlarmRinging(): void {}
    setShowOverLockscreen(_enabled: boolean): void {}
    isIgnoringBatteryOptimizations(): boolean { return true; }
    openBatteryOptimizationSettings(): void {}
    canUseFullScreenIntent(): boolean { return true; }
    openFullScreenIntentSettings(): void {}

    getSelectedAlarmSoundTitle(): string { return 'Mặc định hệ thống'; }
    async pickAlarmSound(): Promise<string> { return 'Mặc định hệ thống'; }
}

export default registerWebModule(AlarmRingingModule, 'AlarmRingingModule');
