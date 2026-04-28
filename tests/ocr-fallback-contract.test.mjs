import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAuthenticatedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";
import { createLocalJsonStore } from "../src/lib/data/local-store.js";
import { createStudyRepository } from "../src/lib/data/repositories.js";
import { PDF_PARSE_STATUSES } from "../src/lib/documents/pdf-parser.js";
import { MANUAL_REPROCESS_MAX_JOBS } from "../src/lib/documents/ocr-routing.js";
import {
  createDocumentProcessingPayload,
  DOCUMENT_PROCESSING_MAX_ATTEMPTS,
  DOCUMENT_PROCESSING_QUEUE,
} from "../src/lib/jobs/document-processing.js";
import { processDocumentProcessingJob } from "../src/lib/jobs/document-processing-worker.js";

test("Day 11 docs define OCR fallback recovery ownership", async () => {
  const doc = await readFile(new URL("../docs/ocr-fallback.md", import.meta.url), "utf8");
  const workerDoc = await readFile(
    new URL("../docs/background-worker.md", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "ocr_needed",
    "parse_failed",
    "manual reprocess",
    "bounded",
    "document-processing-worker",
  ]) {
    assert.match(doc + workerDoc, new RegExp(expected, "i"));
  }
});

test("low-signal PDFs enter OCR-needed recovery without generating cards", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-ocr-needed-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const { document, job } = await createLowSignalPdfJob({ repository });

    const result = await processDocumentProcessingJob({
      jobId: job.id,
      repository,
      env: { ENABLE_LIVE_GENERATION: "false" },
    });
    const workspace = await repository.getLatestWorkspaceForUser("ocr-reader");

    assert.equal(result.outcome, "terminal");
    assert.equal(result.documentStatus, PDF_PARSE_STATUSES.OCR_NEEDED);
    assert.equal(result.recovery.kind, "ocr_needed");
    assert.equal(workspace.job.status, "succeeded");
    assert.equal(workspace.job.resultStatus, PDF_PARSE_STATUSES.OCR_NEEDED);
    assert.equal(workspace.document.id, document.id);
    assert.equal(workspace.document.status, PDF_PARSE_STATUSES.OCR_NEEDED);
    assert.equal(workspace.document.parseStatus, PDF_PARSE_STATUSES.OCR_NEEDED);
    assert.equal(workspace.deck, null);
    assert.equal(workspace.recovery.kind, "ocr_needed");
    assert.equal(workspace.recovery.actionLabel, "Reprocess source");
    assert.equal(workspace.recovery.canRetry, true);
    assert.equal(workspace.recovery.remainingManualAttempts, MANUAL_REPROCESS_MAX_JOBS - 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("manual OCR reprocess requests are bounded and explicit", async () => {
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  const previousEnableLiveGeneration = process.env.ENABLE_LIVE_GENERATION;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-ocr-retry-"));
  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;
  process.env.ENABLE_LIVE_GENERATION = "false";

  try {
    const repository = createStudyRepository({
      store: createLocalJsonStore({ dataDir }),
    });
    const { document, payload } = await createLowSignalPdfJob({ repository });

    for (let index = 0; index < MANUAL_REPROCESS_MAX_JOBS; index += 1) {
      const job = index === 0
        ? await repository.getLatestDocumentProcessingJobForUser("ocr-reader", document.id)
        : await repository.enqueueDocumentProcessingJob({
            userId: "ocr-reader",
            documentId: document.id,
            queueName: DOCUMENT_PROCESSING_QUEUE,
            maxAttempts: DOCUMENT_PROCESSING_MAX_ATTEMPTS,
            payload,
          });
      await processDocumentProcessingJob({
        jobId: job.id,
        repository,
        env: { ENABLE_LIVE_GENERATION: "false" },
      });
    }

    const workspace = await repository.getLatestWorkspaceForUser("ocr-reader");
    assert.equal(workspace.recovery.canRetry, false);
    assert.match(workspace.recovery.blockedReason, /manual reprocess limit/i);

    const { POST } = await import("../src/app/api/study-feed/route.js");
    const formData = new FormData();
    formData.set("retryDocumentId", document.id);
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "ocr-reader",
        email: "reader@example.com",
        displayName: "OCR Reader",
        source: "test",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/study-feed", {
        method: "POST",
        body: formData,
        headers: {
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    const payloadResponse = await response.json();

    assert.equal(response.status, 409);
    assert.match(payloadResponse.error, /manual reprocess limit/i);
    assert.equal(payloadResponse.recovery.canRetry, false);
  } finally {
    const { waitForScheduledDocumentJobs } = await import(
      "../src/lib/jobs/document-processing-worker.js"
    );
    await waitForScheduledDocumentJobs();

    if (typeof previousDataDir === "string") {
      process.env.ATTENTION_REGAIN_DATA_DIR = previousDataDir;
    } else {
      delete process.env.ATTENTION_REGAIN_DATA_DIR;
    }
    if (typeof previousEnableLiveGeneration === "string") {
      process.env.ENABLE_LIVE_GENERATION = previousEnableLiveGeneration;
    } else {
      delete process.env.ENABLE_LIVE_GENERATION;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function createLowSignalPdfJob({ repository }) {
  const document = await repository.createDocumentRecord({
    user: { id: "ocr-reader", email: "reader@example.com" },
    title: "Scanned handout",
    goal: "recover low signal PDFs",
    sourceKind: "pdf",
    sourceRef: "inline://low-signal-pdf",
  });
  const source = {
    type: "inline_file",
    fileName: "scanned-handout.pdf",
    contentType: "application/pdf",
    sizeBytes: createLowSignalPdfFixture().byteLength,
    sourceKind: "pdf",
    base64: Buffer.from(createLowSignalPdfFixture()).toString("base64"),
  };
  const payload = createDocumentProcessingPayload({
    documentId: document.id,
    title: document.title,
    goal: document.goal,
    source,
  });
  const job = await repository.enqueueDocumentProcessingJob({
    userId: "ocr-reader",
    documentId: document.id,
    queueName: DOCUMENT_PROCESSING_QUEUE,
    maxAttempts: DOCUMENT_PROCESSING_MAX_ATTEMPTS,
    payload,
  });

  return { document, job, payload };
}

function createLowSignalPdfFixture() {
  const content = [
    "BT",
    "/F1 14 Tf",
    "72 720 Td",
    `(${escapePdfText("Figure 1.")}) Tj`,
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

function escapePdfText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
