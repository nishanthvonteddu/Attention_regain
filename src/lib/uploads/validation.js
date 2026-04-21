export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const SUPPORTED_UPLOAD_EXTENSIONS = Object.freeze(["pdf", "txt", "md", "text"]);
export const SUPPORTED_UPLOAD_TYPES = Object.freeze([
  "application/pdf",
  "text/markdown",
  "text/plain",
]);

const EXTENSION_TO_KIND = {
  pdf: "pdf",
  txt: "file",
  md: "file",
  text: "file",
};

const TYPE_TO_EXTENSION = {
  "application/pdf": "pdf",
  "text/markdown": "md",
  "text/plain": "txt",
};

export function validateUploadDescriptor(input = {}) {
  const fileName = sanitizeFileName(input.fileName || input.name || "");
  const contentType = normalizeContentType(input.contentType || input.type || "");
  const sizeBytes = Number(input.sizeBytes ?? input.size ?? 0);
  const extension = getUploadExtension(fileName, contentType);

  if (!fileName) {
    return invalidUpload("missing_file_name", "Choose a named PDF or text file.");
  }

  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return invalidUpload("empty_upload", "The selected file is empty.");
  }

  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return invalidUpload("file_too_large", "Keep uploads under 12 MB for this MVP.");
  }

  if (!extension || !SUPPORTED_UPLOAD_EXTENSIONS.includes(extension)) {
    return invalidUpload(
      "unsupported_file_type",
      "Upload a PDF, TXT, MD, or TEXT file.",
    );
  }

  if (contentType && !SUPPORTED_UPLOAD_TYPES.includes(contentType)) {
    return invalidUpload(
      "unsupported_file_type",
      "Upload a PDF, TXT, MD, or TEXT file.",
    );
  }

  return {
    ok: true,
    descriptor: {
      fileName,
      contentType: contentType || contentTypeForExtension(extension),
      sizeBytes,
      extension,
      sourceKind: EXTENSION_TO_KIND[extension] || "file",
    },
  };
}

export function sanitizeFileName(fileName) {
  return String(fileName || "")
    .replace(/[/\\]/g, "-")
    .replace(/[^\w. -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function safeObjectFileName(fileName) {
  const sanitized = sanitizeFileName(fileName)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "source-file";
}

function invalidUpload(code, message) {
  return {
    ok: false,
    code,
    message,
  };
}

function normalizeContentType(contentType) {
  return String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function getUploadExtension(fileName, contentType) {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  if (SUPPORTED_UPLOAD_EXTENSIONS.includes(extension)) {
    return extension;
  }

  return TYPE_TO_EXTENSION[contentType] || "";
}

function contentTypeForExtension(extension) {
  if (extension === "pdf") {
    return "application/pdf";
  }
  if (extension === "md") {
    return "text/markdown";
  }
  return "text/plain";
}
