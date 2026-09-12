package expo.modules.alarmringing

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cầu nối JS ⇄ native cho báo thức thật (kêu xuyên chuông im lặng).
 *
 * Lịch đặt bằng AlarmManager.setAlarmClock() trực tiếp, KHÔNG qua
 * expo-notifications — vì cần toàn quyền dựng notification có
 * setFullScreenIntent + service phát âm thanh trên luồng ALARM, hai thứ
 * expo-notifications không expose ra JS được.
 */
class AlarmRingingModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("AlarmRinging")

        Function("scheduleAlarm") { hour: Int, minute: Int, weekdays: List<Int> ->
            val context = appContext.reactContext ?: return@Function
            cancelAll(context)
            weekdays.forEach { wd -> scheduleOne(context, hour, minute, wd) }
            // Ghi SAU khi vòng lặp trên chạy xong không ném lỗi — throw giữa
            // chừng (vd. SecurityException thiếu quyền exact alarm) thì giữ
            // nguyên state cũ trong prefs, không báo nhầm "đã đặt N" trong khi
            // thật ra hỏng. Bản thân throw đã tự bắn lên JS qua Promise reject.
            writePrefs(context, hour, minute, weekdays)
        }

        Function("cancelAllAlarms") {
            // KHÔNG dùng `?: return@Function` trần (không giá trị) ở overload
            // 0 tham số — Kotlin suy luận kiểu trả về của lambda này thành
            // `Any?` (để tương thích JS), và return@Function trần bị hiểu là
            // trả `Unit`, lệch kiểu. Dùng ?.let{} để né hẳn early-return.
            appContext.reactContext?.let { context ->
                cancelAll(context)
                clearPrefs(context)
            }
        }

        // AlarmManager không cho app tự hỏi lại "tôi đã đặt bao nhiêu lịch" —
        // khác hẳn expo-notifications.getAllScheduledNotificationsAsync() cũ.
        // Đây là số WEEKDAYS đã đặt ở lần scheduleAlarm() thành công gần nhất,
        // không phải truy vấn độc lập vào hệ thống — đủ để màn cấu hình biết
        // "lần gọi cuối có chạy hết vòng lặp hay ném lỗi giữa chừng" thôi.
        Function("getScheduledCount") {
            val context = appContext.reactContext ?: return@Function 0
            context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE).getInt(PREF_COUNT, 0)
        }

        Function("pauseAlarmRinging") {
            appContext.reactContext?.let { AlarmRingingService.pause(it) }
        }

        Function("resumeAlarmRinging") {
            appContext.reactContext?.let { AlarmRingingService.resume(it) }
        }

        Function("stopAlarmRinging") {
            appContext.reactContext?.let { AlarmRingingService.stop(it) }
        }

        Function("setShowOverLockscreen") { enabled: Boolean ->
            val activity = appContext.currentActivity ?: return@Function
            activity.runOnUiThread {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    activity.setShowWhenLocked(enabled)
                    activity.setTurnScreenOn(enabled)
                }
                if (enabled) {
                    val km = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                    km?.requestDismissKeyguard(activity, null)
                }
            }
        }

        Function("isIgnoringBatteryOptimizations") {
            val context = appContext.reactContext ?: return@Function false
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(context.packageName)
        }

        // Cần Uri "package:<tên gói>" làm DATA của intent — expo-linking.sendIntent
        // chỉ truyền được action + extras (bundle), không set được data URI, nên
        // phải tự dựng Intent ở đây thay vì gọi từ JS.
        Function("openBatteryOptimizationSettings") {
            appContext.reactContext?.let { context ->
                val intent = Intent(
                    "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
                    Uri.parse("package:${context.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(intent) }
            }
        }

        // Chỉ Android 14+ (API 34) có màn này — bản cũ hơn full-screen intent
        // tự động được phép, không cần xin.
        Function("openFullScreenIntentSettings") {
            if (Build.VERSION.SDK_INT >= 34) {
                appContext.reactContext?.let { context ->
                    val intent = Intent(
                        "android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT",
                        Uri.parse("package:${context.packageName}"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    runCatching { context.startActivity(intent) }
                }
            }
        }
    }
}

internal const val ALARM_PREFS_NAME = "alarm_ringing_prefs"
internal const val PREF_HOUR = "hour"
internal const val PREF_MINUTE = "minute"
internal const val PREF_DAYS = "days"
private const val PREF_COUNT = "scheduled_count"
private const val REQUEST_CODE_BASE = 9000

private fun writePrefs(context: Context, hour: Int, minute: Int, weekdays: List<Int>) {
    context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putInt(PREF_HOUR, hour)
        .putInt(PREF_MINUTE, minute)
        .putString(PREF_DAYS, weekdays.joinToString(","))
        .putInt(PREF_COUNT, weekdays.size)
        .apply()
}

private fun clearPrefs(context: Context) {
    context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
}

private fun pendingIntentFor(context: Context, weekday: Int): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java).putExtra("weekday", weekday)
    return PendingIntent.getBroadcast(
        context, REQUEST_CODE_BASE + weekday, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

private fun cancelAll(context: Context) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (weekday in 1..7) am.cancel(pendingIntentFor(context, weekday))
}

/**
 * Đặt MỘT lịch cho đúng weekday đó, ở lần xảy ra kế tiếp (kể cả hôm nay nếu
 * giờ chưa qua). Dùng chung cho cả module này, AlarmReceiver (tái lập +7 ngày
 * lúc nổ) và BootReceiver (đặt lại sau khi khởi động máy).
 */
internal fun scheduleOne(context: Context, hour: Int, minute: Int, weekday: Int) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val cal = java.util.Calendar.getInstance().apply {
        set(java.util.Calendar.HOUR_OF_DAY, hour)
        set(java.util.Calendar.MINUTE, minute)
        set(java.util.Calendar.SECOND, 0)
        set(java.util.Calendar.MILLISECOND, 0)
    }
    while (cal.get(java.util.Calendar.DAY_OF_WEEK) != weekday || cal.timeInMillis <= System.currentTimeMillis()) {
        cal.add(java.util.Calendar.DAY_OF_MONTH, 1)
    }
    val pi = pendingIntentFor(context, weekday)
    am.setAlarmClock(AlarmManager.AlarmClockInfo(cal.timeInMillis, pi), pi)
}
