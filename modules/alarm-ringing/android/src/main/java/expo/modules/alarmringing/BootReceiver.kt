package expo.modules.alarmringing

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Đặt lại lịch sau khi khởi động máy HOẶC sau khi app được cập nhật — Android
 * tự huỷ toàn bộ lịch AlarmManager ở cả hai trường hợp, không riêng gì reboot.
 * Thiếu MY_PACKAGE_REPLACED thì mỗi lần cài bản mới, công tắc vẫn hiện "Bật"
 * nhưng lịch thật đã mất, trông như tính năng chết hẳn dù không đổi gì trong
 * cấu hình.
 *
 * Đọc thẳng SharedPreferences thay vì SQLite của app (user.db) — lúc broadcast
 * này nổ, JS/React Native chưa chắc đã chạy, nên cấu hình được đồng bộ một bản
 * rút gọn (giờ/phút/ngày) vào đây mỗi khi AlarmRingingModule.scheduleAlarm()
 * chạy.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return
        val prefs = context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE)
        val hour = prefs.getInt(PREF_HOUR, -1)
        val minute = prefs.getInt(PREF_MINUTE, -1)
        val days = prefs.getString(PREF_DAYS, null) ?: return
        if (hour < 0 || minute < 0) return
        days.split(",").mapNotNull { it.toIntOrNull() }.forEach { weekday ->
            // setAlarmClock() có thể ném SecurityException nếu người dùng đã
            // thu hồi quyền "Báo thức & lời nhắc" (Android 12+ cho tắt bất kỳ
            // lúc nào qua Cài đặt, không cần gỡ app). Ném ra khỏi onReceive()
            // của BroadcastReceiver là crash cả tiến trình — đúng lúc người
            // dùng vừa khởi động lại máy, hộp thoại "App liên tục dừng" hiện ra
            // ngay không báo trước, một ngày còn tệ hơn cả báo thức không kêu.
            runCatching { scheduleOne(context, hour, minute, weekday) }
        }
    }
}
