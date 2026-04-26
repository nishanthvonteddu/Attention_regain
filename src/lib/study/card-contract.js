export const GENERATED_CARD_CONTRACT_VERSION = "day08.generated-card.v1";

export const CARD_KINDS = Object.freeze([
  "glance",
  "recall",
  "application",
  "pitfall",
]);

export const CARD_FIELD_LIMITS = Object.freeze({
  title: 70,
  body: 240,
  question: 220,
  answer: 220,
  excerpt: 170,
});

const INTERACTIVE_KINDS = new Set(["recall", "application", "pitfall"]);
const MIN_GROUNDED_WORD_OVERLAP = 0.55;

export class GenerationContractError extends Error {
  constructor(message, { issues = [], code = "generation_contract_failed" } = {}) {
    super(message);
    this.name = "GenerationContractError";
    this.code = code;
    this.issues = issues;
  }
}

export function buildGeneratedCardContract() {
  return {
    version: GENERATED_CARD_CONTRACT_VERSION,
    cardKinds: CARD_KINDS,
    requiredBatchFields: ["focusTags", "cards"],
    requiredCardFields: ["kind", "title", "body", "excerpt", "citation"],
    sourceReferenceFields: [
      "chunkId",
      "citation",
      "pageNumber",
      "paragraphStart",
      "paragraphEnd",
    ],
    fieldLimits: CARD_FIELD_LIMITS,
    rules: [
      "cards must cite one retrieved passage exactly",
      "cards must include a grounded excerpt from the cited passage",
      "recall, application, and pitfall cards must include question and answer",
      "uncited or ungrounded cards are rejected before persistence",
    ],
  };
}

export function validateGeneratedDeckContract({
  payload,
  passages,
  minimumCards = 1,
  allowRepair = true,
} = {}) {
  const sourcePassages = normalizePassages(passages);
  const issues = [];
  const rejectedCards = [];
  const repairedCards = [];
  const rawCards = Array.isArray(payload?.cards) ? payload.cards : [];

  if (!sourcePassages.length) {
    throw new GenerationContractError("Generated cards require at least one retrieved passage.", {
      issues: [{ path: "passages", message: "No source passages were provided." }],
    });
  }

  if (!Array.isArray(payload?.cards)) {
    issues.push({ path: "cards", message: "cards must be an array." });
  }

  const cards = rawCards
    .map((card, index) => {
      const result = validateGeneratedCard({
        card,
        index,
        passages: sourcePassages,
        allowRepair,
      });
      issues.push(...result.issues);
      if (result.rejected) {
        rejectedCards.push({ index, reasons: result.issues.map((issue) => issue.message) });
        return null;
      }
      if (result.repaired.length) {
        repairedCards.push({ index, repairs: result.repaired });
      }
      return result.card;
    })
    .filter(Boolean)
    .slice(0, 16);

  if (cards.length < minimumCards) {
    issues.push({
      path: "cards",
      message: `At least ${minimumCards} valid grounded card is required.`,
    });
    throw new GenerationContractError("The generated deck did not satisfy the card contract.", {
      issues,
    });
  }

  return {
    version: GENERATED_CARD_CONTRACT_VERSION,
    focusTags: normalizeFocusTags(payload?.focusTags, sourcePassages),
    cards,
    issues,
    rejectedCards,
    repairedCards,
    stats: {
      contractVersion: GENERATED_CARD_CONTRACT_VERSION,
      inputCardCount: rawCards.length,
      acceptedCardCount: cards.length,
      rejectedCardCount: rejectedCards.length,
      repairedCardCount: repairedCards.length,
    },
  };
}

export function assertPersistableGeneratedDeck({ cards, passages } = {}) {
  return validateGeneratedDeckContract({
    payload: { cards, focusTags: [] },
    passages,
    minimumCards: 1,
    allowRepair: false,
  });
}

function validateGeneratedCard({ card, index, passages, allowRepair }) {
  const path = `cards[${index}]`;
  const issues = [];
  const repaired = [];

  if (!card || typeof card !== "object") {
    return {
      card: null,
      issues: [{ path, message: "Card must be an object." }],
      repaired,
      rejected: true,
    };
  }

  const rawKind = String(card.kind || "").trim();
  let kind = rawKind;
  if (!CARD_KINDS.includes(kind)) {
    if (!allowRepair) {
      issues.push({ path: `${path}.kind`, message: "Card kind is not supported." });
    } else {
      kind = "glance";
      repaired.push("kind");
    }
  }

  const source = resolveSourcePassage(card, passages);
  if (!source) {
    issues.push({
      path: `${path}.citation`,
      message: "Citation must match one retrieved passage exactly.",
    });
  }

  const title = normalizeRequiredText(card.title, CARD_FIELD_LIMITS.title);
  const body = normalizeRequiredText(card.body, CARD_FIELD_LIMITS.body);
  let excerpt = normalizeRequiredText(card.excerpt, CARD_FIELD_LIMITS.excerpt);
  const question = normalizeOptionalText(card.question, CARD_FIELD_LIMITS.question);
  const answer = normalizeOptionalText(card.answer, CARD_FIELD_LIMITS.answer);

  for (const [field, value] of [
    ["title", title],
    ["body", body],
  ]) {
    if (!value) {
      issues.push({ path: `${path}.${field}`, message: `${field} is required.` });
    }
    if (String(card[field] || "").trim().length > CARD_FIELD_LIMITS[field]) {
      repaired.push(field);
    }
  }

  if (!excerpt && source && allowRepair) {
    excerpt = trimText(source.text, CARD_FIELD_LIMITS.excerpt);
    repaired.push("excerpt");
  }
  if (!excerpt) {
    issues.push({ path: `${path}.excerpt`, message: "excerpt is required." });
  }
  if (String(card.excerpt || "").trim().length > CARD_FIELD_LIMITS.excerpt) {
    repaired.push("excerpt");
  }

  if (INTERACTIVE_KINDS.has(kind)) {
    if (!question) {
      issues.push({ path: `${path}.question`, message: `${kind} cards require a question.` });
    }
    if (!answer) {
      issues.push({ path: `${path}.answer`, message: `${kind} cards require an answer.` });
    }
  }

  if (source && excerpt && !isExcerptGrounded(excerpt, source.text)) {
    issues.push({
      path: `${path}.excerpt`,
      message: "excerpt must be grounded in the cited passage.",
    });
  }

  const rejected = issues.length > 0;
  return {
    card: rejected
      ? null
      : {
          id: typeof card.id === "string" && card.id.trim()
            ? card.id.trim()
            : `card-${index + 1}`,
          kind,
          title,
          body,
          question: question || undefined,
          answer: answer || undefined,
          excerpt,
          citation: source.citation,
          chunkId: source.id || undefined,
          sourceReference: buildSourceReference(source),
        },
    issues,
    repaired,
    rejected,
  };
}

function normalizePassages(passages = []) {
  return (Array.isArray(passages) ? passages : [])
    .map((passage, index) => {
      const citation = String(passage?.citation || "").trim();
      const text = String(passage?.text || "").trim();
      return {
        ...passage,
        id: typeof passage?.id === "string" && passage.id.trim()
          ? passage.id.trim()
          : "",
        citation,
        text,
        sequence: Number.isSafeInteger(passage?.sequence) ? passage.sequence : index,
      };
    })
    .filter((passage) => passage.citation && passage.text);
}

function resolveSourcePassage(card, passages) {
  const sourceReference =
    card?.sourceReference && typeof card.sourceReference === "object"
      ? card.sourceReference
      : card?.source && typeof card.source === "object"
        ? card.source
        : {};
  const chunkId = String(card?.chunkId || sourceReference.chunkId || "").trim();
  const citation = String(card?.citation || sourceReference.citation || "").trim();

  if (chunkId) {
    const byId = passages.find((passage) => passage.id === chunkId);
    if (byId && (!citation || byId.citation === citation)) {
      return byId;
    }
  }

  if (citation) {
    return passages.find((passage) => passage.citation === citation) || null;
  }

  return null;
}

function buildSourceReference(passage) {
  return {
    chunkId: passage.id || undefined,
    citation: passage.citation,
    pageNumber: Number.isSafeInteger(passage.pageNumber) ? passage.pageNumber : undefined,
    paragraphStart: Number.isSafeInteger(passage.paragraphStart)
      ? passage.paragraphStart
      : undefined,
    paragraphEnd: Number.isSafeInteger(passage.paragraphEnd)
      ? passage.paragraphEnd
      : undefined,
  };
}

function normalizeRequiredText(value, limit) {
  return trimText(String(value || "").replace(/\s+/g, " ").trim(), limit);
}

function normalizeOptionalText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? trimText(text, limit) : "";
}

function normalizeFocusTags(tags, passages) {
  const normalized = Array.isArray(tags)
    ? tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  if (normalized.length) {
    return normalized;
  }

  const counts = new Map();
  passages.forEach((passage) => {
    (Array.isArray(passage.topics) ? passage.topics : []).forEach((topic) => {
      counts.set(topic, (counts.get(topic) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([topic]) => topic);
}

function isExcerptGrounded(excerpt, sourceText) {
  const normalizedExcerpt = normalizeForComparison(excerpt);
  const normalizedSource = normalizeForComparison(sourceText);
  if (!normalizedExcerpt || !normalizedSource) {
    return false;
  }
  if (normalizedSource.includes(normalizedExcerpt)) {
    return true;
  }

  const excerptWords = meaningfulWords(normalizedExcerpt);
  if (!excerptWords.length) {
    return false;
  }
  const sourceWords = new Set(meaningfulWords(normalizedSource));
  const overlap = excerptWords.filter((word) => sourceWords.has(word)).length;
  return overlap / excerptWords.length >= MIN_GROUNDED_WORD_OVERLAP;
}

function normalizeForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(text) {
  return String(text || "")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

function trimText(text, limit) {
  const normalized = String(text || "").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
