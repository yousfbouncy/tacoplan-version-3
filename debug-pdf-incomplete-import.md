# Debug Session: pdf-incomplete-import
- **Status**: [OPEN]
- **Issue**: La importación PDF sigue mostrando "Los datos del PDF están incompletos" aunque el informe visible contiene jornadas.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-pdf-incomplete-import.ndjson

## Reproduction Steps
1. Abrir la pantalla `Importar`.
2. Seleccionar un PDF de informe Tacoplan con jornadas visibles.
3. Esperar a la vista previa o al error.
4. Observar si aparece `Los datos del PDF están incompletos`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `parseTacoplanReport` devuelve jornadas, pero otra ruta web las descarta y termina en `pdf_incomplete`. | High | Low | Rejected parcialmente: el parser visible llegó con `0` jornadas, no con jornadas válidas descartadas. |
| B | `extractPdfText` en web produce texto distinto al validado localmente y rompe el parseo visible antes del preview. | High | Med | Confirmed: `textLength=6030`, con marcadores visibles pero el parser no encuentra `INICIO` como cabecera limpia. |
| C | El fallback `legacyPdfFallback` o `parseImportDocument` siguen priorizando el backup truncado sobre el informe visible en algún camino residual. | Med | Low | Confirmed secundario: al obtener `0` jornadas, el flujo vuelve al backup truncado y retorna `pdf_incomplete`. |
| D | El parser visible sí entra, pero devuelve `0` jornadas por una excepción interna silenciosa en `parseTopSection` o `parseLowerSection`. | Med | Med | Confirmed: logs muestran error `No se ha encontrado la cabecera INICIO`. |
| E | El PDF nuevo tiene una variante de estructura que no estoy cubriendo y el detalle/resumen dispara una excepción antes de construir el bundle. | Med | Med | Pending |

## Log Evidence
- Instrumentación añadida en `app/importar.web.tsx` y `lib/import-service.ts`.
- Reproducción capturada con `InformeYoussefElOmariyosfbouncyJUNIO.pdf`.
- `extractPdfText` en web: `pageCount=2`, `textLength=6030`, `hasHistorial=true`, `hasResumen=true`, `hasDetalle=true`, `hasMarker=true`.
- `parseTacoplanReport` en web: `jornadas=0`, `specials=0`, error principal `No se ha encontrado la cabecera INICIO`.
- `parseImportDocument`: al no haber jornadas visibles, cae al backup embebido truncado y devuelve `pdf_incomplete`.
- Nueva evidencia local con el texto extraído de `/tmp/tacoplan_pdf_page_1.txt`:
  - la parte superior viene realmente en columnas separadas (`INICIO`, `FIN`, `ORIGEN`, `DESTINO`, `DURACION`) y no como filas;
  - `RUTA CONDUCCION` aparece compactado;
  - `EXTRA PLUS` aparece compactado;
  - la parte inferior sí contiene bloques por jornada completos después de `OBS.`.
- Prueba local ejecutada con `ruby scripts/test_tacoplan_pdf_import.rb /Users/ejaremtchuk/Downloads/InformeYoussefElOmariyosfbouncyJUNIO.pdf`:
  - `19` jornadas normales;
  - `1` registro especial;
  - `20` registros totales;
  - `8169` min de conducción (`136h 9m`);
  - `11151` min de duración (`185h 51m`);
  - `1495.40 EUR` de dietas;
  - `246.38 EUR` de extras;
  - `0.00 EUR` de plus;
  - `1741.78 EUR` de total;
  - `0` filas rechazadas.

## Verification Conclusion
- Fix en curso:
  1. `parseTopSection` ya no depende de índices de línea para localizar `INICIO/FIN/ORIGEN/DESTINO/DURACION/OBS.`; ahora corta el texto por segmentos reales entre marcadores y extrae fechas, ubicaciones, rutas y duraciones por regex.
  2. `extractLowerBlocks` ya no usa anclas hardcodeadas por fecha; ahora detecta los bloques inferiores por patrón de doble fecha + doble hora y el bloque especial `🛌`.
  3. `findValueAfterLabel` ahora tolera importes en la misma línea o en texto compactado dentro de `Resumen de Dietas`.

## Next Verification
- Reproducir otra vez la importación en web y comparar logs `post-fix`:
  - esperado mínimo: apertura de vista previa incluso si hubiera avisos parciales;
  - esperado ideal: `19` jornadas, `1` especial, sin retorno final `pdf_incomplete` y con tarjeta de diagnóstico disponible cuando corresponda.
