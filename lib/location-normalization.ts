const KNOWN_COUNTRIES = [
  "República Checa",
  "República Checa",
  "Francia",
  "España",
  "España",
  "Alemania",
  "Polonia",
  "Chequia",
] as const;

const SORTED_COUNTRIES = [...KNOWN_COUNTRIES].sort((a, b) => b.length - a.length);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLocationFragment(value: string): string {
  return String(value || "")
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, " ")
    .replace(/\b\d{2}:\d{2}\b/g, " ")
    .replace(/\b(?:Internacional|Nacional)\b/gi, " ")
    .replace(/\b\d+h(?:\s*\d{1,2}m)?\b/gi, " ")
    .replace(/[0-9]+(?:[.,][0-9]{1,2})?\s*€/gi, " ")
    .replace(/\b(?:Domingo|Festivo)\b/gi, " ")
    .replace(/[+%]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\s-]+/, "")
    .replace(/[,.;:\s-]+$/, "")
    .trim();
}

export function normalizeLocationText(value: string): string {
  let normalized = cleanLocationFragment(String(value || ""))
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  normalized = normalized
    .replace(/\s+([.,])/g, "$1")
    .replace(/([.,])(?=\S)/g, "$1 ");

  for (const country of SORTED_COUNTRIES) {
    const pattern = new RegExp(`([\\p{L}\\p{M}0-9'’\\-])(?:\\s*[.,]?\\s*)(${escapeRegex(country)})\\b`, "gu");
    normalized = normalized.replace(pattern, "$1, $2");
  }

  return normalized
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitNormalizedLocations(value: string): string[] {
  return splitLocationFragments(value).map((item) => item.normalized);
}

export function splitLocationFragments(value: string): Array<{ raw: string; normalized: string }> {
  const compact = String(value || "")
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return [];

  const countryRegex = new RegExp(SORTED_COUNTRIES.map((country) => escapeRegex(country)).join("|"), "gu");
  const locations: Array<{ raw: string; normalized: string }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = countryRegex.exec(compact))) {
    const end = match.index + match[0].length;
    const raw = cleanLocationFragment(compact
        .slice(cursor, end)
        .replace(/^[,.;\s-]+/, "")
        .replace(/[,.;\s-]+$/, ""));
    const normalized = normalizeLocationText(raw);
    if (normalized) {
      locations.push({ raw: raw.trim(), normalized });
    }
    cursor = end;
  }

  return locations;
}
