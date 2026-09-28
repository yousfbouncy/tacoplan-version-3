# Debug Session: jornada-date-drift
- **Status**: [OPEN]
- **Issue**: Algunas jornadas cambian de fecha entre la selección visible para el usuario y el estado final guardado, leído o renderizado.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-jornada-date-drift.ndjson

## Reproduction Steps
1. Crear una jornada nueva con fecha y hora elegidas manualmente.
2. Editar una jornada existente y volver a guardar.
3. Finalizar una jornada abierta.
4. Sincronizar y volver a leer desde almacenamiento local y Supabase.
5. Verificar la fecha mostrada en Historial.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | La fecha cambia al construir `startAt` o `endAt` usando `new Date("YYYY-MM-DD")`, `toISOString()` o parsing UTC implícito. | High | Low | Rejected por reproducción: el bug aparece antes de persistir, al no actualizarse el ISO interno desde el input visible. |
| B | La fecha elegida por el usuario se conserva antes de guardar pero el mapper a base de datos (`save/update/finish`, `toDatabaseRow`) la transforma o la sobrescribe. | High | Medium | Rejected para la causa principal: el valor equivocado ya entra al guardado si el parser no acepta el input visible. |
| C | Supabase almacena correctamente el instante, pero al leerlo (`fromDatabaseRow`, sync, normalizadores) se reconstruye `fechaInicio`/`fechaFin` desde `startAt` en UTC y cambia el día. | High | Medium | Inconclusive para casos antiguos; instrumentación añadida para comparar payload, fila almacenada y fila leída. |
| D | El fallo afecta solo a algunos usuarios por datos antiguos, formatos mixtos o diferencias de zona horaria/plataforma durante sync o hidratación local. | Medium | Medium | Confirmed parcialmente: afecta a usuarios que introducen fechas visibles como `17/7/2026`, `7/07/2026` o con espacios, que el parser anterior rechazaba. |
| E | Historial renderiza desde `startAt` en lugar de usar `fechaInicio` como fuente de verdad, generando deriva visible aunque la persistencia sea correcta. | Medium | Low | Rejected en el flujo principal actual: `Historial` muestra `item.fechaInicio` y `item.fechaFin`. |

## Log Evidence
- Reproducción dirigida con `npx tsx -e "import { parseDisplayDateToISO } from './lib/utils.ts'; ..."`:
  - `17/07/2026 => 2026-07-17`
  - `17/7/2026 => null`
  - `7/07/2026 => null`
  - `7/7/2026 => null`
- Simulación del flujo UI anterior:
  - `visible = 17/7/2026`
  - `internal = 2026-07-17`
  - Con un ISO previo distinto, el texto visible del usuario no actualizaba el valor interno que luego se guardaba.
- Instrumentación temporal añadida en:
  - `app/(tabs)/index.tsx`
  - `app/editar-jornada.tsx`
  - `app/(tabs)/historial.tsx`
  - `lib/local-storage.ts`
  - `lib/sync-service.ts`
- Suite dirigida ejecutada:
  - `npx tsx --test tests/jornada-date-flow.test.ts`
  - Resultado: 10/10 tests OK.

## Verification Conclusion
- **Root cause confirmed**: el bug principal no venía de UTC/Supabase en el primer salto, sino de la separación entre:
  - `fechaInicioInput` / `fechaFinInput`: texto visible para el usuario
  - `fechaInicio` / `fechaFin`: ISO interno usado al guardar
- El parser anterior (`parseDisplayDateToISO`) solo aceptaba `DD/MM/YYYY` exacto con 2 dígitos. Si el usuario escribía `17/7/2026`, el input en pantalla parecía correcto pero el ISO interno quedaba con el valor anterior.
- **Minimal fix applied**:
  - el parser ahora acepta `D/M/YYYY`, `DD/M/YYYY`, `D/MM/YYYY` y espacios alrededor de `/`;
  - los flujos de inicio, edición, finalización y jornada completa revalidan el input visible justo antes de guardar y bloquean el envío si la fecha visible no es válida.
- **Regression coverage**:
  - jornada normal;
  - cruce de medianoche;
  - caso `23:59 -> 00:10`;
  - edición y re-guardado;
  - cierre de jornada abierta;
  - variantes `Europe/Madrid`, `Europe/Paris`, `Europe/Warsaw` a nivel de conservación de fecha local.
