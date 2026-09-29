import type { DayExtraEntry, Jornada } from "@/lib/local-storage";
import { normalizeLocationText, splitLocationFragments, splitNormalizedLocations } from "@/lib/location-normalization";

const PAGE_BREAK = "<<<TACOPLAN_PAGE_BREAK>>>";
const MONEY_TOLERANCE = 0.011;

type DietDetailRow = {
  date: string;
  routeLabel: string;
  dietPercent: number | null;
  dietAmount: number | null;
  totalAmount: number | null;
  extraAmount: number | null;
  plusAmount: number | null;
  extraType: "DOMINGO" | "FESTIVO" | null;
};

export type ParsedDietSummary = {
  totalDietas: number;
  totalExtras: number;
  totalPlus: number;
  totalOverall: number;
  detailRows: DietDetailRow[];
  breakdown: Array<{ label: string; count: number; amount: number }>;
  extrasBreakdown: Array<{ label: string; count: number; amount: number }>;
  offsiteWeeklyCompleteInternationalAmount: number | null;
};

export type TacoplanReportParseResult = {
  range: { from: string | null; to: string | null };
  generatedAt: string | null;
  jornadas: Jornada[];
  dayExtraEntries: DayExtraEntry[];
  totalDrivingMin: number;
  totalDurationMin: number;
  totalDietas: number;
  totalExtras: number;
  totalPlus: number;
  totalOverall: number;
  errors: string[];
  diagnostics: {
    pageCount: number;
    textLength: number;
    sections: {
      historial: boolean;
      resumen: boolean;
      detalle: boolean;
      marker: boolean;
    };
    dateCount: number;
    timeCount: number;
    routeCount: number;
    amountCount: number;
    candidateRows: number;
    parsedRows: number;
    rejectedRows: Array<{ label: string; reason: string }>;
    firstParsedBlock: string | null;
    lastParsedBlock: string | null;
    textPreview: string;
  };
};

export type ImportedJornadaDTO = {
  fechaInicio: string;
  horaInicio: string;
  fechaFin: string;
  horaFin: string;
  lugarInicio: string;
  lugarFin: string;
  tipoRuta: "NACIONAL" | "INTERNACIONAL";
  conduccionMin: number;
  duracionJornadaMin: number;
  dietaTotalEur: number | null;
  dietaBaseEur: number | null;
  dietaPercent: number | null;
  dayFlag: "DOMINGO" | "FESTIVO" | null;
  dayExtraEur: number | null;
  plusEur: number | null;
  observaciones: string | null;
  dietRule: string | null;
  dietasItems: Jornada["dietasItems"];
  rawLugarInicio: string | null;
  rawLugarFin: string | null;
};

function normalizeSpaces(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseMinutes(value: string): number | null {
  const match = value.match(/(\d{1,2})h(?:\s*(\d{1,2})m)?/i);
  if (!match) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

function parseMoney(value: string): number | null {
  const match = value.replace(/\s/g, "").match(/([0-9]+(?:[.,][0-9]{1,2})?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function formatAmount(value: number | null): string | null {
  return value == null ? null : value.toFixed(2);
}

function routeLabelToTipoRuta(value: string): Jornada["tipoRuta"] {
  const normalized = normalizeLabel(value);
  if (normalized.includes("intern")) return "INTERNACIONAL";
  if (normalized.includes("regional")) return "NAC_REGIONAL";
  if (normalized.includes("nacional")) return "NACIONAL";
  return "NINGUNO";
}

function buildJornadaId(date: string, time: string, origin: string, destination: string): string {
  const safeOrigin = normalizeLabel(normalizeLocationText(origin)).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const safeDestination = normalizeLabel(normalizeLocationText(destination)).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `pdf_${date}_${time.replace(":", "")}_${safeOrigin}_${safeDestination}`;
}

function cleanObservation(value: string | null | undefined): string | null {
  const text = normalizeSpaces(String(value || "").replace(/^-\s*/, ""));
  if (!text || text === "-" || text === "- -") return null;
  return text;
}

function parseRange(page1: string): { from: string | null; to: string | null; generatedAt: string | null } {
  const rangeMatch = page1.match(/Periodo:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
  const generatedMatch = page1.match(/Generado:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/);
  return {
    from: rangeMatch ? toIsoDate(rangeMatch[1]) : null,
    to: rangeMatch ? toIsoDate(rangeMatch[2]) : null,
    generatedAt: generatedMatch ? generatedMatch[1] : null,
  };
}

function splitPages(text: string): [string, string] {
  if (text.includes(PAGE_BREAK)) {
    const pages = text.split(PAGE_BREAK).map((part) => part.trim()).filter(Boolean);
    if (pages.length >= 2) return [pages[0], pages[1]];
  }
  const marker = text.indexOf("Resumen de Dietas");
  if (marker === -1) throw new Error("No se ha encontrado la segunda pagina del informe");
  const previousBreak = text.lastIndexOf("\n", marker);
  return [text.slice(0, previousBreak).trim(), text.slice(previousBreak).trim()];
}

function reverseLine(line: string): string {
  return Array.from(line).reverse().join("");
}

function normalizeMirroredPdfText(text: string): string {
  const normalMarkers = [
    "Tacoplan - Informe",
    "Historial de Jornadas",
    "Resumen de Dietas",
    "Detalle por jornada",
    "Periodo:",
    "Generado:",
  ];
  const reversedMarkers = normalMarkers.map((marker) => reverseLine(marker));

  const normalScore = normalMarkers.reduce((sum, marker) => sum + (text.includes(marker) ? 1 : 0), 0);
  const reversedScore = reversedMarkers.reduce((sum, marker) => sum + (text.includes(marker) ? 1 : 0), 0);

  if (reversedScore === 0 || reversedScore <= normalScore) {
    return text;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line === PAGE_BREAK ? line : reverseLine(line))
    .join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMarkerMatch(text: string, markers: string[], fromIndex = 0): { index: number; length: number; marker: string } | null {
  const slice = text.slice(fromIndex);
  let best: { index: number; length: number; marker: string } | null = null;

  for (const marker of markers) {
    const pattern = marker
      .trim()
      .split(/\s+/)
      .map((part) => escapeRegex(part))
      .join("\\s+");
    const match = new RegExp(pattern, "i").exec(slice);
    if (!match || match.index == null) continue;
    const candidate = {
      index: fromIndex + match.index,
      length: match[0].length,
      marker,
    };
    if (!best || candidate.index < best.index) {
      best = candidate;
    }
  }

  return best;
}

function sliceBetweenMarkersAfter(text: string, fromIndex: number, startMarkers: string[], endMarkers: string[]): string {
  const start = findMarkerMatch(text, startMarkers, fromIndex);
  if (!start) {
    throw new Error(`No se ha encontrado el marcador ${startMarkers[0]}`);
  }

  const contentStart = start.index + start.length;
  const end = findMarkerMatch(text, endMarkers, contentStart);
  return (end ? text.slice(contentStart, end.index) : text.slice(contentStart)).trim();
}

function extractDateTimesFromText(text: string): string[] {
  return Array.from(text.matchAll(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/g)).map((match) => normalizeSpaces(match[0]));
}

function extractDurationsFromText(text: string): string[] {
  return Array.from(text.matchAll(/\d{1,2}h(?:\s*\d{1,2}m)?/gi)).map((match) => normalizeSpaces(match[0]));
}

function extractRoutesFromText(text: string): string[] {
  return Array.from(text.matchAll(/\b(Internacional|Nacional)\b/gi)).map((match) => normalizeSpaces(match[1]));
}

function extractLocationsFromText(text: string): string[] {
  return splitNormalizedLocations(text);
}

function takeNonEmpty(lines: string[]): string[] {
  return lines.map((line) => normalizeSpaces(line)).filter(Boolean);
}

function getArrayValue<T>(items: T[], index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function getSectionLines(page: string, startLabel: string): string[] {
  const normalizedPage = page.replace(/\u00a0/g, " ");
  const startIndex = normalizeLabel(normalizedPage).indexOf(normalizeLabel(startLabel));
  if (startIndex === -1) throw new Error(`No se ha encontrado la sección ${startLabel}`);

  const tail = normalizedPage.slice(startIndex);
  const stopIndex = ["TACOPLAN_DATA:", "Generado por Tacoplan", "about:blank"]
    .map((token) => tail.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const section = stopIndex != null ? tail.slice(0, stopIndex) : tail;
  return section.split(/\r?\n/).map((line) => line.replace(/\u00a0/g, " "));
}

function findValueAfterLabel(lines: string[], label: string): string | null {
  const normalizedTarget = normalizeLabel(label);
  for (let index = 0; index < lines.length; index++) {
    const line = normalizeSpaces(lines[index]);
    const normalizedLine = normalizeLabel(line);

    if (normalizedLine === normalizedTarget) {
      for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
        const candidate = normalizeSpaces(lines[nextIndex]);
        if (candidate) return candidate;
      }
      continue;
    }

    if (normalizedLine.startsWith(`${normalizedTarget} `)) {
      const inlineValue = line.slice(line.toLowerCase().indexOf(label.toLowerCase()) + label.length).trim();
      if (inlineValue) return inlineValue;
    }
  }

  const fullText = normalizeSpaces(lines.join(" "));
  const inlinePattern = new RegExp(`${label.replace(/\s+/g, "\\s+")}\\s+([0-9]+(?:[.,][0-9]{1,2})?\\s*€)`, "i");
  const inlineMatch = fullText.match(inlinePattern);
  if (inlineMatch) {
    return inlineMatch[1];
  }

  for (let index = 0; index < lines.length; index++) {
    if (normalizeLabel(lines[index]) !== normalizedTarget) continue;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
      const candidate = normalizeSpaces(lines[nextIndex]);
      if (candidate) return candidate;
    }
  }
  return null;
}

function parseBreakdownSection(lines: string[]): {
  breakdown: Array<{ label: string; count: number; amount: number }>;
  extrasBreakdown: Array<{ label: string; count: number; amount: number }>;
  offsiteWeeklyCompleteInternationalAmount: number | null;
} {
  const compact = takeNonEmpty(lines);
  const breakdown: Array<{ label: string; count: number; amount: number }> = [];
  const extrasBreakdown: Array<{ label: string; count: number; amount: number }> = [];

  for (let index = 0; index < compact.length; index++) {
    const current = compact[index];
    const next = compact[index + 1] || "";
    const afterNext = compact[index + 2] || "";

    if ((normalizeLabel(current) === "domingo" || normalizeLabel(current) === "festivo") && /^\d+$/.test(next) && /€/.test(afterNext)) {
      extrasBreakdown.push({
        label: current,
        count: Number(next),
        amount: parseMoney(afterNext) || 0,
      });
      continue;
    }

    const countMatch = current.match(/(\d+)$/);
    if (countMatch && /€/.test(next) && index > 0) {
      const label = compact[index - 1];
      if (!normalizeLabel(label).startsWith("total") && normalizeLabel(label) !== "cantidad") {
        breakdown.push({
          label,
          count: Number(countMatch[1]),
          amount: parseMoney(next) || 0,
        });
      }
    }
  }

  const offsiteWeeklyCompleteInternationalAmount = breakdown.find((entry) =>
    normalizeLabel(entry.label).includes("fuera_base_weekly_complete_internacional"),
  )?.amount ?? null;

  return { breakdown, extrasBreakdown, offsiteWeeklyCompleteInternationalAmount };
}

function parseExtraPlusPair(value: string): { extraAmount: number | null; plusAmount: number | null } {
  const parts = value.match(/-|[0-9]+(?:[.,][0-9]{1,2})?\s*€/gi) || [];
  const extraToken = parts[0] || null;
  const plusToken = parts[1] || null;
  return {
    extraAmount: extraToken && extraToken !== "-" ? parseMoney(extraToken) : null,
    plusAmount: plusToken && plusToken !== "-" ? parseMoney(plusToken) : null,
  };
}

function parseDetailSectionByColumns(lines: string[]): DietDetailRow[] {
  const compact = takeNonEmpty(lines);
  const firstDateIndex = compact.findIndex((line) => /^\d{2}\/\d{2}\/\d{4}$/.test(line));
  if (firstDateIndex === -1) throw new Error("No se han encontrado fechas en el detalle por jornada");

  const dates: string[] = [];
  let cursor = firstDateIndex;
  while (cursor < compact.length && /^\d{2}\/\d{2}\/\d{4}$/.test(compact[cursor])) {
    dates.push(compact[cursor]);
    cursor++;
  }

  while (cursor < compact.length && (/^\d+$/.test(compact[cursor]) || normalizeLabel(compact[cursor]) === "cantidad")) {
    cursor++;
  }

  const routes = compact
    .slice(cursor)
    .filter((line) => {
      const normalized = normalizeLabel(line);
      return normalized === "nacional" || normalized === "internacional";
    })
    .slice(0, dates.length);

  const diets = compact
    .filter((line) => /\d+%\s*[0-9]+(?:[.,][0-9]{1,2})?\s*€/i.test(line))
    .slice(0, dates.length);

  const extraHeaderIndex = compact.findIndex((line) => {
    const normalized = normalizeLabel(line);
    return normalized === "extra" || normalized === "plus" || (normalized.includes("extra") && normalized.includes("plus"));
  });
  if (extraHeaderIndex === -1) throw new Error("No se ha encontrado la sección de extras");

  const extras = compact
    .slice(extraHeaderIndex + 1)
    .filter((line) => /^(-|[0-9]+(?:[.,][0-9]{1,2})?\s*€)(\s+(-|[0-9]+(?:[.,][0-9]{1,2})?\s*€))*$/i.test(line))
    .slice(0, dates.length);

  const totalHeaderIndex = compact.findIndex((line, index) => index > extraHeaderIndex && normalizeLabel(line) === "total");
  if (totalHeaderIndex === -1) throw new Error("No se ha encontrado la columna de total");

  const totals = compact
    .slice(totalHeaderIndex + 1)
    .filter((line) => /^[0-9]+(?:[.,][0-9]{1,2})?\s*€$/i.test(line))
    .slice(0, dates.length);

  if (dates.length === 0 || dates.length !== routes.length || dates.length !== diets.length || dates.length !== extras.length || dates.length !== totals.length) {
    throw new Error("El detalle por jornada no se ha podido alinear");
  }

  return dates.map((date, index) => {
    const dietLine = diets[index];
    const percentMatch = dietLine.match(/(\d+)%/);
    const { extraAmount, plusAmount } = parseExtraPlusPair(extras[index]);
    return {
      date: toIsoDate(date) || date,
      routeLabel: routes[index],
      dietPercent: percentMatch ? Number(percentMatch[1]) : null,
      dietAmount: parseMoney(dietLine.replace(/^.*?(\d+%)\s*/, "").replace(/^\d+%\s*/, "")),
      totalAmount: parseMoney(totals[index]),
      extraAmount,
      plusAmount,
      extraType: null,
    };
  });
}

function parseDetailSectionByRows(lines: string[]): DietDetailRow[] {
  const normalized = normalizeSpaces(lines.join(" "));
  const rowRegex = /(\d{2}\/\d{2}\/\d{4})\s+(Internacional|Nacional)\s+(\d{1,3})%\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*€\s+(-|[0-9]+(?:[.,][0-9]{1,2})?\s*€)\s+(-|[0-9]+(?:[.,][0-9]{1,2})?\s*€)\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*€/gi;
  const rows: DietDetailRow[] = [];
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(normalized))) {
    rows.push({
      date: toIsoDate(match[1]) || match[1],
      routeLabel: match[2],
      dietPercent: Number(match[3]),
      dietAmount: parseMoney(match[4]),
      extraAmount: parseMoney(match[5]),
      plusAmount: parseMoney(match[6]),
      totalAmount: parseMoney(match[7]),
      extraType: null,
    });
  }

  if (rows.length === 0) throw new Error("No se han podido localizar filas del detalle por jornada");
  return rows;
}

function parseDetailSectionLoosely(lines: string[]): DietDetailRow[] {
  const normalized = normalizeSpaces(lines.join(" "));
  const chunks = normalized
    .split(/(?=\d{2}\/\d{2}\/\d{4}\s)/g)
    .map((chunk) => normalizeSpaces(chunk))
    .filter((chunk) => /^\d{2}\/\d{2}\/\d{4}\b/.test(chunk));

  const rows: DietDetailRow[] = [];
  for (const chunk of chunks) {
    const dateMatch = chunk.match(/^(\d{2}\/\d{2}\/\d{4})\b/);
    const routeMatch = chunk.match(/\b(Internacional|Nacional)\b/i);
    const percentMatch = chunk.match(/\b(30|60|100)%\b/);
    const amounts = Array.from(chunk.matchAll(/([0-9]+(?:[.,][0-9]{1,2})?)\s*€/gi)).map((match) => parseMoney(match[1]) || 0);
    if (!dateMatch || !routeMatch || !percentMatch || amounts.length < 2) {
      continue;
    }

    rows.push({
      date: toIsoDate(dateMatch[1]) || dateMatch[1],
      routeLabel: routeMatch[1],
      dietPercent: Number(percentMatch[1]),
      dietAmount: amounts[0] ?? null,
      extraAmount: amounts.length >= 3 ? amounts[1] : null,
      plusAmount: amounts.length >= 4 ? amounts[2] : null,
      totalAmount: amounts[amounts.length - 1] ?? null,
      extraType: null,
    });
  }

  if (rows.length === 0) {
    throw new Error("No se han podido localizar filas del detalle por jornada");
  }

  return rows;
}

function extractExtraTypeHints(page1: string): Array<{ type: "DOMINGO" | "FESTIVO"; amount: number | null }> {
  const hints: Array<{ type: "DOMINGO" | "FESTIVO"; amount: number | null }> = [];
  const regex = /(Domingo|Festivo)\s*\+([0-9]+(?:[.,][0-9]{1,2})?)€/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(page1))) {
    hints.push({
      type: normalizeLabel(match[1]).includes("dom") ? "DOMINGO" : "FESTIVO",
      amount: parseMoney(match[2]),
    });
  }
  return hints;
}

export function parseDietSummary(page2: string): ParsedDietSummary {
  const summaryLines = getSectionLines(page2, "Resumen de Dietas");
  const totalDietas = parseMoney(findValueAfterLabel(summaryLines, "Dietas") || "") || 0;
  const totalExtras = parseMoney(findValueAfterLabel(summaryLines, "Extras dia") || "") || 0;
  const totalPlus = parseMoney(findValueAfterLabel(summaryLines, "Plus") || "") || 0;
  const totalOverall = parseMoney(findValueAfterLabel(summaryLines, "Total") || "") || 0;
  const { breakdown, extrasBreakdown, offsiteWeeklyCompleteInternationalAmount } = parseBreakdownSection(summaryLines);

  const detailLines = (() => {
    try {
      return getSectionLines(page2, "Detalle por jornada");
    } catch {
      return page2.split(/\r?\n/).map((line) => line.replace(/\u00a0/g, " "));
    }
  })();

  let detailRows: DietDetailRow[] = [];
  try {
    detailRows = parseDetailSectionByColumns(detailLines);
  } catch {
    try {
      detailRows = parseDetailSectionByRows(detailLines);
    } catch {
      try {
        detailRows = parseDetailSectionLoosely(detailLines);
      } catch {
        detailRows = [];
      }
    }
  }

  return {
    totalDietas,
    totalExtras,
    totalPlus,
    totalOverall,
    detailRows,
    breakdown,
    extrasBreakdown,
    offsiteWeeklyCompleteInternationalAmount,
  };
}

function buildDetailMap(page1: string, page2: string): Map<string, DietDetailRow[]> {
  const summary = parseDietSummary(page2);
  const rowsWithExtras = summary.detailRows.filter((row) => (row.extraAmount || 0) > 0);
  const hints = extractExtraTypeHints(page1);
  rowsWithExtras.forEach((row, index) => {
    const hint = hints[index];
    if (hint && (hint.amount == null || row.extraAmount == null || Math.abs(hint.amount - row.extraAmount) <= MONEY_TOLERANCE)) {
      row.extraType = hint.type;
      return;
    }
    const date = new Date(`${row.date}T12:00:00`);
    row.extraType = date.getDay() === 0 ? "DOMINGO" : "FESTIVO";
  });
  const detailMap = new Map<string, DietDetailRow[]>();
  for (const row of summary.detailRows) {
    const existing = detailMap.get(row.date) || [];
    existing.push(row);
    detailMap.set(row.date, existing);
  }
  return detailMap;
}

function takeDetailRow(detailMap: Map<string, DietDetailRow[]>, isoDate: string, routeText?: string): DietDetailRow | undefined {
  const queue = detailMap.get(isoDate);
  if (!queue || queue.length === 0) return undefined;

  if (routeText) {
    const routeIndex = queue.findIndex((row) => normalizeLabel(row.routeLabel) === normalizeLabel(routeText));
    if (routeIndex >= 0) {
      const [row] = queue.splice(routeIndex, 1);
      return row;
    }
  }

  return queue.shift();
}

function inferDietPercent(
  routeTipo: "NACIONAL" | "INTERNACIONAL",
  dietAmount: number | null,
  _extraAmount: number | null,
): number | null {
  if (routeTipo === "INTERNACIONAL") return 100;
  // La columna DIETA del informe ya contiene la dieta base. EXTRA y PLUS
  // son columnas independientes, por lo que nunca se restan aquí.
  const base = dietAmount != null ? Math.round(dietAmount * 100) / 100 : null;
  if (base == null) return null;
  if (Math.abs(base - 16.29) <= 0.02) return 30;
  if (Math.abs(base - 32.58) <= 0.02) return 60;
  if (Math.abs(base - 54.30) <= 0.02 || Math.abs(base - 72.77) <= 0.02) return 100;
  return null;
}

function parseLocations(text: string): [string, string] | null {
  const matches = extractLocationsFromText(text);
  if (matches.length >= 2) return [matches[0], matches[1]];
  return null;
}

function assertEconomicNoiseFreeLocation(label: "origen" | "destino", value: string): void {
  const normalized = normalizeLocationText(value);
  if (!normalized) throw new Error(`El ${label} está vacío`);
  if (/[€%]/.test(normalized) || /\b\d+h(?:\s*\d{1,2}m)?\b/i.test(normalized)) {
    throw new Error(`El ${label} contiene datos económicos o de duración`);
  }
}

function assertImportedJornadaDto(dto: ImportedJornadaDTO): void {
  assertEconomicNoiseFreeLocation("origen", dto.lugarInicio);
  assertEconomicNoiseFreeLocation("destino", dto.lugarFin);
  if (!Number.isFinite(dto.conduccionMin) || !Number.isFinite(dto.duracionJornadaMin)) {
    throw new Error("La conducción o la duración no son válidas");
  }
  const total = dto.dietaTotalEur ?? 0;
  const recomposed = Math.round(((dto.dietaBaseEur || 0) + (dto.dayExtraEur || 0) + (dto.plusEur || 0)) * 100) / 100;
  if (Math.abs(total - recomposed) > 0.02) {
    throw new Error("El total no coincide con base + extra + plus");
  }
}

export function mapImportedJornadaToJornada(dto: ImportedJornadaDTO): Jornada {
  assertImportedJornadaDto(dto);
  const now = new Date().toISOString();
  return {
    id: buildJornadaId(dto.fechaInicio, dto.horaInicio, dto.lugarInicio, dto.lugarFin),
    fechaInicio: dto.fechaInicio,
    horaInicio: dto.horaInicio,
    lugarInicio: dto.lugarInicio,
    fechaFin: dto.fechaFin,
    horaFin: dto.horaFin,
    lugarFin: dto.lugarFin,
    startAt: `${dto.fechaInicio}T${dto.horaInicio}:00`,
    endAt: `${dto.fechaFin}T${dto.horaFin}:00`,
    conduccionMin: dto.conduccionMin,
    conduccionDomingoMin: null,
    conduccionLunesMin: null,
    tipoRuta: dto.tipoRuta,
    pernocta: dto.dietaPercent != null ? dto.dietaPercent === 100 : null,
    dietaModo: "AUTO",
    dietaManualTipo: null,
    dietaManualPct: null,
    // Jornada mantiene por compatibilidad dietaImporteEur = base + extra del día.
    // El PLUS se guarda exclusivamente en plusItems para no cobrarlo dos veces.
    dietaImporteEur: formatAmount(
      Math.round(((dto.dietaBaseEur || 0) + (dto.dayExtraEur || 0)) * 100) / 100,
    ),
    dietasItems: dto.dietasItems,
    dietaPercent: dto.dietaPercent,
    dayFlag: dto.dayFlag,
    dayExtraEur: formatAmount(dto.dayExtraEur),
    dietBaseEur: formatAmount(dto.dietaBaseEur),
    dietRule: dto.dietRule,
    dietCalculatedAt: now,
    descansoAnteriorMin: null,
    tipoDescansoAnterior: null,
    previousRestSource: null,
    previousRestId: null,
    previousRestValid: null,
    duracionJornadaMin: dto.duracionJornadaMin,
    countsAsDailyReduced: false,
    plannedRestMin: null,
    plannedRestType: null,
    splitRestDetected: false,
    splitRestFirstPartMin: null,
    splitRestSecondPartMin: null,
    countsAsReducedRest: false,
    paymentMode: "dietas",
    kmInicio: null,
    kmFin: null,
    kmTotal: null,
    pricePerKm: null,
    importeKm: null,
    pricePerTrip: null,
    importeViaje: null,
    reportHideAmounts: false,
    reportHidePluses: false,
    plusItems: dto.plusEur != null && dto.plusEur > MONEY_TOLERANCE ? [{ concepto: "PLUS", importe: dto.plusEur }] : null,
    observaciones: dto.observaciones,
    moroccoPaymentMode: null,
    moroccoTripRate: null,
    moroccoPernightRate: null,
    ferryPending: false,
    ferryDestination: null,
    ferryExtras: null,
    ferryInterruptions: null,
    ferryRestCompleted: false,
    ferryRestType: null,
    isDoubleDriving: false,
    secondDriverName: null,
    legalSummary: null,
    updatedAt: now,
    syncStatus: "pending",
  };
}

function parseTopSection(page1: string, detailMap: Map<string, DietDetailRow[]>): { jornadas: Jornada[]; issues: string[]; candidateCount: number } {
  const issues: string[] = [];
  try {
    const normalizedPage = page1.replace(/\u00a0/g, " ");
    const obsMatch = findMarkerMatch(normalizedPage, ["OBS."]);
    const inicioMatch = findMarkerMatch(normalizedPage, ["INICIO"]);
    const finMatch = findMarkerMatch(normalizedPage, ["FIN"], (inicioMatch?.index || 0) + (inicioMatch?.length || 0));
    const origenMatch = findMarkerMatch(normalizedPage, ["ORIGEN"], (finMatch?.index || 0) + (finMatch?.length || 0));
    const destinoMatch = findMarkerMatch(normalizedPage, ["DESTINO"], (origenMatch?.index || 0) + (origenMatch?.length || 0));
    const duracionHeaderMatch = findMarkerMatch(normalizedPage, ["DURACION"], (destinoMatch?.index || 0) + (destinoMatch?.length || 0));
    const dietaHeaderMatch = findMarkerMatch(normalizedPage, ["DIETA"], (duracionHeaderMatch?.index || 0) + (duracionHeaderMatch?.length || 0));
    const extraPlusMatch = findMarkerMatch(normalizedPage, ["EXTRA PLUS"], (dietaHeaderMatch?.index || 0) + (dietaHeaderMatch?.length || 0));

    if (!inicioMatch || !finMatch || !origenMatch || !destinoMatch || !duracionHeaderMatch || !dietaHeaderMatch || !extraPlusMatch || !obsMatch) {
      throw new Error("No se han podido localizar todas las secciones principales del historial");
    }

    const starts = extractDateTimesFromText(normalizedPage.slice(inicioMatch.index + inicioMatch.length, finMatch.index));
    const ends = extractDateTimesFromText(normalizedPage.slice(finMatch.index + finMatch.length, origenMatch.index));
    const origins = extractLocationsFromText(normalizedPage.slice(origenMatch.index + origenMatch.length, destinoMatch.index));
    const destinations = extractLocationsFromText(normalizedPage.slice(destinoMatch.index + destinoMatch.length, duracionHeaderMatch.index));
    const durations = extractDurationsFromText(normalizedPage.slice(duracionHeaderMatch.index + duracionHeaderMatch.length, dietaHeaderMatch.index));
    const routeDrivingText = normalizedPage.slice(extraPlusMatch.index + extraPlusMatch.length, obsMatch.index);
    const routes = extractRoutesFromText(routeDrivingText);
    const driving = extractDurationsFromText(routeDrivingText);

    const observationTail = sliceBetweenMarkersAfter(normalizedPage, obsMatch.index, ["OBS."], ["TOTALES", "Generado por Tacoplan", "about:blank", "TACOPLAN_DATA:"]);
    const observationLines = observationTail
      .split(/\r?\n/)
      .map((line) => line.replace(/\u00a0/g, " "))
      .map((line) => normalizeSpaces(line))
      .filter(Boolean);
    const firstLowerAnchor = observationLines.findIndex((line) => line === "🛌" || /^\d{2}\/\d{2}\/\d{4}\b/.test(line));
    const topObservationLines = (firstLowerAnchor >= 0 ? observationLines.slice(0, firstLowerAnchor) : observationLines)
      .filter((line) => !normalizeLabel(line).startsWith("totales"));
    const observations = topObservationLines.slice(0, Math.max(starts.length, ends.length, origins.length, destinations.length, durations.length, routes.length, driving.length));

    const rowCount = Math.max(starts.length, ends.length, origins.length, destinations.length, durations.length, routes.length, driving.length);
    const jornadas: Jornada[] = [];

    for (let index = 0; index < rowCount; index++) {
      const start = getArrayValue(starts, index);
      if (!start) {
        issues.push(`Fila superior ${index + 1}: falta fecha y hora de inicio`);
        continue;
      }

      const startDate = start.slice(0, 10);
      const startTime = start.slice(11, 16);
      const end = getArrayValue(ends, index);
      const origin = getArrayValue(origins, index);
      const destination = getArrayValue(destinations, index);
      const route = getArrayValue(routes, index);
      const drivingText = getArrayValue(driving, index);
      const durationText = getArrayValue(durations, index);
      const detail = takeDetailRow(detailMap, toIsoDate(startDate) || "", route);
      const missing: string[] = [];

      if (!end) missing.push("fin");
      if (!origin) missing.push("origen");
      if (!destination) missing.push("destino");
      if (!route) missing.push("ruta");
      if (!drivingText) missing.push("conducción");
      if (!durationText) missing.push("duración");

      try {
        jornadas.push(parseJornadaRow({
          startDate,
          startTime,
          endDate: end?.slice(0, 10),
          endTime: end?.slice(11, 16),
          locationText: [origin, destination].filter(Boolean).join(" "),
          routeText: route,
          drivingText,
          durationText,
          observationText: cleanObservation(getArrayValue(observations, index) || null),
          detail,
        }));
        if (missing.length > 0) {
          issues.push(`Fila superior ${index + 1} (${startDate} ${startTime}): campos dudosos ${missing.join(", ")}`);
        }
      } catch (error: any) {
        issues.push(`Fila superior ${index + 1} (${startDate} ${startTime}): ${error?.message || "no se pudo reconstruir"}`);
      }
    }

    return { jornadas, issues, candidateCount: rowCount };
  } catch (error: any) {
    issues.push(error?.message || "No se ha podido reconstruir el bloque superior");
    return { jornadas: [], issues, candidateCount: 0 };
  }
}

function extractLowerBlocks(page1: string): string[] {
  const normalizedPage = page1.replace(/\u00a0/g, " ");
  const obsMatch = findMarkerMatch(normalizedPage, ["OBS."]);
  if (!obsMatch) return [];

  const tail = normalizedPage.slice(obsMatch.index + obsMatch.length);
  const endMatch = findMarkerMatch(tail, ["TOTALES", "Generado por Tacoplan", "about:blank", "TACOPLAN_DATA:"]);
  const chunk = (endMatch ? tail.slice(0, endMatch.index) : tail).trim();
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " "))
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);
  const firstLowerIndex = lines.findIndex((line) => line === "🛌" || /^\d{2}\/\d{2}\/\d{4}\b/.test(line));
  if (firstLowerIndex === -1) return [];

  const lowerLines = lines.slice(firstLowerIndex);
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lowerLines) {
    const startsBlock = line === "🛌" || /^\d{2}\/\d{2}\/\d{4}\b/.test(line);
    const shouldKeepSpecialTogether = current[0] === "🛌" && current.length === 1 && /^\d{2}\/\d{2}\/\d{4}\b/.test(line);
    if (startsBlock && current.length > 0 && !shouldKeepSpecialTogether) {
      blocks.push(current.join("\n").trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n").trim());
  return blocks;
}

function buildImportedJornadaDto(params: {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  locationText?: string;
  routeText?: string;
  drivingText?: string;
  durationText?: string;
  observationText?: string | null;
  blockText?: string;
  detail?: DietDetailRow | undefined;
}): ImportedJornadaDTO {
  let {
    startDate,
    startTime,
    endDate,
    endTime,
    locationText,
    routeText,
    drivingText,
    durationText,
    observationText,
    blockText,
    detail,
  } = params;

  if (blockText) {
    const blockLines = blockText
      .split(/\r?\n/)
      .map((line) => normalizeSpaces(line))
      .filter(Boolean);
    const compact = normalizeSpaces(blockText.replace(/\n/g, " "));
    const dates = compact.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
    const times = compact.match(/\d{2}:\d{2}/g) || [];
    const durations = compact.match(/\d+h(?:\s\d{1,2}m)?/gi) || [];
    startDate = startDate || dates[0];
    endDate = endDate || dates[1];
    startTime = startTime || times[0];
    endTime = endTime || times[1];
    routeText = routeText || (compact.includes("Internacional") ? "Internacional" : compact.includes("Nacional") ? "Nacional" : "");
    drivingText = drivingText || durations[0];
    durationText = durationText || durations[1];

    const firstLine = blockLines[0] || "";
    const lastLine = blockLines[blockLines.length - 1] || "";
    const middleLines = blockLines.slice(1, -1);
    const firstResidual = normalizeSpaces(firstLine.replace(/\d{2}\/\d{2}\/\d{4}/g, " "));
    const lastResidual = normalizeSpaces(lastLine.replace(/\d{2}:\d{2}/g, " "));
    let locationSource = [firstResidual, ...middleLines, lastResidual].filter(Boolean).join(" ");
    [startDate, endDate, startTime, endTime, drivingText, durationText]
      .filter(Boolean)
      .forEach((value) => {
        locationSource = locationSource.replace(String(value), " ");
      });
    if (routeText) {
      locationSource = locationSource.replace(routeText, " ");
    }
    locationSource = locationSource
      .replace(/Domingo\s*\+[0-9.,]+€/gi, " ")
      .replace(/Festivo\s*\+[0-9.,]+€/gi, " ")
      .replace(/Descanso fuera de base sin jornada.*$/i, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/República/gi, "República")
      .replace(/España/gi, "España");
    let normalizedLocationSource = normalizeLocationText(locationSource.replace(/República\s+Checa/gi, "República Checa"));
    let locations = parseLocations(normalizedLocationSource);
    if (!locations && firstResidual && lastResidual) {
      const mergedBoundary = normalizeLocationText(`${firstResidual} ${lastResidual}`);
      const middleResidual = normalizeLocationText(
        middleLines
          .join(" ")
          .replace(routeText || "", " ")
          .replace(/\d+h(?:\s\d{1,2}m)?/gi, " ")
          .replace(/[0-9]+(?:[.,][0-9]{1,2})?\s*€/gi, " ")
          .replace(/Domingo|Festivo|\+/gi, " "),
      );
      normalizedLocationSource = normalizeLocationText(`${mergedBoundary} ${middleResidual}`);
      locations = parseLocations(normalizedLocationSource);
    }
    if (locations) {
      locationText = `${locations[0]} ${locations[1]}`;
    }
  }

  const startIso = toIsoDate(startDate || "") || "1970-01-01";
  const endIso = toIsoDate(endDate || "") || startIso;
  const rawLocationFragments = splitLocationFragments(locationText || "");
  const normalizedLocationText = normalizeLocationText(locationText || "");
  const locations = parseLocations(normalizedLocationText);
  if (!locations) throw new Error(`No se han podido detectar origen y destino para ${startDate || "fila"}`);

  const routeLabel = routeText || detail?.routeLabel || "Internacional";
  const routeTipo = routeLabelToTipoRuta(routeLabel);
  if (routeTipo !== "INTERNACIONAL" && routeTipo !== "NACIONAL") {
    throw new Error("El tipo de ruta importado no es válido");
  }
  const extraType = detail?.extraType || null;
  // En los informes actuales las columnas económicas son independientes:
  // DIETA = base, EXTRA = domingo/festivo, PLUS = pluses y TOTAL = suma de las tres.
  const baseAmount = detail?.dietAmount != null
    ? Math.round(detail.dietAmount * 100) / 100
    : null;
  const extraAmount = detail?.extraAmount != null && detail.extraAmount > MONEY_TOLERANCE ? detail.extraAmount : null;
  const plusAmount = detail?.plusAmount != null && detail.plusAmount > MONEY_TOLERANCE ? detail.plusAmount : null;
  const visibleTotalAmount = detail?.totalAmount != null
    ? Math.round(detail.totalAmount * 100) / 100
    : baseAmount != null
      ? Math.round((baseAmount + (extraAmount || 0) + (plusAmount || 0)) * 100) / 100
      : null;
  const resolvedDietPercent = detail?.dietPercent ?? inferDietPercent(routeTipo, baseAmount, extraAmount);
  const dietItemType = routeTipo === "INTERNACIONAL" ? "INTERNACIONAL" : routeTipo === "NACIONAL" ? "NACIONAL" : null;
  const dietasItems = baseAmount != null && resolvedDietPercent != null && dietItemType
    ? [{ tipo: dietItemType, pct: String(resolvedDietPercent), importe: baseAmount }]
    : null;
  const ruleParts = resolvedDietPercent != null ? [`${routeTipo} ${resolvedDietPercent}%`] : [];
  if (extraType) ruleParts.push(`+ ${extraType}`);
  const dto: ImportedJornadaDTO = {
    fechaInicio: startIso,
    horaInicio: startTime || "00:00",
    fechaFin: endIso,
    horaFin: endTime || "00:00",
    lugarInicio: normalizeLocationText(locations[0]),
    lugarFin: normalizeLocationText(locations[1]),
    tipoRuta: routeTipo,
    conduccionMin: parseMinutes(drivingText || "") ?? 0,
    duracionJornadaMin: parseMinutes(durationText || "") ?? 0,
    dietaTotalEur: visibleTotalAmount,
    dietaBaseEur: baseAmount,
    dietaPercent: resolvedDietPercent,
    dayFlag: extraType,
    dayExtraEur: extraAmount,
    plusEur: plusAmount,
    observaciones: cleanObservation(observationText),
    dietRule: ruleParts.length > 0 ? ruleParts.join(" ") : null,
    dietasItems,
    rawLugarInicio: rawLocationFragments[0]?.raw || null,
    rawLugarFin: rawLocationFragments[1]?.raw || null,
  };

  console.log("[pdf-import-debug][parsed-dto]", {
    fecha: dto.fechaInicio,
    lugarInicioOriginal: dto.rawLugarInicio,
    lugarInicioNormalizado: dto.lugarInicio,
    lugarFinOriginal: dto.rawLugarFin,
    lugarFinNormalizado: dto.lugarFin,
    dietaExtraida: baseAmount,
    dietaBase: baseAmount,
    porcentaje: dto.dietaPercent,
    extra: extraAmount,
    total: visibleTotalAmount,
    detalleTotalPagina2: detail?.totalAmount ?? null,
    dto,
  });

  return dto;
}

export function parseJornadaRow(params: {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  locationText?: string;
  routeText?: string;
  drivingText?: string;
  durationText?: string;
  observationText?: string | null;
  blockText?: string;
  detail?: DietDetailRow | undefined;
}): Jornada {
  const dto = buildImportedJornadaDto(params);
  const jornada = mapImportedJornadaToJornada(dto);
  console.log("[pdf-import-debug][parsed-row]", {
    fecha: jornada.fechaInicio,
    lugarInicioOriginal: dto.rawLugarInicio,
    lugarInicioNormalizado: jornada.lugarInicio,
    lugarFinOriginal: dto.rawLugarFin,
    lugarFinNormalizado: jornada.lugarFin,
    dietaBase: jornada.dietBaseEur,
    porcentaje: jornada.dietaPercent,
    extra: jornada.dayExtraEur,
    plus: jornada.plusItems,
    total: jornada.dietaImporteEur,
    objetoFinal: jornada,
  });
  return jornada;
}

function parseLowerSection(page1: string, detailMap: Map<string, DietDetailRow[]>): { jornadas: Jornada[]; issues: string[] } {
  const jornadas: Jornada[] = [];
  const issues: string[] = [];

  extractLowerBlocks(page1)
    .filter((block) => !block.startsWith("🛌") && !/Descanso fuera de base sin jornada/i.test(block))
    .forEach((block, index) => {
      const dateMatch = block.match(/(\d{2}\/\d{2}\/\d{4})/);
      const routeMatch = block.match(/\b(Internacional|Nacional)\b/i);
      const detail = dateMatch ? takeDetailRow(detailMap, toIsoDate(dateMatch[1]) || "", routeMatch?.[1]) : undefined;
      try {
        jornadas.push(parseJornadaRow({ blockText: block, detail }));
      } catch (error: any) {
        issues.push(`Fila inferior ${index + 1}${dateMatch ? ` (${dateMatch[1]})` : ""}: ${error?.message || "no se pudo reconstruir"}`);
      }
    });

  return { jornadas, issues };
}

function buildDiagnostics(
  pdfText: string,
  jornadas: Jornada[],
  dayExtraEntries: DayExtraEntry[],
  topIssues: string[],
  lowerIssues: string[],
  candidateRows: number,
): TacoplanReportParseResult["diagnostics"] {
  const rejectedRows = [...topIssues, ...lowerIssues].map((issue, index) => ({
    label: `fila_${index + 1}`,
    reason: issue,
  }));
  return {
    pageCount: pdfText.includes(PAGE_BREAK) ? pdfText.split(PAGE_BREAK).filter(Boolean).length : 1,
    textLength: pdfText.length,
    sections: {
      historial: pdfText.includes("Historial de Jornadas"),
      resumen: pdfText.includes("Resumen de Dietas"),
      detalle: pdfText.includes("Detalle por jornada"),
      marker: pdfText.includes("TACOPLAN_DATA:"),
    },
    dateCount: (pdfText.match(/\d{2}\/\d{2}\/\d{4}/g) || []).length,
    timeCount: (pdfText.match(/\d{2}:\d{2}/g) || []).length,
    routeCount: (pdfText.match(/\b(?:Internacional|Nacional)\b/gi) || []).length,
    amountCount: (pdfText.match(/[0-9]+(?:[.,][0-9]{1,2})?\s*€/gi) || []).length,
    candidateRows,
    parsedRows: jornadas.length + dayExtraEntries.length,
    rejectedRows,
    firstParsedBlock: jornadas[0]
      ? `${jornadas[0].fechaInicio} ${jornadas[0].horaInicio} ${jornadas[0].lugarInicio} -> ${jornadas[0].lugarFin}`
      : null,
    lastParsedBlock: jornadas.length > 0
      ? `${jornadas[jornadas.length - 1].fechaInicio} ${jornadas[jornadas.length - 1].horaInicio} ${jornadas[jornadas.length - 1].lugarInicio} -> ${jornadas[jornadas.length - 1].lugarFin}`
      : null,
    textPreview: pdfText.slice(0, 1000),
  };
}

function parseSpecialEntries(page1: string, summary: ParsedDietSummary): DayExtraEntry[] {
  const blockMatch = page1.match(/🛌\s*[\r\n]+(\d{2}\/\d{2}\/\d{4})[\s\S]*?Descanso fuera de base sin jornada\s*\(([^)]+)\)/);
  if (!blockMatch) return [];
  const date = toIsoDate(blockMatch[1]) || "1970-01-01";
  const detail = blockMatch[2];
  const now = new Date().toISOString();
  return [{
    id: `pdf_offsite_${date}`,
    date,
    entryType: "offsite_weekly_rest",
    dayFlag: null,
    offsiteRestType: normalizeLabel(detail).includes("completo") ? "WEEKLY_COMPLETE" : "WEEKLY_REDUCED",
    offsiteBase: normalizeLabel(detail).includes("intern") ? "INTERNACIONAL" : "NACIONAL",
    plusSunday: false,
    plusHoliday: false,
    amount: summary.offsiteWeeklyCompleteInternationalAmount,
    note: "Descanso fuera de base sin jornada",
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  }];
}

function parseHeaderTotals(page1: string): { jornadas: number; specials: number; drivingMin: number; durationMin: number } {
  const match = page1.match(/(\d+)\s+jornadas\s+\+\s+(\d+)\s+extra\s+\|\s+Conduccion total:\s*([0-9h m]+)\s+\|\s+Duracion total:\s*([0-9h m]+)/i);
  if (!match) throw new Error("No se ha encontrado el resumen del historial");
  return {
    jornadas: Number(match[1]),
    specials: Number(match[2]),
    drivingMin: parseMinutes(match[3]) || 0,
    durationMin: parseMinutes(match[4]) || 0,
  };
}

export function validateImportedReport(result: TacoplanReportParseResult): string[] {
  const [page1HeaderCount, page1SpecialCount] = [result.jornadas.length, result.dayExtraEntries.length];
  const errors: string[] = [...result.errors];
  if (page1HeaderCount !== result.jornadas.length) {
    errors.push("El numero de jornadas del informe no coincide");
  }
  if (page1SpecialCount !== result.dayExtraEntries.length) {
    errors.push("El numero de registros especiales del informe no coincide");
  }
  return errors;
}

export function parseTacoplanReport(pdfText: string): TacoplanReportParseResult {
  const normalizedText = normalizeMirroredPdfText(pdfText);
  const [page1, page2] = splitPages(normalizedText);
  const range = parseRange(page1);
  const headerTotals = parseHeaderTotals(page1);
  const summary = parseDietSummary(page2);
  const detailMap = buildDetailMap(page1, page2);
  const topSection = parseTopSection(page1, detailMap);
  const lowerBlocks = extractLowerBlocks(page1);
  const lowerSection = parseLowerSection(page1, detailMap);
  const jornadas = [...topSection.jornadas, ...lowerSection.jornadas]
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const dayExtraEntries = parseSpecialEntries(page1, summary);

  const computedDrivingMin = jornadas.reduce((sum, row) => sum + (row.conduccionMin || 0), 0);
  const computedDurationMin = jornadas.reduce((sum, row) => sum + (row.duracionJornadaMin || 0), 0);
  const computedDietas = Math.round(
    jornadas.reduce((sum, row) => {
      const full = Number(row.dietaImporteEur || 0);
      const extra = Number(row.dayExtraEur || 0);
      return sum + Math.max(0, full - extra);
    }, 0) * 100,
  ) / 100;
  const computedExtras = Math.round(jornadas.reduce((sum, row) => sum + Number(row.dayExtraEur || 0), 0) * 100) / 100;
  const effectiveDietas = computedDietas > 0 ? computedDietas : summary.totalDietas;
  const effectiveExtras = computedExtras > 0 ? computedExtras : summary.totalExtras;

  const errors: string[] = [...topSection.issues, ...lowerSection.issues];
  if (jornadas.length !== headerTotals.jornadas) {
    errors.push(`Se esperaban ${headerTotals.jornadas} jornadas visibles y se han reconstruido ${jornadas.length}`);
  }
  if (dayExtraEntries.length !== headerTotals.specials) {
    errors.push(`Se esperaban ${headerTotals.specials} registros especiales y se han reconstruido ${dayExtraEntries.length}`);
  }
  if (computedDrivingMin !== headerTotals.drivingMin) {
    errors.push(`La conducción total visible no coincide (${computedDrivingMin} vs ${headerTotals.drivingMin})`);
  }
  if (computedDurationMin !== headerTotals.durationMin) {
    errors.push(`La duración total visible no coincide (${computedDurationMin} vs ${headerTotals.durationMin})`);
  }
  if (computedDietas > 0 && Math.abs(computedDietas - summary.totalDietas) > MONEY_TOLERANCE) {
    errors.push(`Las dietas visibles no coinciden (${computedDietas} vs ${summary.totalDietas})`);
  }
  if (computedExtras > 0 && Math.abs(computedExtras - summary.totalExtras) > MONEY_TOLERANCE) {
    errors.push(`Los extras visibles no coinciden (${computedExtras} vs ${summary.totalExtras})`);
  }
  if (summary.detailRows.length === 0) {
    errors.push("No se ha podido reconstruir el detalle por jornada con precision completa. Se usan los totales visibles del resumen.");
  }

  return {
    range: { from: range.from, to: range.to },
    generatedAt: range.generatedAt,
    jornadas,
    dayExtraEntries,
    totalDrivingMin: computedDrivingMin,
    totalDurationMin: computedDurationMin,
    totalDietas: effectiveDietas,
    totalExtras: effectiveExtras,
    totalPlus: summary.totalPlus,
    totalOverall: summary.totalOverall,
    errors,
    diagnostics: buildDiagnostics(normalizedText, jornadas, dayExtraEntries, topSection.issues, lowerSection.issues, topSection.candidateCount + lowerBlocks.length),
  };
}
