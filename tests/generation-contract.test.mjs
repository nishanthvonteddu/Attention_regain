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
import {
  createStudyRepository,
  getDefaultStudyRepository,
} from "../src/lib/data/repositories.js";
import {
  assertPersistableGeneratedDeck,
  GENERATED_CARD_CONTRACT_VERSION,
  validateGeneratedDeckContract,
} from "../src/lib/study/card-contract.js";
import { runDocumentPipeline } from "../src/lib/study/pipeline.js";
import {
  createDocumentProcessingPayload,
  DOCUMENT_PROCESSING_QUEUE,
} from "../src/lib/jobs/document-processing.js";
import { processDocumentProcessingJob } from "../src/lib/jobs/document-processing-worker.js";

const PASSAGES = [
  {
    id: "chunk-grounded-1",
    sequence: 0,
    citation: "Page 1, paragraphs 1-2",
    pageNumber: 1,
    paragraphStart: 1,
    paragraphEnd: 2,
    text:
      "Grounded generation requires every card to carry a citation and an excerpt from the retrieved source passage. Invalid cards are rejected before persistence.",
    sentences: [
      "Grounded generation requires every card to carry a citation and an excerpt from the retrieved source passage.",
      "Invalid cards are rejected before persistence.",
    ],
    topics: ["Grounded", "Citation"],
  },
];

test("Day 08 docs define the generated-card contract and failure path", async () => {
  const doc = await readFile(new URL("../docs/generation-contract.md", import.meta.url), "utf8");

  for (const expected of [
    "day08.generated-card.v1",
    "sourceReference",
    "uncited",
    "revalidates",
    "generationFailure",
    "retried from the stored job payload",
  ]) {
    assert.match(doc, new RegExp(expected));
  }
});

test("Day 08 card contract repairs safe fields and rejects uncited cards", () => {
  const result = validateGeneratedDeckContract({
    payload: {
      focusTags: ["grounding"],
      cards: [
        {
          kind: "unknown",
          title: "Contract repair",
          body: "The validator can repair a safe kind while keeping source grounding strict.",
          citation: PASSAGES[0].citation,
        },
        {
          kind: "recall",
          title: "Uncited card",
          body: "This card cites a passage that was not retrieved.",
          question: "Why is this invalid?",
          answer: "The citation is not in the retrieved passage set.",
          excerpt: "This sentence is not in the retrieved passage set.",
          citation: "Page 99",
        },
      ],
    },
    passages: PASSAGES,
  });

  assert.equal(result.version, GENERATED_CARD_CONTRACT_VERSION);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].kind, "glance");
  assert.equal(result.cards[0].citation, PASSAGES[0].citation);
  assert.equal(result.cards[0].sourceReference.chunkId, PASSAGES[0].id);
  assert.equal(result.stats.repairedCardCount, 1);
  assert.equal(result.stats.rejectedCardCount, 1);
});

test("Day 08 persistence refuses cards without grounded source references", () => {
  assert.throws(
    () =>
      assertPersistableGeneratedDeck({
        passages: PASSAGES,
        cards: [
          {
            kind: "glance",
            title: "Invalid source",
            body: "The card is missing a valid source citation.",
            excerpt: "The card is missing a valid source citation.",
            citation: "Missing citation",
          },
        ],
      }),
    /did not satisfy the card contract/,
  );
});

test("Day 08 malformed model output falls back without storing invalid cards", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-generation-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                focusTags: ["bad-output"],
                cards: [
                  {
                    kind: "recall",
                    title: "Invented card",
                    body: "This card is not grounded in the retrieved source.",
                    question: "What did the model invent?",
                    answer: "A fact outside the source.",
                    excerpt: "A sentence that is not in the retrieved passage.",
                    citation: "Made up citation",
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const document = await repository.createDocumentRecord({
      user: { id: "generation-user", email: "reader@example.com" },
      title: "Generation hardening",
      goal: "verify grounded generation",
      sourceKind: "paste",
      sourceRef: "inline://generation-hardening",
    });
    const result = await runDocumentPipeline({
      documentId: document.id,
      title: document.title,
      goal: document.goal,
      source: {
        type: "inline_text",
        sourceKind: "paste",
        text:
          "Grounded generation protects users by validating every generated study card before it is stored. Citations must point to retrieved source chunks, and malformed model responses should fall back to deterministic cards instead of corrupting document state.",
      },
      user: { id: "generation-user" },
      repository,
      env: {
        ENABLE_LIVE_GENERATION: "true",
        NVIDIA_TEXT_API_KEY: "test-key",
        NVIDIA_TEXT_MODEL: "test-model",
      },
    });
    const workspace = await repository.getLatestWorkspaceForUser("generation-user");

    assert.equal(result.generationMode, "fallback");
    assert.equal(workspace.document.status, "cards_generated");
    assert.equal(workspace.deck.stats.generationFailure.code, "generation_contract_failed");
    assert.ok(workspace.deck.cards.length > 0);
    assert.ok(workspace.deck.cards.every((card) => card.chunkId));
    assert.ok(workspace.deck.cards.every((card) => card.sourceReference?.citation));
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Day 08 failed document jobs can be retried from stored payloads", async () => {
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-retry-"));
  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;

  try {
    const repository = getDefaultStudyRepository();
    const document = await repository.createDocumentRecord({
      user: { id: "retry-user", email: "reader@example.com" },
      title: "Retry source",
      goal: "verify retry handling",
      sourceKind: "paste",
      sourceRef: "inline://retry-source",
    });
    const job = await repository.enqueueDocumentProcessingJob({
      userId: "retry-user",
      documentId: document.id,
      queueName: DOCUMENT_PROCESSING_QUEUE,
      maxAttempts: 1,
      payload: createDocumentProcessingPayload({
        documentId: document.id,
        title: document.title,
        goal: document.goal,
        source: { type: "unsupported" },
      }),
    });
    await processDocumentProcessingJob({ jobId: job.id, repository });

    const { POST } = await import("../src/app/api/study-feed/route.js");
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "retry-user",
        email: "reader@example.com",
        displayName: "Retry Reader",
        source: "test",
      }),
    );
    const formData = new FormData();
    formData.set("retryDocumentId", document.id);
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
    assert.equal(payload.retried, true);
    assert.equal(payload.document.status, "queued");
    assert.equal(payload.job.status, "queued");
  } finally {
    if (typeof previousDataDir === "string") {
      process.env.ATTENTION_REGAIN_DATA_DIR = previousDataDir;
    } else {
      delete process.env.ATTENTION_REGAIN_DATA_DIR;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
