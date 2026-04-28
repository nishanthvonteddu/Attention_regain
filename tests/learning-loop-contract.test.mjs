import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalJsonStore } from "../src/lib/data/local-store.js";
import { createStudyRepository } from "../src/lib/data/repositories.js";

test("Day 10 docs and migration define the learning-loop contract", async () => {
  const doc = await readFile(new URL("../docs/learning-loop.md", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../db/migrations/0007_learning_loop_progress.sql", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "save_card",
    "set_confidence=review",
    "set_confidence=locked",
    "deck.progress",
    "card.resurfacing",
    "Saved and weak cards are intentionally distinct",
  ]) {
    assert.match(doc, new RegExp(expected));
  }

  assert.match(migration, /study_interactions_card_type_created_idx/);
  assert.match(migration, /study_cards_document_status_sequence_idx/);
});

test("repository derives durable learning actions, progress, and latest-state semantics", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-learning-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const deck = await repository.saveGeneratedDeck(buildLearningDeckInput());
    const first = deck.cards[0];
    const second = deck.cards[1];
    const third = deck.cards[2];

    await repository.recordInteraction({
      userId: "learning-user",
      sessionId: deck.sessionId,
      cardId: first.id,
      interactionType: "save_card",
      value: "true",
    });
    await repository.recordInteraction({
      userId: "learning-user",
      sessionId: deck.sessionId,
      cardId: first.id,
      interactionType: "unsave_card",
      value: "true",
    });
    await repository.recordInteraction({
      userId: "learning-user",
      sessionId: deck.sessionId,
      cardId: second.id,
      interactionType: "set_confidence",
      value: "review",
    });
    await repository.recordInteraction({
      userId: "learning-user",
      sessionId: deck.sessionId,
      cardId: third.id,
      interactionType: "set_confidence",
      value: "locked",
    });
    await repository.recordInteraction({
      userId: "learning-user",
      sessionId: deck.sessionId,
      cardId: third.id,
      interactionType: "reveal_answer",
      value: "true",
    });

    const workspace = await repository.getLatestWorkspaceForUser("learning-user");
    const refreshedDeck = workspace.deck;

    assert.equal(refreshedDeck.feedback[first.id].saved, false);
    assert.equal(refreshedDeck.feedback[second.id].confidence, "review");
    assert.equal(refreshedDeck.feedback[third.id].confidence, "locked");
    assert.equal(refreshedDeck.feedback[third.id].revealed, true);
    assert.equal(refreshedDeck.progress.totalCards, 3);
    assert.equal(refreshedDeck.progress.reviewAgainCards, 1);
    assert.equal(refreshedDeck.progress.lockedCards, 1);
    assert.equal(refreshedDeck.progress.completionPercent, 33);
    assert.equal(refreshedDeck.progress.status, "review_needed");
    assert.equal(refreshedDeck.cards[0].id, second.id);
    assert.equal(refreshedDeck.cards.at(-1).id, third.id);
    assert.equal(refreshedDeck.cards[0].resurfacing.queue, "review_again");
    assert.equal(refreshedDeck.cards.at(-1).resurfacing.queue, "locked");
    assert.equal(refreshedDeck.sessionSummary.queue.nextCardId, second.id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("study UI exposes progress and learning-state controls", async () => {
  const component = await readFile(
    new URL("../src/components/study-workspace.js", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "LearningProgressStrip",
    "Review again",
    "Locked in",
    "Returns early next session",
    "Moved later in the queue",
    "queuePosition",
  ]) {
    assert.match(component, new RegExp(expected));
  }
});

test("repository rejects ambiguous confidence actions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-confidence-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const deck = await repository.saveGeneratedDeck(buildLearningDeckInput());
    await assert.rejects(
      repository.recordInteraction({
        userId: "learning-user",
        sessionId: deck.sessionId,
        cardId: deck.cards[0].id,
        interactionType: "set_confidence",
        value: "maybe",
      }),
      /Confidence must be locked, review, or empty/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function buildLearningDeckInput() {
  const passages = [
    {
      text: "A learning loop persists every card action so progress can be restored later.",
      citation: "Page 1",
      topics: ["Persistence"],
    },
    {
      text: "Weak cards should return before lower-risk cards in a focused review queue.",
      citation: "Page 2",
      topics: ["Review"],
    },
    {
      text: "Locked cards stay available but should move later than cards needing review.",
      citation: "Page 3",
      topics: ["Progress"],
    },
  ];

  return {
    user: { id: "learning-user", email: "reader@example.com", displayName: "Reader" },
    documentTitle: "Learning loop source",
    goal: "track durable study actions",
    sourceKind: "pdf",
    sourceRef: "learning-loop.pdf",
    passages,
    focusTags: ["Progress", "Review"],
    generationMode: "fallback",
    model: "heuristic-fallback",
    stats: { estimatedMinutes: 3, chunkCount: passages.length },
    cards: passages.map((passage, index) => ({
      kind: index === 1 ? "recall" : "glance",
      title: `Learning card ${index + 1}`,
      body: passage.text,
      question: index === 1 ? "Which cards return first?" : "",
      answer: index === 1 ? "Weak cards return first." : "",
      excerpt: passage.text,
      citation: passage.citation,
    })),
  };
}
