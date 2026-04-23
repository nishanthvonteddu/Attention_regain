import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalJsonStore } from "../src/lib/data/local-store.js";
import { createStudyRepository } from "../src/lib/data/repositories.js";
import {
  createDocumentProcessingPayload,
  DOCUMENT_PROCESSING_MAX_ATTEMPTS,
  DOCUMENT_PROCESSING_QUEUE,
} from "../src/lib/jobs/document-processing.js";
import { processDocumentProcessingJob } from "../src/lib/jobs/document-processing-worker.js";

test("Day 06 docs and migration define the queue contract and worker lifecycle", async () => {
  const doc = await readFile(new URL("../docs/background-worker.md", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../db/migrations/0004_document_processing_jobs.sql", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "queueName",
    "document-processing",
    "Worker Entry Point",
    "Retry And Dead-Letter Rules",
    "document_processing_jobs",
    "dead_letter",
    "processing",
    "queued",
  ]) {
    assert.match(doc + migration, new RegExp(expected));
  }
});

test("repository-backed worker turns a queued text job into a ready deck", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-queue-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const document = await repository.createDocumentRecord({
      user: { id: "worker-user", email: "worker@example.com" },
      title: "Queued source",
      goal: "verify background generation",
      sourceKind: "paste",
      sourceRef: "inline://pasted-source",
    });
    const job = await repository.enqueueDocumentProcessingJob({
      userId: "worker-user",
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
          text: "Retrieval practice works best when a learner reconstructs the idea before rereading. Grounded cards need citations so the answer can be verified against the source. Durable background jobs keep parsing and generation out of the request path.",
        },
      }),
    });

    const result = await processDocumentProcessingJob({
      jobId: job.id,
      repository,
      env: { ENABLE_LIVE_GENERATION: "false" },
    });
    const workspace = await repository.getLatestWorkspaceForUser("worker-user");

    assert.equal(result.generationMode, "fallback");
    assert.equal(workspace.job.status, "succeeded");
    assert.equal(workspace.document.status, "cards_generated");
    assert.equal(workspace.document.parseStatus, "parsed");
    assert.ok(workspace.deck);
    assert.ok(workspace.deck.cards.length > 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("worker dead-letters malformed jobs after bounded retries", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-dead-letter-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const document = await repository.createDocumentRecord({
      user: { id: "dead-letter-user" },
      title: "Broken source",
      goal: "exercise retry handling",
      sourceKind: "paste",
      sourceRef: "inline://broken-source",
    });
    const job = await repository.enqueueDocumentProcessingJob({
      userId: "dead-letter-user",
      documentId: document.id,
      queueName: DOCUMENT_PROCESSING_QUEUE,
      maxAttempts: 3,
      payload: createDocumentProcessingPayload({
        documentId: document.id,
        title: document.title,
        goal: document.goal,
        source: { type: "unsupported" },
      }),
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await processDocumentProcessingJob({ jobId: job.id, repository });
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }

    const finalJob = await repository.getDocumentProcessingJob(job.id);
    const workspace = await repository.getLatestWorkspaceForUser("dead-letter-user");

    assert.equal(finalJob.status, "dead_letter");
    assert.equal(workspace.document.status, "failed");
    assert.match(workspace.document.failureReason, /Unsupported document-processing job payload/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
