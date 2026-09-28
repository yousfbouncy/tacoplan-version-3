import type { DayExtraEntry, Jornada } from "@/lib/local-storage";

export async function extractPdfText(_bytes: Uint8Array): Promise<string | null> {
  return null;
}

export async function parseLegacyTacoplanPdf(_bytes: Uint8Array): Promise<{ jornadas: Jornada[]; dayExtraEntries: DayExtraEntry[] } | null> {
  return null;
}
