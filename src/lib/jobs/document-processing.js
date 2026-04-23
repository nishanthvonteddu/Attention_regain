import { normalizeExtractedText } from "../documents/pdf-parser.js";
import { validateUploadDescriptor } from "../uploads/validation.js";

export const DOCUMENT_PROCESSING_QUEUE = "document-processing";
export const DOCUMENT_PROCESSING_JOB_VERSION = 1;
export const DOCUMENT_PROCESSING_MAX_ATTEMPTS = 3;
export const DOCUMENT_JOB_SOURCE_TYPES = Object.freeze({
  INLINE_TEXT: "inline_text",
  INLINE_FILE: "inline_file",
});

export async function createDocumentProcessingSource({
  sourceText = "",
  file = null,
} = {}) {
  if (file instanceof File) {
    const validation = validateUploadDescriptor({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    return {
      type: DOCUMENT_JOB_SOURCE_TYPES.INLINE_FILE,
      fileName: validation.descriptor.fileName,
      contentType: validation.descriptor.contentType,
      sizeBytes: validation.descriptor.sizeBytes,
      sourceKind: validation.descriptor.sourceKind,
      base64: bytes.toString("base64"),
    };
  }

  const normalizedText = normalizeExtractedText(sourceText);
  if (!normalizedText) {
    throw new Error("No readable source text was provided.");
  }

  return {
    type: DOCUMENT_JOB_SOURCE_TYPES.INLINE_TEXT,
    sourceKind: "paste",
    text: normalizedText,
  };
}

export function createDocumentProcessingPayload({
  documentId,
  title,
  goal,
  source,
}) {
  return {
    version: DOCUMENT_PROCESSING_JOB_VERSION,
    queueName: DOCUMENT_PROCESSING_QUEUE,
    documentId: String(documentId || "").trim(),
    title: String(title || "").trim(),
    goal: String(goal || "").trim(),
    source,
  };
}
