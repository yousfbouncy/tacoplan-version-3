# Debug Session: pdf-diets-not-saved

- **Status**: [OPEN]
- **Issue**: Las jornadas importadas desde PDF se muestran sin dietas (o con dieta 0) en Historial, mientras las jornadas manuales sí muestran dieta correctamente.
- **Expected**: Una jornada importada debe persistirse y renderizarse con los mismos campos de dieta que una jornada manual.
- **Environment**: Expo Web (Safari/Brave), PDF Tacoplan con 19 jornadas + 1 registro especial.

## Repro Steps
1. Importar el PDF `InformeYoussefElOmariyosfbouncyJUNIO.pdf`.
2. Abrir Historial.
3. Comparar una jornada importada vs una jornada manual (ej. 14/07/2026).

## Hypotheses
| ID | Hypothesis | Priority | Evidence | Status |
|----|------------|----------|----------|--------|
| A | La dieta se parsea bien, pero se pierde en el merge/prepare antes de persistir (se sobreescribe con null/0). | High | pending | [OPEN] |
| B | La dieta se persiste bien en local, pero al renderizar Historial se calcula/normaliza de nuevo y se muestra 0 (o se toma un campo distinto al de la manual). | High | pending | [OPEN] |
| C | La dieta se persiste bien en local, pero al sincronizar con Supabase y re-mergear desde cloud se pierden campos de dieta. | Med | pending | [OPEN] |
| D | La jornada importada no tiene exactamente la misma forma que la manual (campos ausentes/tipos distintos), y el UI termina mostrando un fallback que parece “sin dieta”. | High | pending | [OPEN] |
| E | La lista Historial está mostrando otra fuente/colección (filtro por semana/rango) y las jornadas importadas se guardan fuera de esa ventana o con startAt/endAt inválidos. | Med | pending | [OPEN] |

## Debug Server
- Endpoint: `http://127.0.0.1:7777/event`
- Logs: `.dbg/trae-debug-log-pdf-diets-not-saved.ndjson`

## Notes
- Durante esta sesión, se instrumenta con reporting por red (sin `console.log`).
