# Alarmas nativas Tacoplan: iPhone y Android

## Requisito confirmado — 16/11/2026

La misma experiencia de aviso debe existir en **iOS y Android**. No intentar instalar AlarmKit en Android: AlarmKit es exclusivo de Apple.

### 1. Avisos de jornada (13/15 horas)
- iOS 26+: integrar y validar el módulo nativo **AlarmKit** que está preparado en la rama `feature/ios-alarmkit` (todavía no forma parte de `main`).
- iOS anterior: notificaciones locales como alternativa con limitaciones expresas de sonido.
- Android: implementar alarmas nativas mediante `AlarmManager` y, si las políticas del sistema y los permisos lo permiten, alarmas exactas; notificación de alta prioridad y canal con sonido y vibración. Solicitar autorización para alarmas exactas **solo cuando sea pertinente**, sin asumir concesión. No prometer que todas las versiones o estados de silencio permiten sonar.
- Con ampliación 15 h confirmada: recordatorio 10 min antes de 13 h; aviso 30 y 10 min antes de 15 h.
- Sin ampliación confirmada: avisos 30 y 10 min antes de 13 h.
- Cancelar avisos al cerrar jornada y al desactivar preferencias; no duplicar reprogramaciones. Validar cambios de hora y reinicio del dispositivo.

### 2. Nueva asignación de Tráfico: «tu-tu-tu-tut»
- Separar esta categoría del límite de jornada. Emitir aviso solo ante **nuevo viaje asignado**, identificándolo por ID de asignación/evento único. No sonar por cada sincronización ni por simples refrescos.
- Mostrar empresa/cliente, primera parada y botón «Ver viaje». Usar un sonido original y breve «tu-tu-tu-tut», empaquetado como recurso compatible de iOS y Android, con vibración y preferencia para silenciarlo.
- Como la app puede estar cerrada, no depender solo de la descarga al abrir «Viajes»: desde el backend que crea el viaje se deberá emitir un **push** al conductor con enlace a la orden; coordinar cliente y servidor para idempotencia.
- La reproducción, repetición y prioridad dependen de permisos, sistema operativo, modo silencio/no molestar y restricciones de segundo plano. No prometer un despertador infalible en todos los dispositivos.
- En Android configurar canal de notificación propio para viajes; canal separado de jornada. En iOS, si se desea una alarma de sistema para asignaciones, revisar requisitos y restricciones; las notificaciones push normales no equivalen a AlarmKit.

### 3. Validación pendiente
- Confirmar permisos de notificación y alarmas en ambos sistemas.
- Probar app en segundo plano, cerrada, dispositivo bloqueado, sin conexión, repetición de un push, duplicidad en sincronización, dos órdenes seguidas, viaje cambiado y jornada cerrada.
- Probar el sonido real en un iPhone y un Android; no dar por completado sin un binario nuevo y pruebas de dispositivo.

## Estado del código al registrar esta decisión
- `main` todavía usa `expo-notifications` para avisos de amplitud; no tiene integración Android equivalente a una alarma nativa completa.
- La rama `feature/ios-alarmkit` tiene módulo Swift + puente, pero está separada de `main`.
- La creación desde Tráfico y el pull móvil de asignaciones están integrados en repositorios; el push de una asignación nueva con sonido distintivo NO está implementado de extremo a extremo.
