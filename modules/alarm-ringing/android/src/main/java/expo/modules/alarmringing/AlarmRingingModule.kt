package expo.modules.alarmringing

import android.app.Activity
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import expo.modules.kotlin.Promise
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
    // Giữ Promise của lần pickAlarmSound() đang chờ — activity picker của
    // RingtoneManager trả kết quả qua onActivityResult (bất đồng bộ, callback
    // riêng), không resolve được ngay trong thân AsyncFunction như các hàm
    // khác trong file này.
    private var pickSoundPromise: Promise? = null

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

        // Không lưu Uri trần trong JS — chỉ trả tên hiển thị, native tự quyết
        // định URI thật (kể cả khi rỗng thì fallback đúng chuông mặc định của
        // máy, có thể đổi giữa các bản Android khác nhau).
        Function("getSelectedAlarmSoundTitle") {
            appContext.reactContext?.let { resolveSoundTitle(it) } ?: "Mặc định hệ thống"
        }

        // Dùng picker CÓ SẴN của hệ thống (RingtoneManager) thay vì tự liệt kê
        // danh sách âm thanh — vừa đỡ code, vừa tự động gồm cả nhạc chuông máy
        // đã tải thêm. Tắt tuỳ chọn "Im lặng" vì mục đích của báo thức này là
        // để KÊU, chọn im lặng ở đây chỉ tự làm hỏng tính năng của chính mình.
        AsyncFunction("pickAlarmSound") { promise: Promise ->
            val activity = appContext.currentActivity
            val context = appContext.reactContext
            if (activity == null || context == null) {
                promise.reject("ERR_NO_ACTIVITY", "Không tìm thấy màn hình đang mở để chọn âm thanh", null)
                return@AsyncFunction
            }
            pickSoundPromise = promise
            val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
                putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
                putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
                putExtra(
                    RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI,
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                )
                putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, resolveSoundUri(context))
                putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Chọn âm báo thức")
            }
            runCatching { activity.startActivityForResult(intent, REQUEST_CODE_PICK_SOUND) }
                .onFailure {
                    pickSoundPromise = null
                    promise.reject("ERR_PICKER", "Không mở được màn chọn âm thanh", it)
                }
                .onSuccess {
                    // OnActivityResult là cách DUY NHẤT giải quyết promise này.
                    // Activity hệ thống của picker bị huỷ mà không giao được kết
                    // quả về (OS thu hồi bộ nhớ giữa lúc đang chọn, hiếm nhưng
                    // có thật) thì không còn ai gọi lại — promise treo vĩnh viễn,
                    // await phía JS đứng hình không báo lỗi. Tự rớt hạn sau một
                    // khoảng hợp lý thay vì tin tưởng tuyệt đối vào callback.
                    Handler(Looper.getMainLooper()).postDelayed({
                        if (pickSoundPromise === promise) {
                            pickSoundPromise = null
                            promise.reject("ERR_PICKER_TIMEOUT", "Không nhận được kết quả từ màn chọn âm thanh", null)
                        }
                    }, PICK_SOUND_TIMEOUT_MS)
                }
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != REQUEST_CODE_PICK_SOUND) return@OnActivityResult
            val promise = pickSoundPromise ?: return@OnActivityResult
            pickSoundPromise = null
            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(null)
                return@OnActivityResult
            }
            // resultCode khác RESULT_OK khi người dùng bấm back thoát màn chọn
            // — giữ nguyên lựa chọn cũ, không ghi đè bằng giá trị rỗng.
            if (payload.resultCode == Activity.RESULT_OK) {
                val uri = payload.data?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
                // Quyền đọc URI picker trả về chỉ tạm thời — hết hạn khi Activity
                // nhận kết quả này kết thúc. Chuông thật phát ra ở một Service
                // khác, có thể ở một tiến trình khác, LÂU sau khi màn hình này
                // đã đóng — không "giữ" (persist) quyền thì mọi âm KHÔNG PHẢI
                // chuông hệ thống có sẵn (nhạc chuông máy tự thêm, file mp3
                // riêng...) sẽ phát lỗi SecurityException âm thầm lúc báo thức
                // thật kêu, y hệt như không chọn gì. Bỏ qua lỗi nếu URI này vốn
                // không có quyền để giữ (ví dụ nhạc chuông hệ thống, world-
                // readable sẵn, không cần bước này).
                if (uri != null) {
                    runCatching {
                        context.contentResolver.takePersistableUriPermission(
                            uri, Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        )
                    }
                }
                saveSoundUri(context, uri)
            }
            promise.resolve(resolveSoundTitle(context))
        }

        Function("isIgnoringBatteryOptimizations") {
            val context = appContext.reactContext ?: return@Function false
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(context.packageName)
        }

        // Trước bản 14 không có khái niệm "xin phép" — full-screen intent tự
        // được phép, nên coi như true luôn để JS không phải tự nhớ so sánh SDK.
        Function("canUseFullScreenIntent") {
            val context = appContext.reactContext ?: return@Function true
            if (Build.VERSION.SDK_INT >= 34) {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.canUseFullScreenIntent()
            } else {
                true
            }
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
private const val PREF_SOUND_URI = "sound_uri"
private const val REQUEST_CODE_BASE = 9000
private const val REQUEST_CODE_PICK_SOUND = 9100
private const val PICK_SOUND_TIMEOUT_MS = 60_000L

private fun writePrefs(context: Context, hour: Int, minute: Int, weekdays: List<Int>) {
    context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putInt(PREF_HOUR, hour)
        .putInt(PREF_MINUTE, minute)
        .putString(PREF_DAYS, weekdays.joinToString(","))
        .putInt(PREF_COUNT, weekdays.size)
        .apply()
}

/** Chỉ xoá đúng mấy key LỊCH (giờ/phút/ngày/số lịch) — KHÔNG .clear() cả file,
 *  vì PREF_SOUND_URI nằm chung SharedPreferences này. Tắt công tắc báo thức
 *  (gọi hàm này) không có lý do gì phải quên luôn âm thanh người dùng đã chọn
 *  riêng; trước đây .clear() làm đúng việc đó — bật lại là về "Mặc định hệ
 *  thống", mất lựa chọn dù người dùng không hề đụng tới mục Âm thanh. */
private fun clearPrefs(context: Context) {
    context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE).edit()
        .remove(PREF_HOUR)
        .remove(PREF_MINUTE)
        .remove(PREF_DAYS)
        .remove(PREF_COUNT)
        .apply()
}

/** null = chưa chọn gì, dùng chuông mặc định của máy. Dùng chung cho module
 *  này (đọc để pre-select trong picker) và AlarmRingingService (đọc để phát). */
internal fun loadSoundUri(context: Context): Uri? {
    val raw = context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_SOUND_URI, null)
    return raw?.let { runCatching { Uri.parse(it) }.getOrNull() }
}

private fun saveSoundUri(context: Context, uri: Uri?) {
    context.getSharedPreferences(ALARM_PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putString(PREF_SOUND_URI, uri?.toString())
        .apply()
}

/** URI thật sự đang dùng để phát: tuỳ chọn của người dùng, hoặc chuông mặc
 *  định của máy nếu chưa chọn gì. Dùng chung cho việc hiện tên (resolveSoundTitle)
 *  VÀ việc pre-select đúng ô trong picker hệ thống (kẻo picker luôn hiện "None"
 *  trong khi màn cấu hình lại hiện đúng tên chuông đang phát). */
private fun resolveSoundUri(context: Context): Uri? =
    loadSoundUri(context) ?: RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM)

private fun resolveSoundTitle(context: Context): String {
    val uri = resolveSoundUri(context)
    return uri?.let { runCatching { RingtoneManager.getRingtone(context, it)?.getTitle(context) }.getOrNull() }
        ?: "Mặc định hệ thống"
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
