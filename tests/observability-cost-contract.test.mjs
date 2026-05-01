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
  createDocumentProcessingPayload,
  DOCUMENT_PROCESSING_MAX_ATTEMPTS,
  DOCUMENT_PROCESSING_QUEUE,
} from "../src/lib/jobs/document-processing.js";
import { processDocumentProcessingJob } from "../src/lib/jobs/document-processing-worker.js";
import { estimateModelCost } from "../src/lib/observability/product-events.js";

test("Day 13 docs and migration define observability, latency, and cost contracts", async () => {
  const doc = await readFile(new URL("../docs/observability-cost.md", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../db/migrations/0008_observability_cost_tracking.sql", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "upload.prepared",
    "parse.succeeded",
    "generation.fallback",
    "feed.ready",
    "time-to-first-feed",
    "modelCost",
    "observability_events",
    "latency_ms",
    "cost JSONB",
  ]) {
    assert.match(doc + migration, new RegExp(expected));
  }
});

test("repository records product events and summarizes operational health", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-ops-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const document = await repository.createDocumentRecord({
      user: { id: "ops-user", email: "ops@example.com" },
      title: "Ops source",
      goal: "inspect product health",
      sourceKind: "paste",
      sourceRef: "inline://ops-source",
    });
    await repository.recordProductEvent({
      eventName: "generation.queued",
      stage: "queue",
      status: "queued",
      userId: "ops-user",
      documentId: document.id,
      latencyMs: 14,
      payload: { sourceKind: "paste" },
    });
    await repository.recordProductEvent({
      eventName: "feed.ready",
      stage: "feed",
      status: "succeeded",
      userId: "ops-user",
      documentId: document.id,
      latencyMs: 240,
      cost: {
        currency: "USD",
        estimated: true,
        model: "heuristic-fallback",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputCostUsd: 0,
        outputCostUsd: 0,
        estimatedCostUsd: 0,
      },
    });

    const report = await repository.getOperationalReportForUser("ops-user");

    assert.equal(report.totals.documentCount, 1);
    assert.equal(report.totals.eventCount, 2);
    assert.equal(report.latency.timeToFirstFeedMs, 240);
    assert.equal(report.documents[0].firstFeedLatencyMs, 240);
    assert.equal(report.latestEvents[0].eventName, "feed.ready");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("model cost estimates preserve sub-cent USD amounts", () => {
  const cost = estimateModelCost({
    model: "test-model",
    usage: {
      prompt_tokens: 1500,
      completion_tokens: 500,
    },
  });

  assert.equal(cost.inputCostUsd, 0.0003);
  assert.equal(cost.outputCostUsd, 0.0001);
  assert.equal(cost.estimatedCostUsd, 0.0004);
});

test("worker emits parse, generation, cost, and ready-feed events", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-worker-ops-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const document = await repository.createDocumentRecord({
      user: { id: "worker-ops-user", email: "worker@example.com" },
      title: "Worker observability",
      goal: "measure the background path",
      sourceKind: "paste",
      sourceRef: "inline://worker-observability",
    });
    const job = await repository.enqueueDocumentProcessingJob({
      userId: "worker-ops-user",
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
          text:
            "Operational visibility helps support inspect upload, parsing, generation, and failure signals without reading raw infrastructure logs. Time to first feed should be measurable from queue creation through ready cards.",
        },
      }),
    });

    await processDocumentProcessingJob({
      jobId: job.id,
      repository,
      env: { ENABLE_LIVE_GENERATION: "false" },
    });
    const report = await repository.getOperationalReportForUser("worker-ops-user");
    const eventNames = report.latestEvents.map((event) => event.eventName);
    const workspace = await repository.getLatestWorkspaceForUser("worker-ops-user");

    assert.ok(eventNames.includes("parse.succeeded"));
    assert.ok(eventNames.includes("chunking.succeeded"));
    assert.ok(eventNames.includes("generation.fallback"));
    assert.ok(eventNames.includes("feed.ready"));
    assert.equal(report.totals.estimatedSpendUsd, 0);
    assert.ok(report.latency.timeToFirstFeedMs >= 0);
    assert.equal(workspace.deck.stats.modelCost.estimatedCostUsd, 0);
    assert.ok(workspace.deck.stats.pipelineTiming.parseMs >= 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("operations report route requires an authenticated session", async () => {
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-ops-route-"));
  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;

  try {
    const { GET } = await import("../src/app/api/operations/report/route.js");
    const unauthenticated = await GET(new Request("http://localhost/api/operations/report"));
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "route-ops-user",
        email: "route@example.com",
        displayName: "Route Reader",
        source: "test",
      }),
    );
    const authenticated = await GET(
      new Request("http://localhost/api/operations/report", {
        headers: {
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    const payload = await authenticated.json();

    assert.equal(unauthenticated.status, 401);
    assert.equal(authenticated.status, 200);
    assert.equal(payload.report.totals.eventCount, 0);
  } finally {
    if (typeof previousDataDir === "string") {
      process.env.ATTENTION_REGAIN_DATA_DIR = previousDataDir;
    } else {
      delete process.env.ATTENTION_REGAIN_DATA_DIR;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
