package expo.modules.tacoplanandroidalarm

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TacoplanAndroidAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TacoplanAndroidAlarm")

    AsyncFunction("schedule") { id: String, epochMillis: Double, title: String, body: String ->
      val context = requireNotNull(appContext.reactContext)
      val time = epochMillis.toLong()
      if (time <= System.currentTimeMillis()) throw IllegalArgumentException("La alarma debe ser futura")
      val mode = TacoplanAlarmReceiver.schedule(context, id, time, title, body)
      TacoplanAlarmReceiver.save(context, id, time, title, body)
      mode
    }

    AsyncFunction("cancel") { id: String ->
      val context = requireNotNull(appContext.reactContext)
      TacoplanAlarmReceiver.cancel(context, id)
    }

    AsyncFunction("canScheduleExact") {
      val context = requireNotNull(appContext.reactContext)
      TacoplanAlarmReceiver.canScheduleExact(context)
    }

    AsyncFunction("openExactAlarmSettings") {
      val context = requireNotNull(appContext.reactContext)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }
  }
}
