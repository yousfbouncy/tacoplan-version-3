# Alarmas 13/15 h: integración preparada

Base inspeccionada: main, d5adbc9. Referencias: PR #2 (fusionado) e issue #1.

## Hallazgo

El estado posterior al PR ya contiene `syncAvailabilityAlarms`, invocado desde Inicio y AutoStart. La desconexión actual está en `getEstadoLegal → disponibilidadMin → syncAvailabilityAlarms`: el contador usa semana natural, el adaptador convierte cualquier número >=900 en «disponible» y pierde «desconocida». Un estado ausente suprime todos los avisos. La doble conducción también puede interpretarse como una ampliación a 15 h.

## Cambio

`getEstadoLegal` calcula `availabilityContext` a partir de las jornadas registradas. Cuenta los descansos reducidos entre descansos semanales observados, incluyendo el intervalo anterior a la jornada abierta y excluyendo 3+9 cualificados según el motor existente. No reinicia el lunes. Un historial sin límite de ciclo observable, incoherente o con descanso insuficiente produce condición desconocida. Los registros existentes no se modifican.

Inicio y AutoStart pasan ese contexto a `planAvailabilityAlarms`. El contexto debe pertenecer al ID real de la jornada; un resultado obsoleto se trata como desconocido. AutoStart conserva el ID devuelto por la creación de jornada. El instante absoluto guardado prevalece sobre la reconstrucción de la hora local.

| Condición | Avisos propuestos |
| --- | --- |
| Ampliaciones disponibles >0 | 12:55 transcurridas: suave; 14:55: urgente |
| Ampliaciones disponibles =0 | 12:55: urgente |
| Condición desconocida o estado no disponible | 12:55: preventivo, sin afirmar infracción |
| Doble conducción conocida | No aplica este plan de 13/15 h |
| Jornada cerrada, alarmas desactivadas o vencidas | Ninguna propuesta futura |

La sincronización nativa cancela exclusivamente las alarmas de amplitud existentes, conserva identificadores deterministas y serializa las llamadas dentro del mismo runtime. Los fallos de lectura/cancelación no se silencian antes de programar duplicados.

## Validación

- `npm test`: 68 pruebas correctas, incluidas 9 nuevas de integración pura del contador y plan de alarmas.
- `npm run typecheck`: correcto.
- `git diff --check`: correcto.
- Casos adicionales: lunes sin descanso semanal, reinicio tras descanso semanal, descanso anterior a jornada abierta, 3+9, duplicados, historial incompleto, doble conducción, cierre, desactivación, vencimiento, edición y DST.

## Límites pendientes

No se ha ejecutado APK/TestFlight ni comprobado entrega con pantalla bloqueada, permisos revocados o proceso terminado. Las pruebas nuevas validan el plan usado por el adaptador, no el sistema operativo. La cola solo serializa el runtime actual. El historial registrado no demuestra actividad no registrada ni que una ausencia entre jornadas fuera realmente descanso. La disponibilidad numérica conserva 13 h como referencia conservadora cuando el contexto es desconocido; los consumidores deben consultar también la condición explícita. La rama no completa widgets nativos ni el flujo AutoStart ni incorpora una alarma de doble conducción.
