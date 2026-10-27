# AutoStart: guardado local y actualización de Inicio

Se mantiene el criterio existente: 3 tramos en 20 minutos, uno de al menos 60 segundos, o 3 minutos continuos desde 15 km/h. El aviso inicial no equivale a una jornada creada.

Correcciones:
- Serializar entregas GPS en el mismo runtime e ignorar muestras repetidas.
- No esperar a geocodificación inversa para crear la jornada: guardar una referencia GPS.
- Guardar la finalización local antes de consultas remotas, widgets o notificaciones.
- Limitar la espera de consultas remotas y notificaciones opcionales.
- Refrescar jornada abierta y estado legal tras el inicio, al entrar en Inicio y al volver del segundo plano.
- No iniciar si ya hay jornada abierta o el ámbito local pertenece a otra cuenta.

Validación: 77 pruebas y TypeScript. Nueve pruebas nuevas ejecutan el callback real de TaskManager con adaptadores nativos simulados y comprueban movimiento continuo, aviso seguido de tres tramos, fallo remoto, concurrencia, reintento tras fallo de almacenamiento, otra cuenta/jornada manual, GPS discontinuo y timeout.

Limitaciones: no se ha reproducido el incidente en el teléfono del usuario ni se ha ejecutado una compilación nativa. La exclusión es dentro del mismo runtime; no es un bloqueo entre procesos. Un fallo remoto puede dejar una propuesta pendiente en la nube aunque la jornada esté guardada localmente. El sistema operativo debe seguir entregando ubicaciones. No se cambia el periodo existente de 8 horas entre inicios automáticos. La ubicación GPS guardada corresponde a la lectura de confirmación, no necesariamente al primer movimiento.

Prueba en dispositivo: instalar una build que contenga este cambio, activar ubicación en segundo plano y AutoStart, comprobar sin jornada abierta el inicio tras movimiento continuo; repetir con pantalla bloqueada y sin conexión. Confirmar una sola jornada con la hora inicial, visible al volver a Inicio, y los avisos 13/15 h según el contexto disponible.
