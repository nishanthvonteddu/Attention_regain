import { createHash, randomUUID } from "node:crypto";

export const DATA_MODEL_VERSION = 1;

export const SOURCE_KINDS = Object.freeze(["paste", "file", "pdf"]);
export const DOCUMENT_STATUSES = Object.freeze([
  "draft",
  "uploaded",
  "parsed",
  "chunked",
  "cards_generated",
  "ocr_needed",
  "parse_failed",
  "failed",
]);
export const PARSE_STATUSES = Object.freeze(["parsed", "ocr_needed", "parse_failed"]);
export const SESSION_STATUSES = Object.freeze(["building", "ready", "archived", "failed"]);
export const CARD_STATUSES = Object.freeze(["active", "saved", "dismissed"]);
export const UPLOAD_STATUSES = Object.freeze([
  "ready",
  "uploaded",
  "consumed",
  "failed",
]);
export const INTERACTION_TYPES = Object.freeze([
  "reveal_answer",
  "save_card",
  "unsave_card",
  "set_confidence",
  "dismiss_card",
]);

const STATUS_SETS = {
  sourceKind: new Set(SOURCE_KINDS),
  document: new Set(DOCUMENT_STATUSES),
  parse: new Set(PARSE_STATUSES),
  session: new Set(SESSION_STATUSES),
  card: new Set(CARD_STATUSES),
  upload: new Set(UPLOAD_STATUSES),
  interaction: new Set(INTERACTION_TYPES),
};

export function createPublicId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function assertAllowedValue(kind, value) {
  const values = STATUS_SETS[kind];
  if (!values || !values.has(value)) {
    throw new Error(`Unsupported ${kind} value: ${value}`);
  }
}

export function normalizeSourceKind(sourceKind) {
  const normalized = SOURCE_KINDS.includes(sourceKind) ? sourceKind : "paste";
  assertAllowedValue("sourceKind", normalized);
  return normalized;
}

export function hashSourceText(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

export function estimateTokens(text) {
  return Math.ceil(String(text || "").split(/\s+/).filter(Boolean).length * 1.35);
}

export function normalizeJsonStore(input = {}) {
  return {
    version: DATA_MODEL_VERSION,
    users: Array.isArray(input.users) ? input.users : [],
    documents: Array.isArray(input.documents) ? input.documents : [],
    documentUploads: Array.isArray(input.documentUploads) ? input.documentUploads : [],
    documentPages: Array.isArray(input.documentPages) ? input.documentPages : [],
    documentParseDiagnostics: Array.isArray(input.documentParseDiagnostics)
      ? input.documentParseDiagnostics
      : [],
    documentChunks: Array.isArray(input.documentChunks) ? input.documentChunks : [],
    studySessions: Array.isArray(input.studySessions) ? input.studySessions : [],
    studyCards: Array.isArray(input.studyCards) ? input.studyCards : [],
    studyInteractions: Array.isArray(input.studyInteractions) ? input.studyInteractions : [],
    migrations: Array.isArray(input.migrations) ? input.migrations : [],
  };
}

export function createEmptyJsonStore() {
  return normalizeJsonStore({
    migrations: [
      {
        id: "0001_core_schema",
        appliedAt: nowIso(),
      },
      {
        id: "0002_document_uploads",
        appliedAt: nowIso(),
      },
      {
        id: "0003_document_parse_outputs",
        appliedAt: nowIso(),
      },
    ],
  });
}
