import ImportScreenContent from "@/components/import/ImportScreenContent";
import { extractPdfText, parseLegacyTacoplanPdf } from "@/lib/pdf-extractor";

export default function ImportarScreen() {
  return (
    <ImportScreenContent
      extractPdfText={extractPdfText}
      legacyPdfFallback={parseLegacyTacoplanPdf}
    />
  );
}
