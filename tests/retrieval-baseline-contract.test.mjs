import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalJsonStore } from "../src/lib/data/local-store.js";
import { createStudyRepository } from "../src/lib/data/repositories.js";
import {
  buildDocumentChunks,
  selectRetrievalPassages,
} from "../src/lib/study/chunking.js";
import {
  createDocumentProcessingPayload,
  DOCUMENT_PROCESSING_MAX_ATTEMPTS,
  DOCUMENT_PROCESSING_QUEUE,
} from "../src/lib/jobs/document-processing.js";
import { processDocumentProcessingJob } from "../src/lib/jobs/document-processing-worker.js";

test("Day 07 chunking preserves page, paragraph, order, and citation metadata", () => {
  const chunks = buildDocumentChunks([
    {
      pageNumber: 1,
      citation: "Page 1",
      text: [
        "Foundations",
        "Retrieval practice starts when a learner reconstructs an idea before rereading it. The source wording remains available for verification after the attempt.",
        "Grounded cards should carry compact excerpts and citations so answers can be checked without guessing.",
      ].join("\n\n"),
    },
    {
      pageNumber: 2,
      citation: "Page 2",
      text: [
        "Chunk Metadata",
        "Paragraph-aware chunking keeps source locations stable. A card can point to a page and paragraph range even when the generation prompt uses only selected chunks.",
      ].join("\n\n"),
    },
  ]);

  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.map((chunk) => chunk.sequence), chunks.map((_, index) => index));
  assert.ok(chunks.every((chunk) => /^Page \d+, paragraph/.test(chunk.citation)));
  assert.ok(chunks.every((chunk) => Number.isSafeInteger(chunk.pageNumber)));
  assert.ok(chunks.every((chunk) => Number.isSafeInteger(chunk.paragraphStart)));
  assert.ok(chunks.every((chunk) => Number.isSafeInteger(chunk.paragraphEnd)));
  assert.ok(chunks.every((chunk) => chunk.paragraphEnd >= chunk.paragraphStart));
  assert.ok(chunks.every((chunk) => chunk.tokenEstimate > 0));
});

test("Day 07 retrieval selects deterministic chunks and defines low-confidence fallback", () => {
  const chunks = buildDocumentChunks([
    {
      pageNumber: 1,
      text: buildParagraphs("general overview", 10),
    },
    {
      pageNumber: 2,
      text: buildParagraphs("retrieval calibration citation metadata", 10),
    },
  ]);

  const focused = selectRetrievalPassages(chunks, {
    title: "Grounded retrieval",
    goal: "study retrieval calibration and citation metadata",
    maxPassages: 4,
  });
  const fallback = selectRetrievalPassages(chunks, {
    title: "",
    goal: "",
    maxPassages: 4,
  });

  assert.equal(focused.stats.strategy, "keyword-overlap");
  assert.equal(focused.passages.length, 4);
  assert.ok(focused.passages.every((chunk) => chunk.retrieval.reason === "query_term_overlap"));
  assert.ok(
    focused.passages.some((chunk) => /retrieval calibration citation metadata/i.test(chunk.text)),
  );
  assert.equal(fallback.stats.strategy, "even-spread-fallback");
  assert.equal(fallback.stats.lowConfidence, true);
  assert.equal(fallback.passages.length, 4);
});

test("repository worker persists all chunks and links generated cards to retrieved chunks", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-retrieval-"));
  const store = createLocalJsonStore({ dataDir });
  const repository = createStudyRepository({ store });

  try {
    const document = await repository.createDocumentRecord({
      user: { id: "retrieval-user", email: "retrieval@example.com" },
      title: "Large retrieval source",
      goal: "study retrieval calibration and citation metadata",
      sourceKind: "paste",
      sourceRef: "inline://large-retrieval-source",
    });
    const job = await repository.enqueueDocumentProcessingJob({
      userId: "retrieval-user",
      documentId: document.id,
      queueName: DOCUMENT_PROCESSING_QUEUE,
      maxAttempts: DOCUMENT_PROCESSING_MAX_ATTEMPTS,
      payload: createDocumentProcessingPayload({
        documentId: document.id,
        title: document.title,
        goal: document.goal,
        source: {
          type: "inline_text",
          sourceKind: "paste",
          text: [
            buildParagraphs("general learning overview", 12),
            buildParagraphs("retrieval calibration citation metadata", 12),
          ].join("\n\n"),
        },
      }),
    });

    const result = await processDocumentProcessingJob({
      jobId: job.id,
      repository,
      env: { ENABLE_LIVE_GENERATION: "false" },
    });
    const raw = await store.read();
    const workspace = await repository.getLatestWorkspaceForUser("retrieval-user");
    const chunks = raw.documentChunks.filter((chunk) => chunk.documentId === document.id);
    const selectedChunks = chunks.filter((chunk) => Number.isSafeInteger(chunk.retrievalRank));
    const selectedChunkIds = new Set(selectedChunks.map((chunk) => chunk.id));

    assert.equal(result.generationMode, "fallback");
    assert.equal(workspace.document.status, "cards_generated");
    assert.ok(chunks.length > workspace.deck.stats.retrievedChunkCount);
    assert.equal(selectedChunks.length, workspace.deck.stats.retrievedChunkCount);
    assert.ok(chunks.every((chunk) => /^Page \d+, paragraph/.test(chunk.citation)));
    assert.ok(chunks.every((chunk) => Number.isSafeInteger(chunk.pageNumber)));
    assert.ok(chunks.every((chunk) => chunk.sectionLabel));
    assert.ok(workspace.deck.cards.length > 0);
    assert.ok(workspace.deck.cards.every((card) => selectedChunkIds.has(card.chunkId)));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Day 07 docs and migration describe chunk retrieval tuning", async () => {
  const notes = await readFile(new URL("../docs/retrieval-baseline.md", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../db/migrations/0005_chunk_retrieval_metadata.sql", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "paragraphStart",
    "paragraphEnd",
    "retrieval_rank",
    "even spread",
    "maxRetrievedChunks",
  ]) {
    assert.match(notes + migration, new RegExp(expected.replace(/[A-Z]/g, (letter) => letter)));
  }
});

function buildParagraphs(topic, count) {
  return Array.from({ length: count }, (_, index) => {
    return [
      `${topic} paragraph ${index + 1} explains how source-grounded study cards keep facts tied to the document.`,
      "The learner should see enough context to recall the point while the app keeps citations precise and reviewable.",
      "This paragraph is intentionally long enough to stand as a stable retrieval unit in contract tests.",
    ].join(" ");
  }).join("\n\n");
}
