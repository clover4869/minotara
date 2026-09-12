package expo.modules.alarmringing

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

private const val CHANNEL_ID = "alarm-ringing"
private const val NOTIF_ID = 20260101
private const val ACTION_PAUSE = "expo.modules.alarmringing.PAUSE"
private const val ACTION_RESUME = "expo.modules.alarmringing.RESUME"
private const val ACTION_STOP = "expo.modules.alarmringing.STOP"
private const val WAKE_TAG = "alarm-ringing:wake"
/** Trần an toàn — lỡ người dùng không bao giờ mở app thì cũng không giữ wake
 *  lock/loa max volume vô thời hạn, chỉ tự tắt tiếng (KHÔNG tắt notification —
 *  đến giờ không có mặt để làm bài thì vẫn phải thấy đã có báo thức nổ). */
private const val MAX_WAKE_LOCK_MS = 15 * 60 * 1000L

private enum class RingState { RINGING, PAUSED, STOPPED }

private const val RING_STATE_PREFS = "alarm_ring_state_prefs"
private const val PREF_RING_STATE = "ring_state"

/**
 * Foreground service sống độc lập với JS/Activity — bị kill JS/React Native
 * không ảnh hưởng tới chuông đang kêu, vì đây là tiến trình Android thật, ưu
 * tiên cao, hệ điều hành rất ngại giết.
 *
 * Âm thanh phát qua AudioAttributes.USAGE_ALARM — luồng DUY NHẤT của Android
 * không bị tắt theo công tắc im lặng của máy (khác các thông báo bình thường
 * dùng USAGE_NOTIFICATION, xem services/alarm.ts phía JS).
 */
class AlarmRingingService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var originalAlarmVolume: Int? = null
    private var state: RingState = RingState.STOPPED

    override fun onCreate() {
        super.onCreate()
        // state chỉ sống trong bộ nhớ instance, mà stopRinging() tự stopSelf()
        // huỷ luôn instance đó — nghĩa là bất kỳ lệnh nào tới sau (kể cả một
        // startForegroundService() vô hại) đều tạo Service MỚI với field này
        // reset về default. Nếu default cứng là STOPPED, một alarm đang RINGING
        // bị OS (Xiaomi/Oppo/Vivo...) giết chết rồi phục hồi sẽ hiểu nhầm thành
        // "đã làm xong" và câm lặng vĩnh viễn — hỏng đúng lời hứa "kêu tới khi
        // làm đúng". Nên phải đọc lại state đã lưu, không dùng default vô điều
        // kiện.
        state = loadPersistedState()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // PHẢI gọi startForeground() ngay, bất kể action gì — service này
        // luôn được khởi động qua startForegroundService(), và Android bắt
        // gọi startForeground() trong vòng vài giây kể từ đó hay bị crash
        // (ForegroundServiceDidNotStartInTimeException), kể cả khi ý định
        // thật sự chỉ là pause/resume/stop.
        ensureChannel()
        startForeground(NOTIF_ID, buildNotification())

        when (intent?.action) {
            ACTION_PAUSE -> pauseRinging()
            ACTION_RESUME -> resumeRinging()
            ACTION_STOP -> stopRinging()
            else -> startRinging()
        }
        // pause/resume gọi vào lúc state đã STOPPED (làm đúng bài xong rồi mới
        // rời màn hình) thì tự no-op ở trong, nhưng startForeground() phía trên
        // đã lỡ chạy — phải tự dọn ngay, không thì notification "đang báo thức"
        // hiện lại vô thời hạn dù không hề kêu, trông như báo thức chưa tắt.
        if (state == RingState.STOPPED) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startRinging() {
        if (state == RingState.RINGING) return
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (originalAlarmVolume == null) {
            originalAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
        }
        am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)

        acquireWakeLock()
        playSound()
        playVibration()
        persistState(RingState.RINGING)
    }

    private fun pauseRinging() {
        if (state != RingState.RINGING) return
        mediaPlayer?.pause()
        vibrator?.cancel()
        persistState(RingState.PAUSED)
    }

    private fun resumeRinging() {
        // Chốt cứng: đã STOPPED (làm xong bài) thì resume không có tác dụng
        // cho tới lần báo thức kế tiếp. state được load lại từ SharedPreferences
        // ở onCreate() nên chốt này đứng vững kể cả khi instance cũ đã bị huỷ
        // (sau stopSelf()) hoặc bị OS kill giữa chừng rồi tạo instance mới.
        if (state == RingState.STOPPED) return
        if (mediaPlayer == null) playSound() else mediaPlayer?.start()
        playVibration()
        persistState(RingState.RINGING)
    }

    private fun stopRinging() {
        mediaPlayer?.let { runCatching { it.stop() }; it.release() }
        mediaPlayer = null
        vibrator?.cancel()
        vibrator = null
        originalAlarmVolume?.let { vol ->
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            am.setStreamVolume(AudioManager.STREAM_ALARM, vol, 0)
        }
        originalAlarmVolume = null
        releaseWakeLock()
        persistState(RingState.STOPPED)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun loadPersistedState(): RingState {
        val saved = getSharedPreferences(RING_STATE_PREFS, Context.MODE_PRIVATE).getString(PREF_RING_STATE, null)
        return saved?.let { runCatching { RingState.valueOf(it) }.getOrNull() } ?: RingState.STOPPED
    }

    private fun persistState(newState: RingState) {
        state = newState
        getSharedPreferences(RING_STATE_PREFS, Context.MODE_PRIVATE).edit()
            .putString(PREF_RING_STATE, newState.name)
            .apply()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            WAKE_TAG,
        ).apply { acquire(MAX_WAKE_LOCK_MS) }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    private fun playSound() {
        // Ưu tiên âm người dùng tự chọn (AlarmRingingModule.pickAlarmSound) —
        // null nghĩa là chưa chọn gì, dùng luôn chuông mặc định của máy.
        val uri: Uri = loadSoundUri(this)
            ?: RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        mediaPlayer = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            runCatching {
                setDataSource(this@AlarmRingingService, uri)
                isLooping = true
                setOnPreparedListener { it.start() }
                prepareAsync()
            }
        }
    }

    private fun playVibration() {
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 800, 400)
        vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
    }

    private fun ensureChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Báo thức học bài", NotificationManager.IMPORTANCE_HIGH).apply {
            // Channel KHÔNG tự phát âm thanh/rung — service tự làm hai việc đó
            // qua MediaPlayer (luồng Alarm) + Vibrator, để không bị tắt theo
            // chuông im lặng và không rung/kêu đôi.
            setSound(null, null)
            enableVibration(false)
            setBypassDnd(true)
        }
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val contentIntent = Intent(Intent.ACTION_VIEW, Uri.parse("minotara://alarm-session")).apply {
            setPackage(packageName)
        }
        val contentPI = PendingIntent.getActivity(
            this, 0, contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Đến giờ học rồi")
            .setContentText("Làm đúng bài để tắt báo thức.")
            .setSmallIcon(applicationInfo.icon)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(contentPI, true)
            .setContentIntent(contentPI)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        releaseWakeLock()
    }

    companion object {
        private fun send(context: Context, action: String?) {
            val intent = Intent(context, AlarmRingingService::class.java).setAction(action)
            ContextCompat.startForegroundService(context, intent)
        }

        fun start(context: Context) = send(context, null)
        fun pause(context: Context) = send(context, ACTION_PAUSE)
        fun resume(context: Context) = send(context, ACTION_RESUME)
        fun stop(context: Context) = send(context, ACTION_STOP)
    }
}
