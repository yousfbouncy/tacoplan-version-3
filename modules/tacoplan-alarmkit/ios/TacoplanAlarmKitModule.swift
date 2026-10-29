import ExpoModulesCore
import Foundation
import SwiftUI
import AlarmKit

@available(iOS 26.0, *)
public final class TacoplanAlarmKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TacoplanAlarmKit")

    AsyncFunction("requestAuthorization") { () async throws -> String in
      let state = try await AlarmManager.shared.requestAuthorization()
      return String(describing: state)
    }

    AsyncFunction("schedule") { (identifier: String, epochMillis: Double, title: String) async throws in
      guard let id = UUID(uuidString: identifier) else {
        throw NSError(domain: "TacoplanAlarmKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "ID de alarma inválido"])
      }
      let date = Date(timeIntervalSince1970: epochMillis / 1000)
      guard date > Date() else {
        throw NSError(domain: "TacoplanAlarmKit", code: 2, userInfo: [NSLocalizedDescriptionKey: "La alarma debe ser futura"])
      }
      if AlarmManager.shared.authorizationState == .notDetermined {
        _ = try await AlarmManager.shared.requestAuthorization()
      }
      guard AlarmManager.shared.authorizationState == .authorized else {
        throw NSError(domain: "TacoplanAlarmKit", code: 3, userInfo: [NSLocalizedDescriptionKey: "Permiso de alarmas denegado"])
      }
      let stopButton = AlarmButton(text: "Detener", textColor: .white, systemImageName: "stop.circle")
      let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title), stopButton: stopButton)
      let attrs = AlarmAttributes<EmptyAlarmMetadata>(presentation: AlarmPresentation(alert: alert), tintColor: .orange)
      let config = AlarmManager.AlarmConfiguration(schedule: .fixed(date), attributes: attrs)
      _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
    }

    AsyncFunction("cancel") { (identifier: String) throws in
      guard let id = UUID(uuidString: identifier) else { return }
      try AlarmManager.shared.cancel(id: id)
    }

    AsyncFunction("test") { () async throws in
      let id = UUID()
      let stopButton = AlarmButton(text: "Detener", textColor: .white, systemImageName: "stop.circle")
      let alert = AlarmPresentation.Alert(title: "Tacoplan · prueba", stopButton: stopButton)
      let attrs = AlarmAttributes<EmptyAlarmMetadata>(presentation: AlarmPresentation(alert: alert), tintColor: .orange)
      if AlarmManager.shared.authorizationState == .notDetermined {
        _ = try await AlarmManager.shared.requestAuthorization()
      }
      guard AlarmManager.shared.authorizationState == .authorized else {
        throw NSError(domain: "TacoplanAlarmKit", code: 3, userInfo: [NSLocalizedDescriptionKey: "Permiso de alarmas denegado"])
      }
      let config = AlarmManager.AlarmConfiguration(schedule: .fixed(Date().addingTimeInterval(10)), attributes: attrs)
      _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
    }
  }
}
