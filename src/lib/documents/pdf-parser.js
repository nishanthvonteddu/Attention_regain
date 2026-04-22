import { PDFParse } from "pdf-parse";

export const PDF_PARSE_STATUSES = Object.freeze({
  PARSED: "parsed",
  OCR_NEEDED: "ocr_needed",
  PARSE_FAILED: "parse_failed",
});

export const PDF_PARSE_CODES = Object.freeze({
  READABLE_TEXT: "readable_text",
  EMPTY_TEXT: "empty_text",
  LOW_TEXT_SIGNAL: "low_text_signal",
  SCANNED_OR_IMAGE_HEAVY: "scanned_or_image_heavy",
  PARSER_ERROR: "parser_error",
});

const MIN_READABLE_WORDS = 18;
const MIN_READABLE_CHARS = 120;
const MIN_AVERAGE_PAGE_CHARS = 45;
const MAX_EXTRACTED_CHARS = 80_000;

export async function extractPdfFile(file, { title = "" } = {}) {
  const resolvedTitle = title || inferTitleFromFile(file);
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const pages = normalizePdfPages(result.pages);
    const text = normalizeExtractedText(
      pages.length ? pages.map((page) => page.text).join("\n\n") : result.text,
    );
    const diagnostics = assessPdfParseSignal({
      text,
      pages,
      pageCount: Number.isSafeInteger(result.total) ? result.total : pages.length,
    });

    if (diagnostics.status !== PDF_PARSE_STATUSES.PARSED) {
      return {
        ok: false,
        status: diagnostics.status,
        code: diagnostics.code,
        error: buildParseFailureMessage(diagnostics),
        title: resolvedTitle,
        text,
        pages,
        diagnostics,
        sourceKind: "pdf",
      };
    }

    return {
      ok: true,
      status: PDF_PARSE_STATUSES.PARSED,
      code: PDF_PARSE_CODES.READABLE_TEXT,
      title: resolvedTitle,
      text,
      pages,
      diagnostics,
      sourceKind: "pdf",
    };
  } catch (error) {
    const diagnostics = buildParserErrorDiagnostics(error);
    return {
      ok: false,
      status: PDF_PARSE_STATUSES.PARSE_FAILED,
      code: PDF_PARSE_CODES.PARSER_ERROR,
      error: buildParseFailureMessage(diagnostics),
      title: resolvedTitle,
      text: "",
      pages: [],
      diagnostics,
      sourceKind: "pdf",
    };
  } finally {
    await parser.destroy();
  }
}

export function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

export function assessPdfParseSignal({ text = "", pages = [], pageCount = 0 } = {}) {
  const normalizedText = normalizeExtractedText(text);
  const normalizedPages = normalizePdfPages(pages);
  const wordCount = countWords(normalizedText);
  const characterCount = normalizedText.length;
  const detectedPageCount = Math.max(
    Number.isSafeInteger(pageCount) ? pageCount : 0,
    normalizedPages.length,
  );
  const pagesWithText = normalizedPages.filter((page) => countWords(page.text) > 0).length;
  const averagePageChars = detectedPageCount
    ? Math.round(characterCount / detectedPageCount)
    : characterCount;
  const warnings = [];

  if (!characterCount || !wordCount) {
    warnings.push("The parser returned no readable text.");
    return {
      parser: "pdf-parse",
      status: PDF_PARSE_STATUSES.OCR_NEEDED,
      code: detectedPageCount ? PDF_PARSE_CODES.SCANNED_OR_IMAGE_HEAVY : PDF_PARSE_CODES.EMPTY_TEXT,
      reason: detectedPageCount
        ? "The PDF has pages but no extractable text, which usually means scanned or image-heavy content."
        : "The PDF parser returned no text and no page records.",
      pageCount: detectedPageCount,
      pagesWithText,
      wordCount,
      characterCount,
      averagePageChars,
      warnings,
    };
  }

  if (wordCount < MIN_READABLE_WORDS || characterCount < MIN_READABLE_CHARS) {
    warnings.push("The extracted text is too short for grounded card generation.");
  }
  if (detectedPageCount > 0 && averagePageChars < MIN_AVERAGE_PAGE_CHARS) {
    warnings.push("The average text per page is below the readable-PDF threshold.");
  }

  if (warnings.length) {
    return {
      parser: "pdf-parse",
      status: PDF_PARSE_STATUSES.OCR_NEEDED,
      code: PDF_PARSE_CODES.LOW_TEXT_SIGNAL,
      reason: warnings.join(" "),
      pageCount: detectedPageCount,
      pagesWithText,
      wordCount,
      characterCount,
      averagePageChars,
      warnings,
    };
  }

  return {
    parser: "pdf-parse",
    status: PDF_PARSE_STATUSES.PARSED,
    code: PDF_PARSE_CODES.READABLE_TEXT,
    reason: "Readable text was extracted with page-level source references.",
    pageCount: detectedPageCount || normalizedPages.length || 1,
    pagesWithText,
    wordCount,
    characterCount,
    averagePageChars,
    warnings,
  };
}

export function normalizePdfPages(pages = []) {
  return (Array.isArray(pages) ? pages : [])
    .map((page, index) => {
      const pageNumber = Number.isSafeInteger(page?.pageNumber)
        ? page.pageNumber
        : Number.isSafeInteger(page?.num)
          ? page.num
          : index + 1;
      const text = normalizeExtractedText(page?.text || "");

      return {
        pageNumber,
        citation: `Page ${pageNumber}`,
        text,
        wordCount: countWords(text),
        characterCount: text.length,
      };
    })
    .filter((page) => page.text);
}

export function buildParseFailureMessage(diagnostics) {
  if (diagnostics.status === PDF_PARSE_STATUSES.PARSE_FAILED) {
    return "The PDF could not be parsed. Try another copy or export the document as text.";
  }
  if (diagnostics.code === PDF_PARSE_CODES.SCANNED_OR_IMAGE_HEAVY) {
    return "This PDF looks scanned or image-heavy. OCR is needed before grounded cards can be generated.";
  }
  return "The PDF did not contain enough readable text for grounded cards. OCR may be needed.";
}

function buildParserErrorDiagnostics(error) {
  return {
    parser: "pdf-parse",
    status: PDF_PARSE_STATUSES.PARSE_FAILED,
    code: PDF_PARSE_CODES.PARSER_ERROR,
    reason: error instanceof Error ? error.message : "The PDF parser failed.",
    pageCount: 0,
    pagesWithText: 0,
    wordCount: 0,
    characterCount: 0,
    averagePageChars: 0,
    warnings: ["The parser threw before returning page-level text."],
  };
}

function inferTitleFromFile(file) {
  const name = typeof file?.name === "string" ? file.name : "";
  return name.replace(/\.[^.]+$/, "") || "Untitled PDF";
}

function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}
