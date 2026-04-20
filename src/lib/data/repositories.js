import {
  assertAllowedValue,
  createPublicId,
  estimateTokens,
  hashSourceText,
  normalizeSourceKind,
  nowIso,
} from "./schema.js";
import { createLocalJsonStore } from "./local-store.js";

export function createStudyRepository({ store = createLocalJsonStore() } = {}) {
  return {
    saveGeneratedDeck(input) {
      return saveGeneratedDeck(store, input);
    },
    getLatestDeckForUser(userId) {
      return getLatestDeckForUser(store, userId);
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

async function saveGeneratedDeck(store, input) {
  const userId = requireNonEmpty(input.user?.id, "user.id");
  const title = requireNonEmpty(input.documentTitle, "documentTitle");
  const goal = requireNonEmpty(input.goal, "goal");
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const passages = Array.isArray(input.passages) ? input.passages : [];
  const cards = Array.isArray(input.cards) ? input.cards : [];

  if (!cards.length) {
    throw new Error("A persisted study session needs at least one card.");
  }

  const timestamp = nowIso();
  const documentId = createPublicId("doc");
  const sessionId = createPublicId("session");
  const chunkRows = passages.map((passage, index) => {
    const text = String(passage.text || "");
    return {
      id: createPublicId("chunk"),
      documentId,
      sequence: index,
      citation: String(passage.citation || `Section ${index + 1}`),
      text,
      topics: Array.isArray(passage.topics) ? passage.topics.map(String) : [],
      tokenEstimate: estimateTokens(text),
      embeddingStatus: "pending",
      embeddingProvider: "",
      embeddingModel: "",
      createdAt: timestamp,
    };
  });
  const chunkByCitation = new Map(chunkRows.map((chunk) => [chunk.citation, chunk]));
  const cardRows = cards.map((card, index) => {
    const kind = ["glance", "recall", "application", "pitfall"].includes(card.kind)
      ? card.kind
      : "glance";
    const citation = String(card.citation || "");
    const chunk = chunkByCitation.get(citation) || null;

    return {
      id: createPublicId("card"),
      sessionId,
      documentId,
      chunkId: chunk?.id || null,
      sequence: index,
      kind,
      status: "active",
      title: requireNonEmpty(card.title, `cards[${index}].title`),
      body: requireNonEmpty(card.body, `cards[${index}].body`),
      question: typeof card.question === "string" ? card.question : "",
      answer: typeof card.answer === "string" ? card.answer : "",
      excerpt: requireNonEmpty(card.excerpt, `cards[${index}].excerpt`),
      citation: requireNonEmpty(citation, `cards[${index}].citation`),
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
    const sourceText = passages.map((passage) => passage.text || "").join("\n\n");
    const documentRow = {
      id: documentId,
      userId,
      title,
      sourceKind,
      sourceRef: typeof input.sourceRef === "string" ? input.sourceRef : "",
      goal,
      status: "cards_generated",
      contentHash: hashSourceText(sourceText),
      wordCount: sourceText.split(/\s+/).filter(Boolean).length,
      createdAt: timestamp,
      updatedAt: timestamp,
      parsedAt: timestamp,
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
      focusTags: Array.isArray(input.focusTags) ? input.focusTags.map(String) : [],
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
      documents: [...current.documents, documentRow],
      documentChunks: [...current.documentChunks, ...chunkRows],
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
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];

  if (!session) {
    return null;
  }

  const document = current.documents.find((entry) => entry.id === session.documentId);
  const cards = current.studyCards
    .filter((entry) => entry.sessionId === session.id)
    .sort((left, right) => left.sequence - right.sequence);

  return buildDeckResponse({ document, session, cards });
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
      studyInteractions: [...current.studyInteractions, interaction],
    };
  });

  return interaction;
}

function buildDeckResponse({ document, session, cards }) {
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
      status: card.status,
    })),
    generationMode: session.generationMode,
    model: session.model,
    stats: {
      ...(session.stats || {}),
      cardCount: cards.length,
    },
    persistence: {
      adapter: "local-json",
      serverStored: true,
    },
  };
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

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required persistence field: ${label}`);
  }
  return value.trim();
}
