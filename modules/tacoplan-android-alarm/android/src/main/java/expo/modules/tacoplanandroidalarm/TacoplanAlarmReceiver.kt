package expo.modules.tacoplanandroidalarm

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/** System-owned alarm: fires even if the React Native JS process is stopped. */
class TacoplanAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("alarmId") ?: return
    val title = intent.getStringExtra("title") ?: "Tacoplan · Alarma de jornada"
    val body = intent.getStringExtra("body") ?: "Comprueba el tiempo restante de tu jornada."
    preferences(context).edit().remove(id).apply()

    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channelId = "tacoplan-jornada-native-v1"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(channelId, "Alarmas de límite de jornada", NotificationManager.IMPORTANCE_HIGH)
      val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      channel.setSound(alarmSound,
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
      channel.enableVibration(true)
      channel.vibrationPattern = longArrayOf(0L, 400L, 150L, 400L, 150L, 650L)
      manager.createNotificationChannel(channel)
    }

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launch?.let {
      PendingIntent.getActivity(
        context, id.hashCode(), it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    val notification: Notification = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(title)
      .setContentText(body)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setDefaults(Notification.DEFAULT_VIBRATE)
      .setContentIntent(contentIntent)
      .build()
    try {
      manager.notify(id.hashCode(), notification)
    } catch (_: SecurityException) {
      // Notifications may be disabled in device settings.
    }
  }

  companion object {
    private const val PREFS = "tacoplan_native_alarm_schedule"

    fun preferences(context: Context) =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun intent(context: Context, id: String, title: String = "", body: String = "") =
      Intent(context, TacoplanAlarmReceiver::class.java).apply {
        action = "expo.modules.tacoplanandroidalarm.SHOW"
        data = Uri.parse("tacoplan-alarm://jornada/" + Uri.encode(id))
        putExtra("alarmId", id)
        putExtra("title", title)
        putExtra("body", body)
      }

    fun canScheduleExact(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      return manager.canScheduleExactAlarms()
    }

    fun schedule(context: Context, id: String, time: Long, title: String, body: String): String {
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val broadcast = PendingIntent.getBroadcast(context, id.hashCode(), intent(context, id, title, body),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      if (canScheduleExact(context)) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, broadcast)
        } else {
          manager.setExact(AlarmManager.RTC_WAKEUP, time, broadcast)
        }
        return "exact"
      }
      // Android 12–16 may deny exact-alarm access. Still schedule a best-effort
      // alarm; never falsely say that this fallback is exact.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, broadcast)
      } else {
        manager.set(AlarmManager.RTC_WAKEUP, time, broadcast)
      }
      return "inexact"
    }

    fun save(context: Context, id: String, time: Long, title: String, body: String) {
      val json = JSONObject().put("time", time).put("title", title).put("body", body)
      preferences(context).edit().putString(id, json.toString()).apply()
    }

    fun cancel(context: Context, id: String) {
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val broadcast = PendingIntent.getBroadcast(context, id.hashCode(), intent(context, id),
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
      if (broadcast != null) {
        manager.cancel(broadcast)
        broadcast.cancel()
      }
      preferences(context).edit().remove(id).apply()
    }
  }
}

/** Re-register pending alarms after reboot, preserving the original deadline. */
class TacoplanAlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    val prefs = TacoplanAlarmReceiver.preferences(context)
    val records = prefs.all.toMap()
    for ((id, raw) in records) {
      try {
        val json = JSONObject(raw as String)
        val time = json.getLong("time")
        if (time <= System.currentTimeMillis()) {
          prefs.edit().remove(id).apply()
          continue
        }
        TacoplanAlarmReceiver.schedule(
          context, id, time, json.optString("title"), json.optString("body")
        )
      } catch (_: Exception) {
        prefs.edit().remove(id).apply()
      }
    }
  }
}
