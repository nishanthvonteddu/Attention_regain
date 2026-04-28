export const OCR_RECOVERY_KINDS = Object.freeze({
  NONE: "none",
  OCR_NEEDED: "ocr_needed",
  PARSE_FAILED: "parse_failed",
  GENERATION_FAILED: "generation_failed",
});

export const OCR_RECOVERY_ACTIONS = Object.freeze({
  REPROCESS_SOURCE: "reprocess_source",
  RETRY_PARSE: "retry_parse",
  RETRY_GENERATION: "retry_generation",
});

export const MANUAL_REPROCESS_MAX_JOBS = 3;

const ACTIVE_JOB_STATUSES = new Set(["queued", "processing", "retrying"]);

export function buildOcrRoutingDecision({ status, code, diagnostics = {} } = {}) {
  if (status === OCR_RECOVERY_KINDS.OCR_NEEDED) {
    return {
      kind: OCR_RECOVERY_KINDS.OCR_NEEDED,
      action: OCR_RECOVERY_ACTIONS.REPROCESS_SOURCE,
      owner: "document-processing-worker",
      terminal: true,
      code: code || diagnostics.code || "ocr_needed",
      label: "OCR fallback required",
      userMessage:
        "The PDF has too little extractable text for grounded cards. Reprocess after OCR or upload a text-exported copy.",
      operatorNote:
        "Keep the document in ocr_needed until an OCR-capable source is supplied or the source is reprocessed.",
    };
  }

  if (status === OCR_RECOVERY_KINDS.PARSE_FAILED) {
    return {
      kind: OCR_RECOVERY_KINDS.PARSE_FAILED,
      action: OCR_RECOVERY_ACTIONS.RETRY_PARSE,
      owner: "document-processing-worker",
      terminal: true,
      code: code || diagnostics.code || "parse_failed",
      label: "Parser retry available",
      userMessage:
        "The PDF could not be parsed. Retry parsing after exporting a cleaner PDF or uploading another copy.",
      operatorNote:
        "Keep the document in parse_failed until a bounded manual retry is requested.",
    };
  }

  return {
    kind: OCR_RECOVERY_KINDS.NONE,
    action: "",
    owner: "standard-pipeline",
    terminal: false,
    code: code || diagnostics.code || "readable_text",
    label: "Standard parsing",
    userMessage: "Readable text can continue through chunking, retrieval, and card generation.",
    operatorNote: "No OCR fallback is required.",
  };
}

export function buildRecoveryContract({
  document = null,
  job = null,
  diagnostics = [],
  processingJobCount = 0,
  maxManualReprocessJobs = MANUAL_REPROCESS_MAX_JOBS,
} = {}) {
  if (!document) {
    return null;
  }

  const latestDiagnostic = [...diagnostics]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ||
    null;
  const status = document.status || document.parseStatus || "";
  const active = ACTIVE_JOB_STATUSES.has(job?.status);
  const remainingManualAttempts = Math.max(0, maxManualReprocessJobs - processingJobCount);

  if (status === OCR_RECOVERY_KINDS.OCR_NEEDED) {
    return withRetryState({
      kind: OCR_RECOVERY_KINDS.OCR_NEEDED,
      action: OCR_RECOVERY_ACTIONS.REPROCESS_SOURCE,
      label: "OCR fallback required",
      badge: "OCR needed",
      actionLabel: "Reprocess source",
      detail:
        latestDiagnostic?.reason ||
        document.failureReason ||
        "This PDF appears scanned or image-heavy, so readable text must be recovered before cards can be grounded.",
      nextStep:
        "Use an OCR text layer, export a cleaner copy, or retry after the OCR path is available.",
      active,
      processingJobCount,
      remainingManualAttempts,
    });
  }

  if (status === OCR_RECOVERY_KINDS.PARSE_FAILED) {
    return withRetryState({
      kind: OCR_RECOVERY_KINDS.PARSE_FAILED,
      action: OCR_RECOVERY_ACTIONS.RETRY_PARSE,
      label: "Parser recovery required",
      badge: "Parse failed",
      actionLabel: "Retry parsing",
      detail:
        latestDiagnostic?.reason ||
        document.failureReason ||
        "The PDF parser could not read the document structure.",
      nextStep: "Retry after exporting the source again or uploading another copy of the file.",
      active,
      processingJobCount,
      remainingManualAttempts,
    });
  }

  if (status === "failed") {
    return withRetryState({
      kind: OCR_RECOVERY_KINDS.GENERATION_FAILED,
      action: OCR_RECOVERY_ACTIONS.RETRY_GENERATION,
      label: "Generation recovery required",
      badge: "Generation failed",
      actionLabel: "Retry generation",
      detail:
        job?.lastError ||
        document.failureReason ||
        "Processing stopped after parsing, before a ready feed was generated.",
      nextStep: "Retry the stored job payload if the source is still valid.",
      active,
      processingJobCount,
      remainingManualAttempts,
    });
  }

  return null;
}

export function canRetryRecovery(recovery) {
  return Boolean(recovery?.canRetry);
}

function withRetryState(recovery) {
  const canRetry = !recovery.active && recovery.remainingManualAttempts > 0;
  return {
    ...recovery,
    canRetry,
    blockedReason: recovery.active
      ? "Processing is already active for this document."
      : recovery.remainingManualAttempts <= 0
        ? "The manual reprocess limit has been reached for this document."
        : "",
  };
}
