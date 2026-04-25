import { getEnvironmentReport } from "../env.js";
import {
  extractPdfFile,
  normalizeExtractedText,
  PDF_PARSE_STATUSES,
} from "../documents/pdf-parser.js";
import { DOCUMENT_JOB_SOURCE_TYPES } from "../jobs/document-processing.js";
import {
  buildDocumentChunks,
  selectRetrievalPassages,
} from "./chunking.js";
import {
  buildGeneratedCardContract,
  GenerationContractError,
  validateGeneratedDeckContract,
} from "./card-contract.js";

const MAX_SOURCE_CHARS = 80_000;
const MAX_PASSAGES = 8;
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "almost",
  "along",
  "also",
  "although",
  "among",
  "because",
  "before",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "just",
  "many",
  "might",
  "more",
  "most",
  "much",
  "must",
  "only",
  "other",
  "over",
  "same",
  "some",
  "such",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

export async function runDocumentPipeline({
  documentId,
  title,
  goal,
  source,
  user,
  repository,
  env = process.env,
}) {
  const extraction = await extractQueuedSource({ source, title });
  if (!extraction.ok) {
    await repository.markDocumentParseFailed({
      userId: user.id,
      documentId,
      status: extraction.status,
      failureReason: extraction.error,
      diagnostics: extraction.diagnostics,
    });

    return {
      outcome: "terminal",
      documentStatus: extraction.status,
      parse: buildParseResponse(extraction),
    };
  }

  const sourceText = sanitize(extraction.text);
  if (!sourceText) {
    throw new Error("No readable source text was provided.");
  }

  const pages = extraction.pages.length
    ? extraction.pages.map((page) => ({
        pageNumber: page.pageNumber || page.num,
        num: page.pageNumber || page.num,
        citation: page.citation || `Page ${page.pageNumber || page.num}`,
        text: sanitize(page.text),
        wordCount: page.wordCount,
        characterCount: page.characterCount,
      }))
    : createPseudoPages(sourceText);

  await repository.saveParsedDocument({
    userId: user.id,
    documentId,
    text: sourceText,
    pages,
    diagnostics: extraction.diagnostics,
  });

  const chunks = buildDocumentChunks(pages);
  if (!chunks.length) {
    throw new Error("The source did not produce enough readable passages to build cards.");
  }
  const persistedChunks = await repository.saveDocumentChunks({
    userId: user.id,
    documentId,
    chunks,
  });
  const retrieval = selectRetrievalPassages(persistedChunks, {
    title: extraction.title || title,
    goal,
  });
  const passages = retrieval.passages;

  const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
  const baseDeck = {
    documentTitle: extraction.title || title || "Untitled study source",
    goal,
    sourceKind: extraction.sourceKind,
    stats: {
      estimatedMinutes: Math.max(4, Math.round(wordCount / 180)),
      chunkCount: chunks.length,
      retrievedChunkCount: passages.length,
      retrievalStrategy: retrieval.stats.strategy,
      retrievalLowConfidence: retrieval.stats.lowConfidence,
      parseStatus: extraction.status,
      pageCount: extraction.diagnostics?.pageCount || pages.length,
      extractedWordCount: extraction.diagnostics?.wordCount || wordCount,
    },
  };

  const environment = getEnvironmentReport(env);
  if (!environment.generation.enabled) {
    const fallbackDeck = buildFallbackDeck({ passages, goal });
    return persistDeck({
      payload: {
        ...baseDeck,
        focusTags: fallbackDeck.focusTags,
        cards: fallbackDeck.cards,
        generationMode: "fallback",
        model: "heuristic-fallback",
        warning: environment.generation.explicitlyEnabled
          ? environment.generation.issues.join(" ")
          : undefined,
        stats: {
          ...baseDeck.stats,
          ...fallbackDeck.stats,
          cardCount: fallbackDeck.cards.length,
        },
      },
      passages,
      repository,
      user,
      documentId,
    });
  }

  try {
    const aiDeck = await generateDeckWithNvidia({
      documentTitle: baseDeck.documentTitle,
      goal,
      passages,
      apiKey: environment.generation.apiKey,
      model: environment.generation.model,
    });

    return persistDeck({
      payload: {
        ...baseDeck,
        focusTags: aiDeck.focusTags,
        cards: aiDeck.cards,
        generationMode: "ai",
        model: environment.generation.model,
        stats: {
          ...baseDeck.stats,
          ...aiDeck.stats,
          cardCount: aiDeck.cards.length,
        },
      },
      passages,
      repository,
      user,
      documentId,
    });
  } catch (generationError) {
    const fallbackDeck = buildFallbackDeck({ passages, goal });
    const generationFailure = describeGenerationFailure(generationError);
    return persistDeck({
      payload: {
        ...baseDeck,
        focusTags: fallbackDeck.focusTags,
        cards: fallbackDeck.cards,
        generationMode: "fallback",
        model:
          generationError instanceof Error
            ? `fallback-after-${environment.generation.model}`
            : "heuristic-fallback",
        warning: generationFailure.message,
        stats: {
          ...baseDeck.stats,
          ...fallbackDeck.stats,
          generationFailure,
          cardCount: fallbackDeck.cards.length,
        },
      },
      passages,
      repository,
      user,
      documentId,
    });
  }
}

export function buildParseResponse(result) {
  return {
    status: result.status,
    code: result.code,
    pageCount: result.diagnostics?.pageCount || 0,
    pagesWithText: result.diagnostics?.pagesWithText || 0,
    wordCount: result.diagnostics?.wordCount || 0,
    reason: result.diagnostics?.reason || result.error,
  };
}

async function extractQueuedSource({ source, title }) {
  if (source?.type === DOCUMENT_JOB_SOURCE_TYPES.INLINE_TEXT) {
    return createTextExtraction({
      text: source.text,
      title,
      sourceKind: source.sourceKind || "paste",
      parser: "inline-text",
    });
  }

  if (source?.type === DOCUMENT_JOB_SOURCE_TYPES.INLINE_FILE) {
    const bytes = Buffer.from(String(source.base64 || ""), "base64");
    const file = new File([bytes], String(source.fileName || "source"), {
      type: String(source.contentType || "application/octet-stream"),
    });
    const extension = file.name.split(".").pop()?.toLowerCase() || "";

    if (file.type === "application/pdf" || extension === "pdf") {
      return extractPdfFile(file, { title });
    }

    return createTextExtraction({
      text: bytes.toString("utf8"),
      title: title || file.name.replace(/\.[^.]+$/, ""),
      sourceKind: source.sourceKind || "file",
      parser: "plain-text",
    });
  }

  throw new Error("Unsupported document-processing job payload.");
}

function createTextExtraction({ text, title, sourceKind, parser }) {
  const normalized = normalizeExtractedText(text);
  const pages = normalized
    .split(/\n{2,}/)
    .map((block, index) => ({
      pageNumber: index + 1,
      citation: `Section ${index + 1}`,
      text: block,
      wordCount: block.split(/\s+/).filter(Boolean).length,
      characterCount: block.length,
    }))
    .filter((page) => page.text.trim());

  return {
    ok: true,
    status: PDF_PARSE_STATUSES.PARSED,
    code: "readable_text",
    title,
    text: normalized,
    pages,
    diagnostics: {
      parser,
      status: PDF_PARSE_STATUSES.PARSED,
      code: "readable_text",
      reason: "Readable source text was normalized into citation-ready sections.",
      pageCount: pages.length || 1,
      pagesWithText: pages.length || 1,
      wordCount: normalized.split(/\s+/).filter(Boolean).length,
      characterCount: normalized.length,
      averagePageChars: pages.length ? Math.round(normalized.length / pages.length) : normalized.length,
      warnings: [],
    },
    sourceKind,
  };
}

async function persistDeck({
  payload,
  passages,
  repository,
  user,
  documentId,
}) {
  const validated = validateGeneratedDeckContract({
    payload: {
      focusTags: payload.focusTags,
      cards: payload.cards,
    },
    passages,
    allowRepair: false,
  });
  const persisted = await repository.saveGeneratedDeck({
    user,
    documentId,
    documentTitle: payload.documentTitle,
    goal: payload.goal,
    sourceKind: payload.sourceKind,
    sourceRef: payload.sourceRef || payload.documentTitle,
    passages,
    focusTags: validated.focusTags,
    cards: validated.cards,
    generationMode: payload.generationMode,
    model: payload.model,
    stats: {
      ...payload.stats,
      ...validated.stats,
    },
  });

  return {
    ...payload,
    ...persisted,
    warning: payload.warning,
  };
}

async function generateDeckWithNvidia({ documentTitle, goal, passages, apiKey, model }) {
  const prompt = buildGenerationPrompt({ documentTitle, goal, passages });
  const response = await fetch(NVIDIA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate grounded study cards from source material. Return valid JSON only. Never invent facts outside the provided passages. Every card must cite one of the given passage citations.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        "The NVIDIA chat completion request failed.",
    );
  }

  const rawContent =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    "";
  const parsed = parseModelJson(rawContent);
  const validated = validateGeneratedDeckContract({
    payload: parsed,
    passages,
  });

  if (!validated.cards.length) {
    throw new Error("The model response did not contain valid study cards.");
  }

  return {
    focusTags: validated.focusTags,
    cards: validated.cards,
    stats: validated.stats,
  };
}

function buildGenerationPrompt({ documentTitle, goal, passages }) {
  const passageText = passages
    .map((passage, index) => {
      return [
        `Passage ${index + 1}`,
        `Chunk ID: ${passage.id || `passage-${index + 1}`}`,
        `Citation: ${passage.citation}`,
        `Topics: ${(Array.isArray(passage.topics) ? passage.topics : []).join(", ") || "None"}`,
        `Text: ${passage.text}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return [
    `Document title: ${documentTitle}`,
    `Study goal: ${goal}`,
    "",
    "Using only the passages below, create a mobile-friendly study feed.",
    "",
    "Return a JSON object with this exact shape:",
    "{",
    `  "contractVersion": "${buildGeneratedCardContract().version}",`,
    '  "focusTags": ["tag1", "tag2", "tag3", "tag4"],',
    '  "cards": [',
    "    {",
    '      "kind": "glance | recall | application | pitfall",',
    '      "title": "short card title",',
    '      "body": "1 to 2 concise sentences",',
    '      "question": "optional prompt for recall/application/pitfall",',
    '      "answer": "optional answer for recall/application/pitfall",',
    '      "excerpt": "short grounded excerpt from the passage",',
    '      "citation": "must match one of the given citations exactly",',
    '      "sourceReference": {',
    '        "chunkId": "must match the cited passage chunk id",',
    '        "citation": "must match citation exactly"',
    "      }",
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Create 10 to 14 cards.",
    "- Use a mix of glance, recall, application, and pitfall cards.",
    "- Keep the cards useful for quick scrolling, not long essays.",
    "- Every card must stay grounded in the provided passages.",
    "- Never cite anything except the provided citations.",
    "- Include a sourceReference object on every card.",
    "- The excerpt must be copied or tightly paraphrased from the cited passage.",
    "- Recall, application, and pitfall cards must include both question and answer.",
    "- Keep titles under 70 characters.",
    "- Keep excerpts short and verbatim-friendly, but do not overquote.",
    "",
    "Passages:",
    passageText,
  ].join("\n");
}

function sanitize(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

function createPseudoPages(text) {
  const pages = [];
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  let current = "";
  let pageNum = 1;

  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > 1500 && current) {
      pages.push({ pageNumber: pageNum, num: pageNum, citation: `Section ${pageNum}`, text: current });
      pageNum += 1;
      current = block;
      continue;
    }
    current = next;
  }

  if (current) {
    pages.push({ pageNumber: pageNum, num: pageNum, citation: `Section ${pageNum}`, text: current });
  }

  return pages.length
    ? pages
    : [{ pageNumber: 1, num: 1, citation: "Section 1", text }];
}

function createPassages(pages) {
  const passages = [];

  for (const page of pages) {
    const pageNumber = page.pageNumber || page.num || passages.length + 1;
    const citation = page.citation || `Page ${pageNumber}`;
    const chunks = page.text
      .split(/\n{2,}/)
      .flatMap(splitLongBlock)
      .filter((chunk) => chunk.length > 120);

    for (const chunk of chunks) {
      const sentences = splitIntoSentences(chunk);
      if (!sentences.length) {
        continue;
      }

      passages.push({
        text: chunk,
        sentences,
        citation,
        pageNumber,
        topics: extractTopics(chunk),
      });

      if (passages.length >= MAX_PASSAGES) {
        return passages;
      }
    }
  }

  if (passages.length) {
    return passages;
  }

  const fallbackSentences = splitIntoSentences(pages.map((page) => page.text).join(" "));
  return fallbackSentences.length
    ? [
        {
          text: fallbackSentences.join(" "),
          sentences: fallbackSentences,
          citation: "Section 1",
          topics: extractTopics(fallbackSentences.join(" ")),
        },
      ]
    : [];
}

function splitLongBlock(block) {
  const sentences = splitIntoSentences(block.trim());
  if (sentences.length <= 2 && block.length < 420) {
    return [block.trim()];
  }

  const pieces = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > 420 && current) {
      pieces.push(current.trim());
      current = sentence;
      continue;
    }
    current = next;
  }

  if (current) {
    pieces.push(current.trim());
  }

  return pieces.length ? pieces : [block.trim()];
}

function splitIntoSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function createCards(passages, goal) {
  const cards = [];

  passages.forEach((passage, index) => {
    const slot = index % 4;
    if (slot === 0) {
      cards.push(createGlanceCard(passage, index));
      cards.push(createRecallCard(passage, index + passages.length));
      return;
    }
    if (slot === 1) {
      cards.push(createRecallCard(passage, index));
      cards.push(createApplicationCard(passage, index + passages.length, goal));
      return;
    }
    if (slot === 2) {
      cards.push(createApplicationCard(passage, index, goal));
      cards.push(createPitfallCard(passage, index + passages.length));
      return;
    }
    cards.push(createPitfallCard(passage, index));
    cards.push(createRecallCard(passage, index + passages.length, true));
  });

  return cards.slice(0, 16);
}

function parseModelJson(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The model returned an empty response.");
  }

  const normalized = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(normalized);
  } catch (error) {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(normalized.slice(start, end + 1));
    }
    throw error;
  }
}

function buildFallbackDeck({ passages, goal }) {
  return validateGeneratedDeckContract({
    payload: {
      focusTags: collectFocusTags(passages),
      cards: createCards(passages, goal),
    },
    passages,
  });
}

function describeGenerationFailure(error) {
  if (error instanceof GenerationContractError) {
    return {
      code: error.code,
      message: error.message,
      issueCount: error.issues.length,
      retryable: true,
    };
  }

  return {
    code: "generation_request_failed",
    message:
      error instanceof Error
        ? error.message
        : "The NVIDIA generation request failed, so the heuristic fallback was used.",
    issueCount: 0,
    retryable: true,
  };
}

function createGlanceCard(passage, index) {
  return {
    id: `card-${index + 1}`,
    kind: "glance",
    title: buildTitle(passage),
    body: summarize(passage.sentences, 2, 220),
    excerpt: trimText(passage.text, 170),
    citation: passage.citation,
  };
}

function createRecallCard(passage, index, repeat = false) {
  return {
    id: `card-${index + 1}`,
    kind: "recall",
    title: repeat ? `Recall loop: ${topicLabel(passage)}` : `Say it back: ${topicLabel(passage)}`,
    body: repeat
      ? "Reconstruct the idea before you expose the wording again."
      : "Pause the scroll and restate the point before rereading it.",
    question: buildRecallQuestion(passage),
    answer: summarize(passage.sentences, 2, 190),
    excerpt: trimText(passage.text, 170),
    citation: passage.citation,
  };
}

function createApplicationCard(passage, index, goal) {
  return {
    id: `card-${index + 1}`,
    kind: "application",
    title: "Translate it to the real task",
    body: trimText(
      `Tie this back to ${goal}. The feed is stronger when each concept points back to a real interview, exam, or decision.`,
      180,
    ),
    question: `Where would ${topicLabel(passage).toLowerCase()} show up when you ${goal}?`,
    answer: trimText(
      `${passage.sentences[0] || passage.text} Keep it in reach when the same idea appears in a different phrasing or context.`,
      200,
    ),
    excerpt: trimText(passage.text, 170),
    citation: passage.citation,
  };
}

function createPitfallCard(passage, index) {
  return {
    id: `card-${index + 1}`,
    kind: "pitfall",
    title: "What passive reading would blur",
    body: "This is the detail most likely to disappear if the source only feels familiar.",
    question: "What would you probably miss if you skimmed this section?",
    answer: trimText(passage.sentences[1] || passage.sentences[0] || passage.text, 180),
    excerpt: trimText(passage.text, 170),
    citation: passage.citation,
  };
}

function buildTitle(passage) {
  const sentence = (passage.sentences[0] || passage.text)
    .replace(/^[\d.\-)\s]+/, "")
    .replace(/[;:,-]\s.*$/, "")
    .trim();
  return trimText(sentence.charAt(0).toUpperCase() + sentence.slice(1), 68);
}

function buildRecallQuestion(passage) {
  const sentence = passage.sentences[0] || passage.text;
  const matcher = sentence.match(/^(.{4,80}?)\s+(is|are|can|should|must)\s+/i);
  if (matcher) {
    return `What does this source say about ${matcher[1].trim().toLowerCase()}?`;
  }
  return `How would you explain ${topicLabel(passage).toLowerCase()} without rereading the source?`;
}

function topicLabel(passage) {
  return passage.topics[0] || trimText(buildTitle(passage).toLowerCase(), 36);
}

function extractTopics(text) {
  const words =
    text
      .toLowerCase()
      .match(/[a-z][a-z'-]{3,}/g)
      ?.filter((word) => !STOP_WORDS.has(word)) || [];
  const counts = new Map();

  for (const word of words) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

function collectFocusTags(passages) {
  const counts = new Map();

  passages.forEach((passage) => {
    passage.topics.forEach((topic) => {
      counts.set(topic, (counts.get(topic) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([topic]) => topic);
}

function summarize(sentences, count, maxLength) {
  return trimText(sentences.slice(0, count).join(" "), maxLength);
}

function trimText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}
