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

test("Day 03 documentation defines entities, status transitions, and boundaries", async () => {
  const doc = await readFile(new URL("../docs/data-layer.md", import.meta.url), "utf8");

  for (const expected of [
    "users",
    "documents",
    "document_chunks",
    "study_sessions",
    "study_cards",
    "study_interactions",
    "document_pages",
    "document_parse_diagnostics",
    "Status Transitions",
    "Repository Boundaries",
    "Rollback expectation",
  ]) {
    assert.match(doc, new RegExp(expected));
  }
});

test("core migration covers the MVP persistence tables and ownership keys", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0001_core_schema.sql", import.meta.url),
    "utf8",
  );

  for (const table of [
    "CREATE TABLE users",
    "CREATE TABLE documents",
    "CREATE TABLE document_chunks",
    "CREATE TABLE study_sessions",
    "CREATE TABLE study_cards",
    "CREATE TABLE study_interactions",
  ]) {
    assert.match(migration, new RegExp(table));
  }

  assert.match(migration, /user_id TEXT NOT NULL REFERENCES users\(id\)/);
  assert.match(migration, /status IN \('draft', 'uploaded', 'parsed', 'chunked', 'cards_generated', 'failed'\)/);
  assert.match(migration, /interaction_type IN/);
});

test("repository persists and reloads a generated deck for one user", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-data-"));
  const store = createLocalJsonStore({ dataDir });
  const repository = createStudyRepository({ store });

  try {
    const saved = await repository.saveGeneratedDeck({
      user: {
        id: "user-123",
        email: "reader@example.com",
        displayName: "Reader",
      },
      documentTitle: "Grounded source",
      goal: "remember the main claim",
      sourceKind: "pdf",
      sourceRef: "Grounded source.pdf",
      passages: [
        {
          text: "Retrieval practice asks the learner to reconstruct the source before rereading.",
          citation: "Page 1",
          topics: ["Retrieval"],
        },
      ],
      focusTags: ["Retrieval"],
      generationMode: "fallback",
      model: "heuristic-fallback",
      stats: {
        estimatedMinutes: 4,
        chunkCount: 1,
        cardCount: 1,
      },
      cards: [
        {
          kind: "recall",
          title: "Reconstruct first",
          body: "The card should be grounded in the passage.",
          question: "What should happen before rereading?",
          answer: "The learner reconstructs the source.",
          excerpt: "Retrieval practice asks the learner to reconstruct the source before rereading.",
          citation: "Page 1",
        },
      ],
    });
    const latest = await repository.getLatestDeckForUser("user-123");

    assert.equal(saved.persistence.serverStored, true);
    assert.equal(latest.documentTitle, "Grounded source");
    assert.equal(latest.cards.length, 1);
    assert.equal(latest.cards[0].citation, "Page 1");
    assert.match(latest.cards[0].id, /^card_/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("repository records interaction events inside the user boundary", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-data-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const deck = await repository.saveGeneratedDeck({
      user: { id: "user-123" },
      documentTitle: "Interaction source",
      goal: "track learning actions",
      sourceKind: "paste",
      sourceRef: "",
      passages: [
        {
          text: "Saving cards lets the learner return to the most useful grounded prompts.",
          citation: "Section 1",
          topics: ["Saving"],
        },
      ],
      focusTags: ["Saving"],
      generationMode: "fallback",
      model: "heuristic-fallback",
      stats: { cardCount: 1, chunkCount: 1 },
      cards: [
        {
          kind: "glance",
          title: "Save useful prompts",
          body: "Saved cards remain grounded in the source.",
          excerpt: "Saving cards lets the learner return to the most useful grounded prompts.",
          citation: "Section 1",
        },
      ],
    });
    const interaction = await repository.recordInteraction({
      userId: "user-123",
      sessionId: deck.sessionId,
      cardId: deck.cards[0].id,
      interactionType: "save_card",
      value: "true",
    });
    const latest = await repository.getLatestDeckForUser("user-123");

    assert.match(interaction.id, /^interaction_/);
    assert.equal(latest.cards[0].status, "saved");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("study feed write endpoints reject cross-origin cookie requests", async () => {
  const { POST, PATCH } = await import("../src/app/api/study-feed/route.js");
  const sessionCookie = serializeProductSession(
    createAuthenticatedProductSession({
      userId: "csrf-reader",
      email: "reader@example.com",
      displayName: "Reader",
      source: "test",
    }),
  );
  const formData = new FormData();
  formData.set("sourceText", "A valid source needs enough text to pass parsing. ".repeat(8));

  const postResponse = await POST(
    new Request("http://localhost/api/study-feed", {
      method: "POST",
      body: formData,
      headers: {
        cookie: `attention_regain_session=${sessionCookie}`,
        origin: "https://attacker.example",
      },
    }),
  );
  const patchResponse = await PATCH(
    new Request("http://localhost/api/study-feed", {
      method: "PATCH",
      body: JSON.stringify({
        sessionId: "session-any",
        cardId: "card-any",
        interactionType: "save_card",
      }),
      headers: {
        "content-type": "application/json",
        cookie: `attention_regain_session=${sessionCookie}`,
        origin: "https://attacker.example",
      },
    }),
  );

  assert.equal(postResponse.status, 403);
  assert.equal(patchResponse.status, 403);
});
