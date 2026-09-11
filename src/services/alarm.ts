/**
 * Báo thức học bài — lớp hẹn lịch.
 *
 * V1 cố ý KHÔNG chiếm màn hình như đồng hồ báo thức. Làm được điều đó cần
 * full-screen intent, mà expo-notifications không hỗ trợ — phải thêm native
 * module, và Android 14+ còn giới hạn quyền đó cho app gọi điện/báo thức. Nên
 * ở đây là một thông báo mức HIGH (có heads-up + chuông), chạm vào thì mở
 * thẳng màn làm bài.
 *
 * Giới hạn phải nói thẳng, đừng để nó thành lỗi bí ẩn về sau:
 *  - Không chạm thông báo thì không có gì xảy ra. App không thể tự bật lên.
 *  - Android cắt tiếng thông báo ở ~5 giây. Không có chuông kêu tới khi tắt.
 *  - Máy Xiaomi/Oppo/Vivo/Samsung có thể nuốt luôn báo thức nếu app bị ghim
 *    vào chế độ tiết kiệm pin. Đây là rủi ro lớn nhất của tính năng và nó
 *    nằm ngoài tầm với của code — xem bảng alarm_events trong db/user.ts.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { AlarmConfig } from '../db/user';

/** Channel riêng, mức HIGH để Android cho hiện heads-up + phát chuông. */
export const ALARM_CHANNEL = 'alarm-homework';

/**
 * Đánh dấu trong payload để phân biệt với mọi thông báo khác sau này. Chỗ
 * nhận (root layout) chỉ mở màn làm bài khi thấy dấu này, không mở theo bất
 * kỳ thông báo nào chạm vào.
 */
export const ALARM_MARKER = 'minotara-alarm-homework';

export async function ensureAlarmChannel(): Promise<void> {
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(ALARM_CHANNEL, {
        name: 'Báo thức học bài',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 400, 200, 400],
        // Bật đèn + bỏ qua Không làm phiền thì cần quyền riêng người dùng phải
        // cấp tay; không đòi ở V1.
        enableVibrate: true,
    });
}

/**
 * Xin quyền thông báo. Trả về `true` nếu được phép gửi.
 *
 * Android 13+ mới cần hỏi; bản cũ hơn mặc định có. Gọi hàm này TRƯỚC khi đặt
 * lịch — đặt lịch khi chưa có quyền thì lịch vẫn tạo được mà đến giờ không
 * hiện gì, trông y hệt lỗi "báo thức không kêu".
 */
export async function requestAlarmPermission(): Promise<boolean> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
}

export async function hasAlarmPermission(): Promise<boolean> {
    return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * Đặt lại toàn bộ lịch cho đúng một cấu hình: huỷ hết rồi đặt mới.
 *
 * Mỗi thứ trong tuần là MỘT lịch WEEKLY riêng. Không gộp được thành một lịch
 * hằng ngày rồi tự lọc thứ lúc thông báo nổ, vì lúc đó JS của app không chạy.
 *
 * KHÔNG dùng trigger CALENDAR dù nó nhận đúng bộ tham số mình cần: nó là
 * trigger CHỈ CÓ TRÊN iOS (`@platform ios` trong Notifications.types.d.ts),
 * trên Android thì ném lỗi. Và ném ở đây rất khó thấy — cấu hình vẫn lưu,
 * công tắc vẫn hiện "Bật", chỉ là sáng hôm sau không có gì kêu. Dòng "đang
 * đặt N lịch" ở màn cấu hình có mặt chính vì kiểu hỏng im lặng này.
 *
 * Huỷ-hết-rồi-đặt-lại thay vì sửa từng cái: app chỉ có một báo thức, nên
 * không có lịch nào khác để giữ, và cách này không bao giờ để sót lịch mồ côi
 * từ lần cấu hình trước — thứ sẽ biểu hiện thành "kêu vào ngày đã bỏ chọn".
 */
export async function rescheduleAlarm(cfg: AlarmConfig): Promise<string[]> {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!cfg.enabled || !cfg.days.length) return [];
    await ensureAlarmChannel();

    const content = {
        title: 'Đến giờ học rồi',
        body: `Làm đúng ${cfg.target} câu để tắt báo thức.`,
        data: { marker: ALARM_MARKER },
        ...(Platform.OS === 'android' ? { channelId: ALARM_CHANNEL } : {}),
        // Không vuốt tắt được — tắt thông báo là con đường ít trở ngại nhất
        // để lờ đi, và cả tính năng này dựng lên để chặn đúng con đường đó.
        sticky: true,
        autoDismiss: false,
    };

    // Chọn đủ 7 ngày thì một lịch DAILY thay cho 7 lịch WEEKLY: ít thứ để hệ
    // điều hành đánh rơi hơn, và dòng "đang đặt N lịch" cũng khỏi gây hiểu lầm.
    if (cfg.days.length === 7) {
        const id = await Notifications.scheduleNotificationAsync({
            content,
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DAILY,
                hour: cfg.hour,
                minute: cfg.minute,
                channelId: ALARM_CHANNEL,
            },
        });
        return [id];
    }

    const ids: string[] = [];
    for (const weekday of cfg.days) {
        const id = await Notifications.scheduleNotificationAsync({
            content,
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
                weekday, // 1 = Chủ nhật, đúng quy ước AlarmConfig.days
                hour: cfg.hour,
                minute: cfg.minute,
                channelId: ALARM_CHANNEL,
            },
        });
        ids.push(id);
    }
    return ids;
}

export async function cancelAlarm(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
}

/** Gỡ thông báo báo thức đang hiện — gọi khi làm xong bài. */
export async function clearAlarmNotifications(): Promise<void> {
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
}

/** Thông báo đang chạm vào có phải báo thức của app này không. */
export function isAlarmNotification(data: unknown): boolean {
    return !!data && typeof data === 'object'
        && (data as { marker?: unknown }).marker === ALARM_MARKER;
}

/** Cho màn cấu hình hiển thị "đã đặt mấy lịch" — cũng là cách kiểm tra lịch
 *  có thật sự nằm trong hệ thống hay không khi người dùng báo không kêu. */
export async function scheduledCount(): Promise<number> {
    return (await Notifications.getAllScheduledNotificationsAsync()).length;
}
