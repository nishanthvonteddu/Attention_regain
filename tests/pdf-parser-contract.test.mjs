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
import {
  assessPdfParseSignal,
  extractPdfFile,
  PDF_PARSE_CODES,
  PDF_PARSE_STATUSES,
} from "../src/lib/documents/pdf-parser.js";

test("Day 05 documentation and migration define parse outputs and states", async () => {
  const doc = await readFile(new URL("../docs/pdf-parsing.md", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../db/migrations/0003_document_parse_outputs.sql", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "document_pages",
    "document_parse_diagnostics",
    "ocr_needed",
    "parse_failed",
    "page_number",
  ]) {
    assert.match(doc, new RegExp(expected));
    assert.match(migration, new RegExp(expected));
  }
});

test("PDF parser extracts citation-ready page text from a stable fixture", async () => {
  const file = new File([createTextPdfFixture()], "parser-fixture.pdf", {
    type: "application/pdf",
  });

  const result = await extractPdfFile(file);

  assert.equal(result.ok, true);
  assert.equal(result.status, PDF_PARSE_STATUSES.PARSED);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.equal(result.pages[0].citation, "Page 1");
  assert.match(result.text, /Retrieval practice helps learners rebuild attention/);
  assert.equal(result.diagnostics.code, PDF_PARSE_CODES.READABLE_TEXT);
  assert.ok(result.diagnostics.wordCount >= 18);
});

test("PDF parser separates low-signal and unreadable PDFs from normal flow", async () => {
  const scannedLike = assessPdfParseSignal({
    text: "",
    pages: [],
    pageCount: 3,
  });
  const lowSignal = assessPdfParseSignal({
    text: "Figure 1.",
    pages: [{ pageNumber: 1, text: "Figure 1." }],
    pageCount: 1,
  });
  const invalid = await extractPdfFile(
    new File([new Uint8Array([1, 2, 3, 4])], "broken.pdf", { type: "application/pdf" }),
  );

  assert.equal(scannedLike.status, PDF_PARSE_STATUSES.OCR_NEEDED);
  assert.equal(scannedLike.code, PDF_PARSE_CODES.SCANNED_OR_IMAGE_HEAVY);
  assert.equal(lowSignal.status, PDF_PARSE_STATUSES.OCR_NEEDED);
  assert.equal(lowSignal.code, PDF_PARSE_CODES.LOW_TEXT_SIGNAL);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, PDF_PARSE_STATUSES.PARSE_FAILED);
});

test("repository persists parsed pages and diagnostics for uploaded documents", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-parse-"));
  const store = createLocalJsonStore({ dataDir });
  const repository = createStudyRepository({ store });

  try {
    const upload = await repository.createDocumentUpload({
      user: { id: "reader-1", email: "reader@example.com" },
      documentId: "doc_parse_contract",
      title: "Parser contract",
      goal: "study parser boundaries",
      sourceKind: "pdf",
      file: {
        fileName: "contract.pdf",
        contentType: "application/pdf",
        sizeBytes: 512,
      },
      storage: {
        provider: "s3",
        bucket: "local-private-documents",
        objectKey: "private/users/hash/documents/doc_parse_contract/source/contract.pdf",
        objectUri: "s3://local-private-documents/private/users/hash/documents/doc_parse_contract/source/contract.pdf",
        uploadMode: "metadata-only",
      },
    });

    await repository.saveParsedDocument({
      userId: "reader-1",
      documentId: upload.documentId,
      text: "Retrieval practice asks the learner to rebuild the source before rereading.",
      pages: [
        {
          pageNumber: 1,
          citation: "Page 1",
          text: "Retrieval practice asks the learner to rebuild the source before rereading.",
        },
      ],
      diagnostics: {
        parser: "pdf-parse",
        status: "parsed",
        code: "readable_text",
        reason: "Readable text was extracted.",
        pageCount: 1,
        pagesWithText: 1,
        wordCount: 11,
        characterCount: 76,
        averagePageChars: 76,
        warnings: [],
      },
    });

    const parsed = await repository.getDocumentParseForUser("reader-1", upload.documentId);
    assert.equal(parsed.document.status, "parsed");
    assert.equal(parsed.document.parseStatus, "parsed");
    assert.equal(parsed.pages.length, 1);
    assert.equal(parsed.pages[0].citation, "Page 1");
    assert.equal(parsed.diagnostics.length, 1);
    assert.equal(parsed.diagnostics[0].code, "readable_text");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("study feed route returns explicit parse failure contracts", async () => {
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  const previousEnableLiveGeneration = process.env.ENABLE_LIVE_GENERATION;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-parse-route-"));
  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;
  process.env.ENABLE_LIVE_GENERATION = "false";

  try {
    const { POST, GET } = await import("../src/app/api/study-feed/route.js");
    const { processDocumentProcessingJob } = await import(
      "../src/lib/jobs/document-processing-worker.js"
    );
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "parse-route-reader",
        email: "reader@example.com",
        displayName: "Reader",
        source: "test",
      }),
    );
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "broken.pdf", {
        type: "application/pdf",
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
    const payload = await response.json();

    assert.equal(response.status, 202);
    await processDocumentProcessingJob({ jobId: payload.job.id });

    const workspaceResponse = await GET(
      new Request("http://localhost/api/study-feed", {
        method: "GET",
        headers: {
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    const workspace = await workspaceResponse.json();

    assert.equal(workspaceResponse.status, 200);
    assert.equal(workspace.document.status, PDF_PARSE_STATUSES.PARSE_FAILED);
    assert.equal(workspace.document.parseStatus, PDF_PARSE_STATUSES.PARSE_FAILED);
    assert.match(workspace.document.failureReason, /could not be parsed/i);
  } finally {
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

function createTextPdfFixture() {
  const content = [
    "BT",
    "/F1 14 Tf",
    "72 720 Td",
    `(${escapePdfText("Retrieval practice helps learners rebuild attention from source evidence.")}) Tj`,
    "0 -22 Td",
    `(${escapePdfText("Page citations keep every generated card tied to a source page.")}) Tj`,
    "0 -22 Td",
    `(${escapePdfText("Diagnostics explain whether a PDF needs OCR before generation.")}) Tj`,
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
