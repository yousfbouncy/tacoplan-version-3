import { parseTacoplanReport } from "@/lib/tacoplan-report-parser";
import type { DayExtraEntry, Jornada } from "@/lib/local-storage";

let pdfJsModuleLoading: Promise<any> | null = null;

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
};

type PdfJsBundle = {
  pdfjs: any;
  worker: any;
};

async function importPdfJsModule(): Promise<PdfJsBundle> {
  const candidates = [
    async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist/build/pdf.mjs"),
        import("pdfjs-dist/build/pdf.worker.mjs"),
      ]);
      return { pdfjs: pdfjs?.default ?? pdfjs, worker: worker?.default ?? worker };
    },
    async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);
      return { pdfjs: pdfjs?.default ?? pdfjs, worker: worker?.default ?? worker };
    },
  ];

  let lastError: unknown = null;
  for (const load of candidates) {
    try {
      const mod: any = await load();
      return mod?.default ?? mod;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("pdf_module_load_failed");
}

async function loadPdfJs(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("PDF no disponible en este entorno");
  }
  if (!pdfJsModuleLoading) {
    pdfJsModuleLoading = importPdfJsModule()
      .then(({ pdfjs, worker }) => {
        if (worker?.WorkerMessageHandler) {
          (globalThis as any).pdfjsWorker = worker;
        }
        return pdfjs;
      })
      .catch(() => {
        throw new Error("No se pudo cargar el lector PDF integrado");
      });
  }
  return pdfJsModuleLoading;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string | null> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableWorker: true, disableStream: true, disableAutoFetch: true }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: TextItem[] = (content.items || [])
      .map((item: any) => ({
        str: String(item?.str || ""),
        x: Number(item?.transform?.[4] || 0),
        y: Number(item?.transform?.[5] || 0),
        width: Number(item?.width || 0),
      }))
      .filter((item: TextItem) => item.str.trim().length > 0);

    const sorted = items.sort((a, b) => {
      const deltaY = b.y - a.y;
      if (Math.abs(deltaY) > 2) return deltaY;
      return a.x - b.x;
    });

    const lines: Array<{ y: number; items: TextItem[] }> = [];
    for (const item of sorted) {
      const currentLine = lines[lines.length - 1];
      if (!currentLine || Math.abs(currentLine.y - item.y) > 2) {
        lines.push({ y: item.y, items: [item] });
        continue;
      }
      currentLine.items.push(item);
    }

    const text = lines.map((line) => {
      const parts = line.items.sort((a, b) => a.x - b.x);
      let assembled = "";
      let previous: TextItem | null = null;
      for (const part of parts) {
        const raw = part.str;
        const value = raw.trim();
        if (!value) continue;
        if (!previous) {
          assembled = value;
          previous = part;
          continue;
        }

        const previousEnd = previous.x + previous.width;
        const gap = part.x - previousEnd;
        const shouldAddSpace = gap > 1.5 && !assembled.endsWith("-") && !/^[,.;:!?)]/.test(value);
        assembled += shouldAddSpace ? ` ${value}` : value;
        previous = part;
      }
      return assembled;
    }).join("\n");

    pages.push(text);
  }

  const text = pages.join(`\n${"<<<TACOPLAN_PAGE_BREAK>>>"}\n`);
  fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"pdf-incomplete-import",runId:"pre",hypothesisId:"B",location:"lib/pdf-extractor.web.ts:121",msg:"[DEBUG] Texto PDF extraido en web",data:{pageCount:pages.length,textLength:text.length,hasPageBreak:text.includes("<<<TACOPLAN_PAGE_BREAK>>>"),hasHistorial:text.includes("Historial de Jornadas"),hasResumen:text.includes("Resumen de Dietas"),hasDetalle:text.includes("Detalle por jornada"),hasMarker:text.includes("TACOPLAN_DATA:")},ts:Date.now()})}).catch(()=>{});
  return text;
}

export async function parseLegacyTacoplanPdf(bytes: Uint8Array): Promise<{ jornadas: Jornada[]; dayExtraEntries: DayExtraEntry[] } | null> {
  const text = await extractPdfText(bytes);
  if (!text) return null;
  try {
    const parsed = parseTacoplanReport(text);
    fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"pdf-incomplete-import",runId:"pre",hypothesisId:"A",location:"lib/pdf-extractor.web.ts:131",msg:"[DEBUG] Resultado parser visible en web",data:{jornadas:parsed.jornadas.length,specials:parsed.dayExtraEntries.length,errors:parsed.errors,totalDrivingMin:parsed.totalDrivingMin,totalDurationMin:parsed.totalDurationMin,totalDietas:parsed.totalDietas,totalExtras:parsed.totalExtras},ts:Date.now()})}).catch(()=>{});
    if (parsed.jornadas.length === 0 && parsed.dayExtraEntries.length === 0) return null;
    return {
      jornadas: parsed.jornadas,
      dayExtraEntries: parsed.dayExtraEntries,
    };
  } catch (error: any) {
    fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"pdf-incomplete-import",runId:"pre",hypothesisId:"D",location:"lib/pdf-extractor.web.ts:140",msg:"[DEBUG] Excepcion parser visible en web",data:{message:error?.message||"unknown",stack:String(error?.stack||"").slice(0,1200)},ts:Date.now()})}).catch(()=>{});
    return null;
  }
}
