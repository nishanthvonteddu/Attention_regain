import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  DOCUMENT_PROCESSING_QUEUE,
} from "../src/lib/jobs/document-processing.js";

test("Day 09 resume docs and migration define persisted comeback state", async () => {
  const { readFile } = await import("node:fs/promises");
  const doc = await readFile(new URL("../docs/resume-flow.md", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../db/migrations/0006_session_resume_state.sql", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "GET /api/study-feed",
    "last active document",
    "deck.feedback",
    "ready",
    "processing",
    "failed",
  ]) {
    assert.match(doc, new RegExp(expected));
  }

  assert.match(migration, /study_sessions_user_updated_idx/);
  assert.match(migration, /study_interactions_session_card_created_idx/);
});

test("repository restores the last active ready session with persisted feedback", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-resume-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const firstDeck = await repository.saveGeneratedDeck(buildDeckInput({
      userId: "resume-user",
      documentTitle: "Earlier source",
      citation: "Page 1",
    }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repository.saveGeneratedDeck(buildDeckInput({
      userId: "resume-user",
      documentTitle: "Later source",
      citation: "Page 2",
    }));

    let workspace = await repository.getLatestWorkspaceForUser("resume-user");
    assert.equal(workspace.deck.documentTitle, "Later source");
    assert.equal(workspace.resume.status, "ready");

    await new Promise((resolve) => setTimeout(resolve, 5));
    await repository.recordInteraction({
      userId: "resume-user",
      sessionId: firstDeck.sessionId,
      cardId: firstDeck.cards[0].id,
      interactionType: "save_card",
      value: "true",
    });
    await repository.recordInteraction({
      userId: "resume-user",
      sessionId: firstDeck.sessionId,
      cardId: firstDeck.cards[0].id,
      interactionType: "set_confidence",
      value: "locked",
    });
    await repository.recordInteraction({
      userId: "resume-user",
      sessionId: firstDeck.sessionId,
      cardId: firstDeck.cards[0].id,
      interactionType: "reveal_answer",
      value: "true",
    });

    workspace = await repository.getLatestWorkspaceForUser("resume-user");
    const feedback = workspace.deck.feedback[firstDeck.cards[0].id];

    assert.equal(workspace.deck.documentTitle, "Earlier source");
    assert.equal(workspace.resume.documentId, firstDeck.documentId);
    assert.equal(workspace.resume.label, "Resume ready feed");
    assert.equal(feedback.saved, true);
    assert.equal(feedback.confidence, "locked");
    assert.equal(feedback.revealed, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("study feed GET restores server state after a refresh-like route load", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-route-resume-"));
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;

  try {
    const { POST, GET, PATCH } = await import("../src/app/api/study-feed/route.js");
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "route-resume-user",
        email: "reader@example.com",
        displayName: "Resume Reader",
        source: "test",
      }),
    );
    const formData = new FormData();
    formData.set("title", "Route resume source");
    formData.set("goal", "validate persisted resume loading");
    formData.set(
      "sourceText",
      "Server backed resume state should survive refreshes. ".repeat(24),
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
    const accepted = await response.json();
    assert.equal(response.status, 202);

    const { processDocumentProcessingJob } = await import(
      "../src/lib/jobs/document-processing-worker.js"
    );
    await processDocumentProcessingJob({ jobId: accepted.job.id });

    const readyResponse = await GET(
      new Request("http://localhost/api/study-feed", {
        method: "GET",
        headers: {
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    const ready = await readyResponse.json();
    assert.equal(readyResponse.status, 200);
    assert.equal(ready.resume.status, "ready");
    assert.equal(ready.deck.persistence.resumeSource, "server");

    const patchResponse = await PATCH(
      new Request("http://localhost/api/study-feed", {
        method: "PATCH",
        body: JSON.stringify({
          sessionId: ready.deck.sessionId,
          cardId: ready.deck.cards[0].id,
          interactionType: "set_confidence",
          value: "review",
        }),
        headers: {
          "content-type": "application/json",
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    assert.equal(patchResponse.status, 200);

    const resumedResponse = await GET(
      new Request("http://localhost/api/study-feed", {
        method: "GET",
        headers: {
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    const resumed = await resumedResponse.json();

    assert.equal(resumed.deck.feedback[ready.deck.cards[0].id].confidence, "review");
    assert.equal(resumed.resume.label, "Resume ready feed");
  } finally {
    if (typeof previousDataDir === "string") {
      process.env.ATTENTION_REGAIN_DATA_DIR = previousDataDir;
    } else {
      delete process.env.ATTENTION_REGAIN_DATA_DIR;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("repository exposes distinct processing and failed resume states", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-state-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const document = await repository.createDocumentRecord({
      user: { id: "state-user" },
      title: "Queued source",
      goal: "inspect state views",
      sourceKind: "paste",
      sourceRef: "inline://state-source",
    });
    const job = await repository.enqueueDocumentProcessingJob({
      userId: "state-user",
      documentId: document.id,
      queueName: DOCUMENT_PROCESSING_QUEUE,
      maxAttempts: 1,
      payload: createDocumentProcessingPayload({
        documentId: document.id,
        title: document.title,
        goal: document.goal,
        source: {
          type: "inline_text",
          sourceKind: "paste",
          text: "A queued document keeps processing visible before cards exist.",
        },
      }),
    });

    let workspace = await repository.getLatestWorkspaceForUser("state-user");
    assert.equal(workspace.resume.status, "processing");
    assert.equal(workspace.deck, null);

    await repository.claimDocumentProcessingJob({ jobId: job.id, workerId: "test-worker" });
    await repository.failDocumentProcessingJob({
      jobId: job.id,
      errorMessage: "Generation failed permanently.",
      retryDelayMs: 250,
    });

    workspace = await repository.getLatestWorkspaceForUser("state-user");
    assert.equal(workspace.document.status, "failed");
    assert.equal(workspace.resume.status, "failed");
    assert.match(workspace.resume.detail, /Generation failed permanently/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function buildDeckInput({ userId, documentTitle, citation }) {
  const passage = `${documentTitle} explains that durable sessions let a learner leave and return without losing grounded study cards.`;

  return {
    user: { id: userId, email: "reader@example.com", displayName: "Reader" },
    documentTitle,
    goal: "resume the previous study context",
    sourceKind: "pdf",
    sourceRef: `${documentTitle}.pdf`,
    passages: [
      {
        text: passage,
        citation,
        topics: ["Resume"],
      },
    ],
    focusTags: ["Resume"],
    generationMode: "fallback",
    model: "heuristic-fallback",
    stats: { cardCount: 1, chunkCount: 1 },
    cards: [
      {
        kind: "recall",
        title: "Resume without losing state",
        body: "The card is grounded in the persisted source passage.",
        question: "What should a durable session preserve?",
        answer: "Grounded study cards and learning actions.",
        excerpt: passage,
        citation,
      },
    ],
  };
}
