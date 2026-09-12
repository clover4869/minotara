import { NativeModule, requireNativeModule } from 'expo';

declare class AlarmRingingModule extends NativeModule<{}> {
    /** Đặt lại toàn bộ lịch báo thức thật (AlarmManager, không qua expo-notifications).
     *  Huỷ hết lịch cũ trước khi đặt — gọi lại an toàn khi đổi giờ/ngày. */
    scheduleAlarm(hour: number, minute: number, weekdays: number[]): void;
    cancelAllAlarms(): void;
    /** Không phải truy vấn độc lập vào AlarmManager (API không cho phép) —
     *  chỉ là số ngày đã đặt thành công ở lần scheduleAlarm() gần nhất. */
    getScheduledCount(): number;
    /** Tạm im chuông — gọi khi màn làm bài đang mở & app ở foreground, để
     *  không đè lên audio phát âm của câu hỏi. */
    pauseAlarmRinging(): void;
    /** Kêu lại — gọi khi rời màn làm bài / khoá màn / qua app khác mà CHƯA làm xong. */
    resumeAlarmRinging(): void;
    /** Tắt hẳn — chốt cứng phía native, resumeAlarmRinging() sau đó là no-op
     *  cho tới lần báo thức kế tiếp. Gọi khi làm ĐÚNG đủ số câu. */
    stopAlarmRinging(): void;
    /** Bật/tắt hiện đè lên màn khoá cho đúng lúc đang ở màn làm bài — vì app
     *  chỉ có một Activity (Expo Router), không set cố định trong manifest được. */
    setShowOverLockscreen(enabled: boolean): void;

    isIgnoringBatteryOptimizations(): boolean;
    /** Mở hộp thoại xin miễn tối ưu pin cho app — trực tiếp, không qua danh sách. */
    openBatteryOptimizationSettings(): void;
    /** Chỉ có tác dụng Android 14+; bản cũ hơn full-screen intent tự được phép. */
    openFullScreenIntentSettings(): void;
}

export default requireNativeModule<AlarmRingingModule>('AlarmRinging');
