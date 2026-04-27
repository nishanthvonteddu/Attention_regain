import {
  assertAllowedValue,
  createPublicId,
  estimateTokens,
  hashSourceText,
  normalizeSourceKind,
  nowIso,
} from "./schema.js";
import { createLocalJsonStore } from "./local-store.js";
import { assertPersistableGeneratedDeck } from "../study/card-contract.js";

export function createStudyRepository({ store = createLocalJsonStore() } = {}) {
  return {
    createDocumentRecord(input) {
      return createDocumentRecord(store, input);
    },
    createDocumentUpload(input) {
      return createDocumentUpload(store, input);
    },
    markDocumentUploadUploaded(input) {
      return markDocumentUploadUploaded(store, input);
    },
    getDocumentUploadForUser(userId, documentId) {
      return getDocumentUploadForUser(store, userId, documentId);
    },
    saveParsedDocument(input) {
      return saveParsedDocument(store, input);
    },
    markDocumentParseFailed(input) {
      return markDocumentParseFailed(store, input);
    },
    getDocumentParseForUser(userId, documentId) {
      return getDocumentParseForUser(store, userId, documentId);
    },
    saveDocumentChunks(input) {
      return saveDocumentChunks(store, input);
    },
    enqueueDocumentProcessingJob(input) {
      return enqueueDocumentProcessingJob(store, input);
    },
    claimDocumentProcessingJob(input) {
      return claimDocumentProcessingJob(store, input);
    },
    completeDocumentProcessingJob(input) {
      return completeDocumentProcessingJob(store, input);
    },
    failDocumentProcessingJob(input) {
      return failDocumentProcessingJob(store, input);
    },
    getDocumentProcessingJob(jobId) {
      return getDocumentProcessingJob(store, jobId);
    },
    getLatestDocumentProcessingJobForUser(userId, documentId) {
      return getLatestDocumentProcessingJobForUser(store, userId, documentId);
    },
    saveGeneratedDeck(input) {
      return saveGeneratedDeck(store, input);
    },
    getLatestDeckForUser(userId) {
      return getLatestDeckForUser(store, userId);
    },
    getLatestWorkspaceForUser(userId) {
      return getLatestWorkspaceForUser(store, userId);
    },
    recordInteraction(input) {
      return recordInteraction(store, input);
    },
    reset(seed) {
      return store.reset(seed);
    },
  };
}

export function getDefaultStudyRepository() {
  return createStudyRepository();
}

async function createDocumentRecord(store, input) {
  const userId = requireNonEmpty(input.user?.id, "user.id");
  const documentId = typeof input.documentId === "string" && input.documentId.trim()
    ? input.documentId.trim()
    : createPublicId("doc");
  const title = requireNonEmpty(input.title, "title");
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const timestamp = nowIso();
  const documentRow = {
    id: documentId,
    userId,
    title,
    sourceKind,
    sourceRef: typeof input.sourceRef === "string" ? input.sourceRef : "",
    goal: typeof input.goal === "string" && input.goal.trim()
      ? input.goal.trim()
      : "stay close to the material when attention slips",
    status: "draft",
    contentHash: "",
    wordCount: 0,
    pageCount: 0,
    parseStatus: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    parsedAt: null,
    failedAt: null,
    failureReason: "",
  };

  await store.update((current) => ({
    ...current,
    users: upsertById(current.users, {
      id: userId,
      email: typeof input.user.email === "string" ? input.user.email : "",
      displayName: typeof input.user.displayName === "string" ? input.user.displayName : "",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    documents: [...current.documents, documentRow],
  }));

  return documentRow;
}

async function createDocumentUpload(store, input) {
  const userId = requireNonEmpty(input.user?.id, "user.id");
  const documentId = requireNonEmpty(input.documentId, "documentId");
  const title = requireNonEmpty(input.title, "title");
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const timestamp = nowIso();
  const file = input.file && typeof input.file === "object" ? input.file : {};
  const storage = input.storage && typeof input.storage === "object" ? input.storage : {};
  const uploadRow = {
    id: createPublicId("upload"),
    userId,
    documentId,
    status: "ready",
    provider: requireNonEmpty(storage.provider, "storage.provider"),
    bucket: requireNonEmpty(storage.bucket, "storage.bucket"),
    objectKey: requireNonEmpty(storage.objectKey, "storage.objectKey"),
    objectUri: requireNonEmpty(storage.objectUri, "storage.objectUri"),
    uploadMode: requireNonEmpty(storage.uploadMode, "storage.uploadMode"),
    originalFileName: requireNonEmpty(file.fileName, "file.fileName"),
    contentType: requireNonEmpty(file.contentType, "file.contentType"),
    sizeBytes: requirePositiveInteger(file.sizeBytes, "file.sizeBytes"),
    etag: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: storage.expiresAt || null,
    uploadedAt: null,
    consumedAt: null,
    failedAt: null,
    failureReason: "",
  };
  const documentRow = {
    id: documentId,
    userId,
    title,
    sourceKind,
    sourceRef: uploadRow.objectUri,
    goal: typeof input.goal === "string" && input.goal.trim()
      ? input.goal.trim()
      : "stay close to the material when attention slips",
    status: "draft",
    contentHash: "",
    wordCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    parsedAt: null,
    failedAt: null,
    failureReason: "",
  };

  await store.update((current) => ({
    ...current,
    users: upsertById(current.users, {
      id: userId,
      email: typeof input.user.email === "string" ? input.user.email : "",
      displayName: typeof input.user.displayName === "string" ? input.user.displayName : "",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    documents: [...current.documents, documentRow],
    documentUploads: [...current.documentUploads, uploadRow],
  }));

  return uploadRow;
}

async function markDocumentUploadUploaded(store, input) {
  const userId = requireNonEmpty(input.userId, "userId");
  const documentId = requireNonEmpty(input.documentId, "documentId");
  const timestamp = nowIso();
  let updatedUpload = null;

  await store.update((current) => {
    const upload = current.documentUploads.find(
      (entry) => entry.documentId === documentId && entry.userId === userId,
    );
    if (!upload) {
      throw new Error("Document upload was not found for this user.");
    }

    updatedUpload = {
      ...upload,
      status: "uploaded",
      etag: typeof input.etag === "string" ? input.etag : upload.etag,
      updatedAt: timestamp,
      uploadedAt: timestamp,
    };

    return {
      ...current,
      documents: current.documents.map((document) => document.id === documentId && document.userId === userId
        ? { ...document, status: "uploaded", updatedAt: timestamp }
        : document),
      documentUploads: current.documentUploads.map((entry) =>
        entry.id === upload.id ? updatedUpload : entry,
      ),
    };
  });

  return updatedUpload;
}

async function getDocumentUploadForUser(store, userId, documentId) {
  const ownerId = requireNonEmpty(userId, "userId");
  const targetDocumentId = requireNonEmpty(documentId, "documentId");
  const current = await store.read();
  return current.documentUploads.find(
    (entry) => entry.userId === ownerId && entry.documentId === targetDocumentId,
  ) || null;
}

async function saveParsedDocument(store, input) {
  const userId = requireNonEmpty(input.userId, "userId");
  const documentId = requireNonEmpty(input.documentId, "documentId");
  const timestamp = nowIso();
  const text = String(input.text || "");
  const pages = normalizePageInputs(input.pages);
  const diagnostics = normalizeDiagnostics(input.diagnostics, "parsed");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  let parsedDocument = null;

  await store.update((current) => {
    const existingDocument = current.documents.find(
      (entry) => entry.id === documentId && entry.userId === userId,
    );
    if (!existingDocument) {
      throw new Error("Document upload was not found for this user.");
    }

    parsedDocument = {
      ...existingDocument,
      status: "parsed",
      contentHash: hashSourceText(text),
      wordCount,
      pageCount: pages.length,
      parseStatus: "parsed",
      updatedAt: timestamp,
      parsedAt: timestamp,
      failedAt: null,
      failureReason: "",
    };

    return {
      ...current,
      documents: current.documents.map((document) =>
        document.id === documentId && document.userId === userId ? parsedDocument : document,
      ),
      documentPages: [
        ...current.documentPages.filter((page) => page.documentId !== documentId),
        ...pages.map((page) => ({
          id: createPublicId("page"),
          documentId,
          pageNumber: page.pageNumber,
          citation: page.citation || `Page ${page.pageNumber}`,
          text: page.text,
          wordCount: page.wordCount,
          characterCount: page.characterCount,
          createdAt: timestamp,
        })),
      ],
      documentParseDiagnostics: [
        ...current.documentParseDiagnostics.filter(
          (entry) => entry.documentId !== documentId || entry.status !== "parsed",
        ),
        {
          id: createPublicId("parse"),
          documentId,
          status: "parsed",
          code: diagnostics.code,
          parser: diagnostics.parser,
          reason: diagnostics.reason,
          pageCount: diagnostics.pageCount,
          pagesWithText: diagnostics.pagesWithText,
          wordCount: diagnostics.wordCount,
          characterCount: diagnostics.characterCount,
          averagePageChars: diagnostics.averagePageChars,
          warnings: diagnostics.warnings,
          createdAt: timestamp,
        },
      ],
    };
  });

  return parsedDocument;
}

async function markDocumentParseFailed(store, input) {
  const userId = requireNonEmpty(input.userId, "userId");
  const documentId = requireNonEmpty(input.documentId, "documentId");
  const status = requireNonEmpty(input.status, "status");
  assertAllowedValue("parse", status);
  if (status === "parsed") {
    throw new Error("Parsed documents must be saved through saveParsedDocument.");
  }

  const timestamp = nowIso();
  const diagnostics = normalizeDiagnostics(input.diagnostics, status);
  let failedDocument = null;

  await store.update((current) => {
    const existingDocument = current.documents.find(
      (entry) => entry.id === documentId && entry.userId === userId,
    );
    if (!existingDocument) {
      throw new Error("Document upload was not found for this user.");
    }

    const failureReason = String(input.failureReason || diagnostics.reason || status);
    failedDocument = {
      ...existingDocument,
      status,
      pageCount: diagnostics.pageCount,
      parseStatus: status,
      updatedAt: timestamp,
      failedAt: timestamp,
      failureReason,
    };

    return {
      ...current,
      documents: current.documents.map((document) =>
        document.id === documentId && document.userId === userId ? failedDocument : document,
      ),
      documentUploads: current.documentUploads.map((upload) =>
        upload.documentId === documentId && upload.userId === userId && upload.status !== "consumed"
          ? {
              ...upload,
              status: "failed",
              updatedAt: timestamp,
              failedAt: timestamp,
              failureReason,
            }
          : upload,
      ),
      documentParseDiagnostics: [
        ...current.documentParseDiagnostics,
        {
          id: createPublicId("parse"),
          documentId,
          status,
          code: diagnostics.code,
          parser: diagnostics.parser,
          reason: diagnostics.reason,
          pageCount: diagnostics.pageCount,
          pagesWithText: diagnostics.pagesWithText,
          wordCount: diagnostics.wordCount,
          characterCount: diagnostics.characterCount,
          averagePageChars: diagnostics.averagePageChars,
          warnings: diagnostics.warnings,
          createdAt: timestamp,
        },
      ],
    };
  });

  return failedDocument;
}

async function getDocumentParseForUser(store, userId, documentId) {
  const ownerId = requireNonEmpty(userId, "userId");
  const targetDocumentId = requireNonEmpty(documentId, "documentId");
  const current = await store.read();
  const document = current.documents.find(
    (entry) => entry.id === targetDocumentId && entry.userId === ownerId,
  );
  if (!document) {
    return null;
  }

  return {
    document,
    pages: current.documentPages
      .filter((page) => page.documentId === targetDocumentId)
      .sort((left, right) => left.pageNumber - right.pageNumber),
    diagnostics: current.documentParseDiagnostics
      .filter((entry) => entry.documentId === targetDocumentId)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
  };
}

async function saveDocumentChunks(store, input) {
  const userId = requireNonEmpty(input.userId, "userId");
  const documentId = requireNonEmpty(input.documentId, "documentId");
  const chunks = Array.isArray(input.chunks) ? input.chunks : [];
  if (!chunks.length) {
    throw new Error("A parsed document needs at least one source chunk.");
  }

  const timestamp = nowIso();
  const chunkRows = chunks.map((chunk, index) => normalizeChunkRow({
    chunk,
    documentId,
    sequence: Number.isSafeInteger(chunk?.sequence) ? chunk.sequence : index,
    timestamp,
  }));
  let persistedChunks = [];

  await store.update((current) => {
    const existingDocument = current.documents.find(
      (entry) => entry.id === documentId && entry.userId === userId,
    );
    if (!existingDocument) {
      throw new Error("Document upload was not found for this user.");
    }

    persistedChunks = chunkRows;
    return {
      ...current,
      documents: current.documents.map((document) =>
        document.id === documentId && document.userId === userId
          ? {
              ...document,
              status: "chunked",
              updatedAt: timestamp,
            }
          : document),
      documentChunks: [
        ...current.documentChunks.filter((chunk) => chunk.documentId !== documentId),
        ...chunkRows,
      ],
    };
  });

  return persistedChunks;
}

async function enqueueDocumentProcessingJob(store, input) {
  const userId = requireNonEmpty(input.userId, "userId");
  const documentId = requireNonEmpty(input.documentId, "documentId");
  const payload = input.payload && typeof input.payload === "object" ? input.payload : null;
  if (!payload) {
    throw new Error("Document processing jobs require a payload.");
  }

  const queueName = requireNonEmpty(input.queueName, "queueName");
  const timestamp = nowIso();
  const job = {
    id: createPublicId("job"),
    userId,
    documentId,
    queueName,
    status: "queued",
    attemptCount: 0,
    maxAttempts: requirePositiveInteger(input.maxAttempts || 3, "maxAttempts"),
    payload,
    resultStatus: "",
    availableAt: timestamp,
    startedAt: null,
    completedAt: null,
    deadLetteredAt: null,
    leaseOwner: "",
    leaseExpiresAt: null,
    lastError: "",
    lastErrorCode: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await store.update((current) => {
    const document = current.documents.find(
      (entry) => entry.id === documentId && entry.userId === userId,
    );
    if (!document) {
      throw new Error("Document upload was not found for this user.");
    }

    return {
      ...current,
      documents: current.documents.map((entry) =>
        entry.id === documentId && entry.userId === userId
          ? {
              ...entry,
              status: "queued",
              updatedAt: timestamp,
              failedAt: null,
              failureReason: "",
            }
          : entry),
      documentJobs: [...current.documentJobs, job],
    };
  });

  return job;
}

async function claimDocumentProcessingJob(store, input) {
  const jobId = requireNonEmpty(input.jobId, "jobId");
  const workerId = requireNonEmpty(input.workerId, "workerId");
  const leaseMs = Math.max(1_000, Number(input.leaseMs) || 60_000);
  const timestamp = Date.now();
  const now = new Date(timestamp).toISOString();
  const leaseExpiresAt = new Date(timestamp + leaseMs).toISOString();
  let claimedJob = null;

  await store.update((current) => {
    const job = current.documentJobs.find((entry) => entry.id === jobId);
    if (!job) {
      return current;
    }

    const availableAt = job.availableAt ? Date.parse(job.availableAt) : 0;
    const leaseExpired = !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= timestamp;
    const canClaim =
      (job.status === "queued" || job.status === "retrying") && availableAt <= timestamp;
    const canRecover = job.status === "processing" && leaseExpired;
    if (!canClaim && !canRecover) {
      return current;
    }

    claimedJob = {
      ...job,
      status: "processing",
      attemptCount: job.attemptCount + 1,
      startedAt: now,
      updatedAt: now,
      leaseOwner: workerId,
      leaseExpiresAt,
    };

    return {
      ...current,
      documents: current.documents.map((entry) =>
        entry.id === job.documentId && entry.userId === job.userId
          ? {
              ...entry,
              status: "processing",
              updatedAt: now,
              failedAt: null,
              failureReason: "",
            }
          : entry),
      documentJobs: current.documentJobs.map((entry) =>
        entry.id === job.id ? claimedJob : entry),
    };
  });

  return claimedJob;
}

async function completeDocumentProcessingJob(store, input) {
  const jobId = requireNonEmpty(input.jobId, "jobId");
  const timestamp = nowIso();
  let completedJob = null;

  await store.update((current) => {
    const job = current.documentJobs.find((entry) => entry.id === jobId);
    if (!job) {
      throw new Error("Document processing job was not found.");
    }

    completedJob = {
      ...job,
      status: "succeeded",
      resultStatus: typeof input.resultStatus === "string" ? input.resultStatus : job.resultStatus,
      completedAt: timestamp,
      updatedAt: timestamp,
      leaseOwner: "",
      leaseExpiresAt: null,
    };

    return {
      ...current,
      documentJobs: current.documentJobs.map((entry) =>
        entry.id === jobId ? completedJob : entry),
    };
  });

  return completedJob;
}

async function failDocumentProcessingJob(store, input) {
  const jobId = requireNonEmpty(input.jobId, "jobId");
  const errorMessage = requireNonEmpty(input.errorMessage, "errorMessage");
  const errorCode = typeof input.errorCode === "string" ? input.errorCode : "";
  const timestamp = Date.now();
  const now = new Date(timestamp).toISOString();
  const retryDelayMs = Math.max(250, Number(input.retryDelayMs) || 750);
  let failedJob = null;

  await store.update((current) => {
    const job = current.documentJobs.find((entry) => entry.id === jobId);
    if (!job) {
      throw new Error("Document processing job was not found.");
    }

    const canRetry = job.attemptCount < job.maxAttempts;
    failedJob = {
      ...job,
      status: canRetry ? "retrying" : "dead_letter",
      availableAt: canRetry ? new Date(timestamp + retryDelayMs).toISOString() : job.availableAt,
      updatedAt: now,
      deadLetteredAt: canRetry ? null : now,
      leaseOwner: "",
      leaseExpiresAt: null,
      lastError: errorMessage,
      lastErrorCode: errorCode,
      retryDelayMs: canRetry ? retryDelayMs : 0,
    };

    return {
      ...current,
      documents: current.documents.map((entry) =>
        entry.id === job.documentId && entry.userId === job.userId
          ? canRetry
            ? {
                ...entry,
                status: "queued",
                updatedAt: now,
                failedAt: null,
                failureReason: "",
              }
            : {
                ...entry,
                status: "failed",
                updatedAt: now,
                failedAt: now,
                failureReason: errorMessage,
              }
          : entry),
      documentUploads: current.documentUploads.map((entry) =>
        entry.documentId === job.documentId && entry.userId === job.userId && !canRetry
          ? {
              ...entry,
              status: "failed",
              updatedAt: now,
              failedAt: now,
              failureReason: errorMessage,
            }
          : entry),
      documentJobs: current.documentJobs.map((entry) =>
        entry.id === jobId ? failedJob : entry),
    };
  });

  return failedJob;
}

async function getDocumentProcessingJob(store, jobId) {
  const targetJobId = requireNonEmpty(jobId, "jobId");
  const current = await store.read();
  return current.documentJobs.find((entry) => entry.id === targetJobId) || null;
}

async function getLatestDocumentProcessingJobForUser(store, userId, documentId) {
  const ownerId = requireNonEmpty(userId, "userId");
  const targetDocumentId = requireNonEmpty(documentId, "documentId");
  const current = await store.read();
  return current.documentJobs
    .filter((entry) => entry.userId === ownerId && entry.documentId === targetDocumentId)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
}

async function saveGeneratedDeck(store, input) {
  const userId = requireNonEmpty(input.user?.id, "user.id");
  const title = requireNonEmpty(input.documentTitle, "documentTitle");
  const goal = requireNonEmpty(input.goal, "goal");
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const passages = Array.isArray(input.passages) ? input.passages : [];
  const rawCards = Array.isArray(input.cards) ? input.cards : [];

  if (!rawCards.length) {
    throw new Error("A persisted study session needs at least one card.");
  }
  const validatedDeck = assertPersistableGeneratedDeck({ cards: rawCards, passages });
  const cards = validatedDeck.cards;

  const timestamp = nowIso();
  const requestedDocumentId =
    typeof input.documentId === "string" && input.documentId.trim()
      ? input.documentId.trim()
      : "";
  const documentId = requestedDocumentId || createPublicId("doc");
  const sessionId = createPublicId("session");
  const chunkRows = passages.map((passage, index) => normalizeChunkRow({
    chunk: passage,
    documentId,
    sequence: Number.isSafeInteger(passage?.sequence) ? passage.sequence : index,
    timestamp,
  }));
  const chunkByCitation = new Map(chunkRows.map((chunk) => [chunk.citation, chunk]));
  const chunkById = new Map(chunkRows.map((chunk) => [chunk.id, chunk]));
  const cardRows = cards.map((card, index) => {
    const kind = ["glance", "recall", "application", "pitfall"].includes(card.kind)
      ? card.kind
      : "glance";
    const citation = String(card.citation || "");
    const requestedChunkId = String(card.chunkId || card.sourceReference?.chunkId || "").trim();
    const chunk = (requestedChunkId ? chunkById.get(requestedChunkId) : null) ||
      chunkByCitation.get(citation) ||
      null;
    if (!chunk) {
      throw new Error(`Generated card ${index + 1} does not point to a persisted source chunk.`);
    }

    return {
      id: createPublicId("card"),
      sessionId,
      documentId,
      chunkId: chunk.id,
      sequence: index,
      kind,
      status: "active",
      title: requireNonEmpty(card.title, `cards[${index}].title`),
      body: requireNonEmpty(card.body, `cards[${index}].body`),
      question: typeof card.question === "string" ? card.question : "",
      answer: typeof card.answer === "string" ? card.answer : "",
      excerpt: requireNonEmpty(card.excerpt, `cards[${index}].excerpt`),
      citation: requireNonEmpty(citation, `cards[${index}].citation`),
      sourceReference: {
        ...(card.sourceReference || {}),
        chunkId: chunk.id,
        citation: chunk.citation,
        pageNumber: chunk.pageNumber,
        paragraphStart: chunk.paragraphStart,
        paragraphEnd: chunk.paragraphEnd,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  return store.update((current) => {
    const nextUsers = upsertById(current.users, {
      id: userId,
      email: typeof input.user.email === "string" ? input.user.email : "",
      displayName: typeof input.user.displayName === "string" ? input.user.displayName : "",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const existingDocument = requestedDocumentId
      ? current.documents.find(
          (entry) => entry.id === requestedDocumentId && entry.userId === userId,
        )
      : null;
    if (requestedDocumentId && !existingDocument) {
      throw new Error("Document upload was not found for this user.");
    }

    const sourceText = passages.map((passage) => passage.text || "").join("\n\n");
    const documentRow = {
      ...(existingDocument || {}),
      id: documentId,
      userId,
      title,
      sourceKind,
      sourceRef:
        existingDocument?.sourceRef ||
        (typeof input.sourceRef === "string" ? input.sourceRef : ""),
      goal,
      status: "cards_generated",
      contentHash: existingDocument?.contentHash || hashSourceText(sourceText),
      wordCount:
        existingDocument?.wordCount ||
        sourceText.split(/\s+/).filter(Boolean).length,
      pageCount: existingDocument?.pageCount || countDistinctPageNumbers(chunkRows),
      parseStatus: existingDocument?.parseStatus || "parsed",
      createdAt: existingDocument?.createdAt || timestamp,
      updatedAt: timestamp,
      parsedAt: existingDocument?.parsedAt || timestamp,
      failedAt: null,
      failureReason: "",
    };
    const sessionRow = {
      id: sessionId,
      userId,
      documentId,
      goal,
      status: "ready",
      generationMode: requireNonEmpty(input.generationMode, "generationMode"),
      model: requireNonEmpty(input.model, "model"),
      focusTags: Array.isArray(input.focusTags) && input.focusTags.length
        ? input.focusTags.map(String)
        : validatedDeck.focusTags,
      stats: input.stats && typeof input.stats === "object" ? input.stats : {},
      createdAt: timestamp,
      updatedAt: timestamp,
      readyAt: timestamp,
      failedAt: null,
      failureReason: "",
    };

    return {
      ...current,
      users: nextUsers,
      documents: existingDocument
        ? current.documents.map((document) => document.id === existingDocument.id
          ? documentRow
          : document)
        : [...current.documents, documentRow],
      documentUploads: markConsumedUploadRows(
        current.documentUploads,
        documentId,
        userId,
        timestamp,
      ),
      documentChunks: mergeDeckChunks(current.documentChunks, chunkRows),
      studySessions: [...current.studySessions, sessionRow],
      studyCards: [...current.studyCards, ...cardRows],
    };
  }).then(() => buildDeckResponse({
    document: {
      id: documentId,
      title,
      sourceKind,
    },
    session: {
      id: sessionId,
      goal,
      generationMode: input.generationMode,
      model: input.model,
      focusTags: input.focusTags,
      stats: input.stats,
    },
    cards: cardRows,
  }));
}

async function getLatestDeckForUser(store, userId) {
  const ownerId = requireNonEmpty(userId, "userId");
  const current = await store.read();
  const session = current.studySessions
    .filter((entry) => entry.userId === ownerId && entry.status === "ready")
    .sort((left, right) => compareRecentRows(left, right))[0];

  if (!session) {
    return null;
  }

  const document = current.documents.find((entry) => entry.id === session.documentId);
  const cards = current.studyCards
    .filter((entry) => entry.sessionId === session.id)
    .sort((left, right) => left.sequence - right.sequence);
  const interactions = current.studyInteractions
    .filter((entry) => entry.sessionId === session.id && entry.userId === ownerId)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));

  return buildDeckResponse({ document, session, cards, interactions });
}

async function getLatestWorkspaceForUser(store, userId) {
  const ownerId = requireNonEmpty(userId, "userId");
  const current = await store.read();
  const { document, lastActiveAt } = selectLastActiveDocument(current, ownerId);

  if (!document) {
    return { document: null, job: null, deck: null, resume: buildResumeResponse({}) };
  }

  const job = current.documentJobs
    .filter((entry) => entry.documentId === document.id && entry.userId === ownerId)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
  const session = current.studySessions
    .filter((entry) => entry.documentId === document.id && entry.userId === ownerId)
    .sort((left, right) => compareRecentRows(left, right))[0] || null;
  const cards = session?.status === "ready"
    ? current.studyCards
      .filter((entry) => entry.sessionId === session.id)
      .sort((left, right) => left.sequence - right.sequence)
    : [];
  const interactions = session
    ? current.studyInteractions
      .filter((entry) => entry.sessionId === session.id && entry.userId === ownerId)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    : [];
  const deck = session?.status === "ready"
    ? buildDeckResponse({ document, session, cards, interactions })
    : null;

  return {
    document: buildDocumentResponse(document),
    job: buildJobResponse(job),
    deck,
    resume: buildResumeResponse({
      document,
      job,
      session,
      deck,
      lastActiveAt,
    }),
  };
}

async function recordInteraction(store, input) {
  const userId = requireNonEmpty(input.userId, "userId");
  const sessionId = requireNonEmpty(input.sessionId, "sessionId");
  const interactionType = requireNonEmpty(input.interactionType, "interactionType");
  assertAllowedValue("interaction", interactionType);
  const timestamp = nowIso();
  const interaction = {
    id: createPublicId("interaction"),
    userId,
    sessionId,
    cardId: typeof input.cardId === "string" && input.cardId ? input.cardId : null,
    interactionType,
    value: typeof input.value === "string" ? input.value : "",
    createdAt: timestamp,
  };

  await store.update((current) => {
    const session = current.studySessions.find(
      (entry) => entry.id === sessionId && entry.userId === userId,
    );
    if (!session) {
      throw new Error("Study session was not found for this user.");
    }

    const card = interaction.cardId
      ? current.studyCards.find(
          (entry) => entry.id === interaction.cardId && entry.sessionId === sessionId,
        )
      : null;
    if (interaction.cardId && !card) {
      throw new Error("Study card was not found for this session.");
    }

    return {
      ...current,
      studyCards: updateCardStatus(current.studyCards, interaction),
      studySessions: current.studySessions.map((entry) =>
        entry.id === session.id
          ? { ...entry, updatedAt: timestamp }
          : entry),
      documents: current.documents.map((entry) =>
        entry.id === session.documentId && entry.userId === userId
          ? { ...entry, updatedAt: timestamp }
          : entry),
      studyInteractions: [...current.studyInteractions, interaction],
    };
  });

  return interaction;
}

function buildDeckResponse({ document, session, cards, interactions = [] }) {
  return {
    documentId: document?.id || "",
    sessionId: session.id,
    documentTitle: document?.title || "Untitled study source",
    goal: session.goal,
    sourceKind: document?.sourceKind || "paste",
    focusTags: Array.isArray(session.focusTags) ? session.focusTags : [],
    cards: cards.map((card) => ({
      id: card.id,
      kind: card.kind,
      title: card.title,
      body: card.body,
      question: card.question || undefined,
      answer: card.answer || undefined,
      excerpt: card.excerpt,
      citation: card.citation,
      chunkId: card.chunkId || undefined,
      sourceReference: card.sourceReference || undefined,
      status: card.status,
    })),
    feedback: buildFeedbackResponse({ cards, interactions }),
    generationMode: session.generationMode,
    model: session.model,
    stats: {
      ...(session.stats || {}),
      cardCount: cards.length,
    },
    readyAt: session.readyAt || session.createdAt,
    lastActiveAt: session.updatedAt || session.readyAt || session.createdAt,
    persistence: {
      adapter: "local-json",
      serverStored: true,
      resumeSource: "server",
    },
  };
}

function buildDocumentResponse(document) {
  if (!document) {
    return null;
  }

  return {
    id: document.id,
    title: document.title,
    goal: document.goal,
    sourceKind: document.sourceKind,
    status: document.status,
    parseStatus: document.parseStatus || null,
    pageCount: document.pageCount || 0,
    wordCount: document.wordCount || 0,
    updatedAt: document.updatedAt,
    failedAt: document.failedAt,
    failureReason: document.failureReason || "",
    statusGroup: groupDocumentStatus(document.status),
  };
}

function buildResumeResponse({ document = null, job = null, session = null, deck = null, lastActiveAt = "" }) {
  if (!document) {
    return {
      available: false,
      status: "empty",
      label: "No resumable document",
      detail: "Add a source to create the first server-backed study session.",
    };
  }

  const statusGroup = deck ? "ready" : groupDocumentStatus(document.status);
  const labels = {
    ready: "Resume ready feed",
    processing: "Resume processing document",
    failed: "Review failed document",
    empty: "No resumable document",
  };
  const details = {
    ready: "Cards and study actions were loaded from the backend.",
    processing: "The worker state is still active; this view will refresh while it runs.",
    failed: document.failureReason || job?.lastError || "Processing stopped before cards were ready.",
    empty: "Add a source to create the first server-backed study session.",
  };

  return {
    available: true,
    status: statusGroup,
    label: labels[statusGroup] || labels.processing,
    detail: details[statusGroup] || details.processing,
    documentId: document.id,
    documentTitle: document.title,
    sessionId: session?.id || "",
    lastActiveAt:
      lastActiveAt ||
      session?.updatedAt ||
      session?.readyAt ||
      session?.createdAt ||
      document.updatedAt,
  };
}

function buildJobResponse(job) {
  if (!job) {
    return null;
  }

  const active = job.status === "queued" || job.status === "processing" || job.status === "retrying";
  return {
    id: job.id,
    queueName: job.queueName,
    status: job.status,
    active,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    availableAt: job.availableAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    deadLetteredAt: job.deadLetteredAt,
    lastError: job.lastError || "",
    lastErrorCode: job.lastErrorCode || "",
    resultStatus: job.resultStatus || "",
  };
}

function buildFeedbackResponse({ cards, interactions }) {
  const feedback = Object.fromEntries(
    cards.map((card) => [
      card.id,
      {
        confidence: null,
        saved: card.status === "saved",
        revealed: false,
      },
    ]),
  );

  for (const interaction of interactions) {
    if (!interaction.cardId || !feedback[interaction.cardId]) {
      continue;
    }

    if (interaction.interactionType === "save_card") {
      feedback[interaction.cardId].saved = true;
    } else if (interaction.interactionType === "unsave_card") {
      feedback[interaction.cardId].saved = false;
    } else if (interaction.interactionType === "reveal_answer") {
      feedback[interaction.cardId].revealed = interaction.value !== "false";
    } else if (interaction.interactionType === "set_confidence") {
      feedback[interaction.cardId].confidence = interaction.value || null;
    }
  }

  return feedback;
}

function selectLastActiveDocument(current, ownerId) {
  const sessionsByDocumentId = new Map();
  for (const session of current.studySessions.filter((entry) => entry.userId === ownerId)) {
    const currentSession = sessionsByDocumentId.get(session.documentId);
    if (!currentSession || compareRecentRows(session, currentSession) < 0) {
      sessionsByDocumentId.set(session.documentId, session);
    }
  }

  const interactionTimesBySessionId = new Map();
  for (const interaction of current.studyInteractions.filter((entry) => entry.userId === ownerId)) {
    const previous = interactionTimesBySessionId.get(interaction.sessionId) || "";
    if (String(interaction.createdAt).localeCompare(previous) > 0) {
      interactionTimesBySessionId.set(interaction.sessionId, interaction.createdAt);
    }
  }

  const ranked = current.documents
    .filter((entry) => entry.userId === ownerId)
    .map((document) => {
      const session = sessionsByDocumentId.get(document.id);
      const interactionAt = session ? interactionTimesBySessionId.get(session.id) : "";
      const lastActiveAt = maxIso([
        document.updatedAt,
        document.createdAt,
        session?.updatedAt,
        session?.readyAt,
        session?.createdAt,
        interactionAt,
      ]);
      return { document, lastActiveAt };
    })
    .sort((left, right) => {
      const activeComparison = String(right.lastActiveAt).localeCompare(String(left.lastActiveAt));
      if (activeComparison !== 0) {
        return activeComparison;
      }
      return String(right.document.createdAt).localeCompare(String(left.document.createdAt));
    });

  return ranked[0] || { document: null, lastActiveAt: "" };
}

function compareRecentRows(left, right) {
  const updatedComparison = String(right.updatedAt || right.createdAt)
    .localeCompare(String(left.updatedAt || left.createdAt));
  if (updatedComparison !== 0) {
    return updatedComparison;
  }
  return String(right.createdAt).localeCompare(String(left.createdAt));
}

function maxIso(values) {
  return values
    .filter(Boolean)
    .map(String)
    .sort((left, right) => right.localeCompare(left))[0] || "";
}

function groupDocumentStatus(status) {
  if (status === "cards_generated") {
    return "ready";
  }
  if (status === "failed" || status === "parse_failed" || status === "ocr_needed") {
    return "failed";
  }
  if (!status) {
    return "empty";
  }
  return "processing";
}

function updateCardStatus(cards, interaction) {
  if (!interaction.cardId) {
    return cards;
  }

  return cards.map((card) => {
    if (card.id !== interaction.cardId) {
      return card;
    }

    if (interaction.interactionType === "save_card") {
      return { ...card, status: "saved", updatedAt: interaction.createdAt };
    }
    if (interaction.interactionType === "unsave_card") {
      return { ...card, status: "active", updatedAt: interaction.createdAt };
    }
    if (interaction.interactionType === "dismiss_card") {
      return { ...card, status: "dismissed", updatedAt: interaction.createdAt };
    }

    return { ...card, updatedAt: interaction.createdAt };
  });
}

function upsertById(rows, nextRow) {
  const existing = rows.find((row) => row.id === nextRow.id);
  if (!existing) {
    return [...rows, nextRow];
  }

  return rows.map((row) => row.id === nextRow.id
    ? {
        ...row,
        email: nextRow.email || row.email,
        displayName: nextRow.displayName || row.displayName,
        updatedAt: nextRow.updatedAt,
      }
    : row);
}

function markConsumedUploadRows(rows, documentId, userId, timestamp) {
  return rows.map((row) => {
    if (row.documentId !== documentId || row.userId !== userId) {
      return row;
    }

    return {
      ...row,
      status: "consumed",
      updatedAt: timestamp,
      consumedAt: timestamp,
    };
  });
}

function mergeDeckChunks(existingRows, deckRows) {
  const deckById = new Map(deckRows.map((row) => [row.id, row]));
  const mergedRows = existingRows.map((row) => {
    const deckRow = deckById.get(row.id);
    if (!deckRow) {
      return row;
    }

    return {
      ...row,
      retrievalRank: deckRow.retrievalRank,
      retrievalScore: deckRow.retrievalScore,
      retrievalReason: deckRow.retrievalReason,
      retrieval: deckRow.retrieval,
    };
  });
  const existingIds = new Set(existingRows.map((row) => row.id));
  const newRows = deckRows.filter((row) => !existingIds.has(row.id));
  return [...mergedRows, ...newRows];
}

function normalizeChunkRow({ chunk, documentId, sequence, timestamp }) {
  const text = String(chunk?.text || "").trim();
  const citation = String(chunk?.citation || `Section ${sequence + 1}`).trim();
  const pageNumber = Number.isSafeInteger(chunk?.pageNumber)
    ? chunk.pageNumber
    : extractPageNumber(citation);

  return {
    id: typeof chunk?.id === "string" && chunk.id.trim()
      ? chunk.id.trim()
      : createPublicId("chunk"),
    documentId,
    sequence,
    citation,
    pageNumber,
    sectionLabel: typeof chunk?.sectionLabel === "string" ? chunk.sectionLabel : "",
    paragraphStart: Number.isSafeInteger(chunk?.paragraphStart)
      ? chunk.paragraphStart
      : null,
    paragraphEnd: Number.isSafeInteger(chunk?.paragraphEnd) ? chunk.paragraphEnd : null,
    text,
    sentences: Array.isArray(chunk?.sentences) ? chunk.sentences.map(String) : [],
    topics: Array.isArray(chunk?.topics) ? chunk.topics.map(String) : [],
    wordCount: Number.isSafeInteger(chunk?.wordCount)
      ? chunk.wordCount
      : text.split(/\s+/).filter(Boolean).length,
    characterCount: Number.isSafeInteger(chunk?.characterCount)
      ? chunk.characterCount
      : text.length,
    tokenEstimate: Number.isSafeInteger(chunk?.tokenEstimate)
      ? chunk.tokenEstimate
      : estimateTokens(text),
    embeddingStatus: typeof chunk?.embeddingStatus === "string"
      ? chunk.embeddingStatus
      : "pending",
    embeddingProvider: typeof chunk?.embeddingProvider === "string"
      ? chunk.embeddingProvider
      : "",
    embeddingModel: typeof chunk?.embeddingModel === "string" ? chunk.embeddingModel : "",
    retrievalRank: Number.isSafeInteger(chunk?.retrieval?.rank) ? chunk.retrieval.rank : null,
    retrievalScore: Number.isFinite(chunk?.retrieval?.score) ? chunk.retrieval.score : null,
    retrievalReason: typeof chunk?.retrieval?.reason === "string" ? chunk.retrieval.reason : "",
    retrieval: chunk?.retrieval && typeof chunk.retrieval === "object"
      ? {
          rank: Number.isSafeInteger(chunk.retrieval.rank) ? chunk.retrieval.rank : null,
          score: Number.isFinite(chunk.retrieval.score) ? chunk.retrieval.score : 0,
          reason: typeof chunk.retrieval.reason === "string" ? chunk.retrieval.reason : "",
        }
      : null,
    createdAt: timestamp,
  };
}

function normalizePageInputs(pages = []) {
  return (Array.isArray(pages) ? pages : [])
    .map((page, index) => {
      const pageNumber = Number.isSafeInteger(page?.pageNumber)
        ? page.pageNumber
        : Number.isSafeInteger(page?.num)
          ? page.num
          : index + 1;
      const text = String(page?.text || "").trim();
      return {
        pageNumber,
        citation: String(page?.citation || `Page ${pageNumber}`),
        text,
        wordCount: Number.isSafeInteger(page?.wordCount)
          ? page.wordCount
          : text.split(/\s+/).filter(Boolean).length,
        characterCount: Number.isSafeInteger(page?.characterCount)
          ? page.characterCount
          : text.length,
      };
    })
    .filter((page) => page.text);
}

function normalizeDiagnostics(diagnostics = {}, fallbackStatus) {
  const status = typeof diagnostics.status === "string" ? diagnostics.status : fallbackStatus;
  assertAllowedValue("parse", status);
  return {
    parser: typeof diagnostics.parser === "string" ? diagnostics.parser : "pdf-parse",
    status,
    code: typeof diagnostics.code === "string" ? diagnostics.code : status,
    reason: typeof diagnostics.reason === "string" ? diagnostics.reason : status,
    pageCount: Number.isSafeInteger(diagnostics.pageCount) ? diagnostics.pageCount : 0,
    pagesWithText: Number.isSafeInteger(diagnostics.pagesWithText) ? diagnostics.pagesWithText : 0,
    wordCount: Number.isSafeInteger(diagnostics.wordCount) ? diagnostics.wordCount : 0,
    characterCount: Number.isSafeInteger(diagnostics.characterCount)
      ? diagnostics.characterCount
      : 0,
    averagePageChars: Number.isSafeInteger(diagnostics.averagePageChars)
      ? diagnostics.averagePageChars
      : 0,
    warnings: Array.isArray(diagnostics.warnings) ? diagnostics.warnings.map(String) : [],
  };
}

function extractPageNumber(citation) {
  const match = String(citation || "").match(/\bPage\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function countDistinctPageNumbers(rows) {
  const pageNumbers = new Set(
    rows
      .map((row) => row.pageNumber)
      .filter((pageNumber) => Number.isSafeInteger(pageNumber)),
  );
  return pageNumbers.size;
}

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required persistence field: ${label}`);
  }
  return value.trim();
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Missing required positive persistence field: ${label}`);
  }
  return value;
}
