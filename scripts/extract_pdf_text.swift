import Foundation
import PDFKit

let args = CommandLine.arguments.dropFirst()
guard let path = args.first else {
  fputs("Usage: swift scripts/extract_pdf_text.swift <pdf-path>\n", stderr)
  exit(1)
}

let url = URL(fileURLWithPath: path)
guard let doc = PDFDocument(url: url) else {
  fputs("Could not open PDF: \(path)\n", stderr)
  exit(1)
}

var pages: [String] = []
for index in 0..<doc.pageCount {
  pages.append(doc.page(at: index)?.string ?? "")
}

let joined = pages.joined(separator: "\n<<<TACOPLAN_PAGE_BREAK>>>\n")
print(joined)
