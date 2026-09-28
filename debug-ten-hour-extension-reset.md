# Debug Session: ten-hour-extension-reset
- **Status**: [OPEN]
- **Issue**: Un usuario reporta que las extensiones de conducción de 10 horas no se reinician el lunes, mientras que al resto sí.
- **Debug Server**: `http://192.168.1.248:7777/event`
- **Log File**: `.dbg/trae-debug-log-ten-hour-extension-reset.ndjson`

## Reproduction Steps
1. Identificar en qué función se calcula el contador semanal de extensiones de 10h.
2. Comparar cómo se recalcula al abrir la app y al cerrar/iniciar jornada.
3. Revisar si la semana se calcula en hora local o UTC y si el cruce domingo-lunes puede contaminar el contador.
4. Verificar si hay datos del usuario con fechas corruptas, duplicadas o jornadas antiguas que sigan entrando en la semana activa.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | El inicio de semana se calcula con fecha local en una ruta y con fecha string/UTC en otra, por lo que un usuario con jornadas cerca de medianoche sigue contando extensiones del domingo el lunes. | High | Med | Pending |
| B | Existe una diferencia entre el cálculo usado en `legalEngine` y el cálculo persistido/recalculado desde `local-storage`, y solo una de las rutas se usa para ese usuario. | High | Med | Pending |
| C | El usuario tiene jornadas duplicadas o con `fechaFin`/`fechaInicio` incoherentes, y el filtrado semanal no las deduplica igual en todas las rutas. | Med | Med | Pending |
| D | Una jornada antigua que cruza domingo-lunes está aportando conducción semanal por el helper `getJornadaDrivingForWeek`, y eso impide el reinicio aparente de extensiones. | High | Med | Pending |
| E | El problema depende del momento de recálculo al abrir la app o de un dato corrupto del dispositivo/zonahoraria del usuario, no de la regla global. | Med | High | Pending |

## Log Evidence
- Hipótesis A y B: el recálculo al abrir la app es consistente en todas las capturas. Siempre devuelve `extensiones10h = 1`, `conduccionSemanalMin = 1827` y `timezoneOffsetMin = -120`.
- Hipótesis D: se repite la misma jornada cruzando domingo-lunes (`mqy7r9kpmqntnvaeg`) en el reparto semanal:
  - semana `2026-06-22` a `2026-06-28`: devuelve `conduccionDomingoMin = 205`
  - semana `2026-06-29` a `2026-07-05`: devuelve `conduccionLunesMin = 0`
- No se observan ids duplicados en `weeklyIds`; la lista semanal capturada contiene 6 ids únicos.
- La traza E muestra el mismo estado legal tanto en `web` como en `ios`, así que no hay evidencia de diferencia por plataforma.

## Provisional Root Cause
- El contador de extensiones semanales se incrementa por `j.conduccionMin > 9 * 60` aunque la parte de conducción imputada a la semana actual sea `0`.
- Esto solo se manifiesta en usuarios con jornadas que cruzan domingo -> lunes y con datos de conducción divididos por semana; por eso no afecta a todos.
- No hay evidencia de que el problema venga de UTC vs local en la traza capturada, ni de duplicados, ni de una diferencia entre `getEstadoLegal()` y la UI.

## Verification Conclusion
Pendiente de confirmar con un caso del lunes afectado y, después, aplicar un fix mínimo basado en `weekDriving` real en lugar de `conduccionMin` total.
