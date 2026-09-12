/**
 * Báo thức học bài — lớp hẹn lịch.
 *
 * Kêu thật, xuyên chuông im lặng: lịch đặt bằng AlarmManager.setAlarmClock()
 * qua module native `alarm-ringing` (modules/alarm-ringing), KHÔNG qua
 * expo-notifications nữa — vì phát âm thanh trên luồng ALARM (luồng duy nhất
 * Android không tắt theo công tắc im lặng của máy) và full-screen intent đều
 * là thứ expo-notifications không expose ra JS được. Chi tiết cơ chế
 * pause/resume/stop nằm ở AlarmRingingService.kt phía native.
 *
 * File này CHỈ giữ vai trò hẹn lịch + xin quyền thông báo — vẫn dùng
 * `expo-notifications` cho đúng một việc: `requestPermissionsAsync()`, một
 * API xin quyền hệ thống thuần tuý, không liên quan gì tới việc thư viện đó
 * có tự lên lịch/tự phát thông báo hay không.
 *
 * Giới hạn còn lại, phải nói thẳng để không thành lỗi bí ẩn:
 *  - Máy Xiaomi/Oppo/Vivo/Samsung có thể nuốt báo thức nếu app bị ghim vào
 *    chế độ tiết kiệm pin — xin miễn trừ ở màn cấu hình, nhưng không ép được.
 *  - Android 14+ đòi quyền riêng cho full-screen intent, người dùng phải tự
 *    cấp trong Cài đặt hệ thống — xem alarm-settings.tsx.
 */
import * as Notifications from 'expo-notifications';

import AlarmRinging from '../../modules/alarm-ringing';
import type { AlarmConfig } from '../db/user';

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
 * Huỷ-hết-rồi-đặt-lại thay vì sửa từng cái: app chỉ có một báo thức, nên
 * không có lịch nào khác để giữ, và cách này không bao giờ để sót lịch mồ côi
 * từ lần cấu hình trước — thứ sẽ biểu hiện thành "kêu vào ngày đã bỏ chọn".
 */
export async function rescheduleAlarm(cfg: AlarmConfig): Promise<void> {
    if (!cfg.enabled || !cfg.days.length) {
        AlarmRinging.cancelAllAlarms();
        return;
    }
    AlarmRinging.scheduleAlarm(cfg.hour, cfg.minute, cfg.days);
}

export async function cancelAlarm(): Promise<void> {
    AlarmRinging.cancelAllAlarms();
}

/** Gỡ chuông + thông báo đang kêu — gọi khi làm xong bài (đủ số câu đúng). */
export async function clearAlarmNotifications(): Promise<void> {
    AlarmRinging.stopAlarmRinging();
}

/** Cho màn cấu hình hiển thị "đã đặt mấy lịch". Không phải truy vấn độc lập
 *  vào hệ thống (AlarmManager không cho hỏi lại) — xem ghi chú ở
 *  AlarmRingingModule.getScheduledCount phía native. */
export async function scheduledCount(): Promise<number> {
    return AlarmRinging.getScheduledCount();
}
