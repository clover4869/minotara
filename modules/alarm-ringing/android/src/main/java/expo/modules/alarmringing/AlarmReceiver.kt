package expo.modules.alarmringing

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Chạy được kể cả app đã bị kill hẳn — Android tự khởi động lại tiến trình
 * để giao broadcast này (đúng cơ chế AlarmManager.setAlarmClock() vẫn dùng).
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val weekday = intent.getIntExtra("weekday", -1)
        // setAlarmClock() không tự lặp lại như setRepeating — phải tự tái lập
        // cho +7 ngày ngay tại đây, mỗi lần nổ.
        if (weekday in 1..7) {
            val prefs = context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE)
            val hour = prefs.getInt(PREF_HOUR, -1)
            val minute = prefs.getInt(PREF_MINUTE, -1)
            if (hour >= 0 && minute >= 0) scheduleOne(context, hour, minute, weekday)
        }
        AlarmRingingService.start(context)
    }
}
