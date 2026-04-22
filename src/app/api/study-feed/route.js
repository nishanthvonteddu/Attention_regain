import { getEnvironmentReport } from "../../../lib/env.js";
import {
  readProductSessionFromCookieHeader,
  requestHasAuthenticatedSession,
} from "../../../lib/auth/session.server.js";
import { requestHasSameOrigin } from "../../../lib/auth/request.js";
import { getDefaultStudyRepository } from "../../../lib/data/repositories.js";
import {
  extractPdfFile,
  normalizeExtractedText,
  PDF_PARSE_STATUSES,
} from "../../../lib/documents/pdf-parser.js";
import { validateUploadDescriptor } from "../../../lib/uploads/validation.js";

export const runtime = "nodejs";

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

export async function POST(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    const repository = getDefaultStudyRepository();
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before generating a private study feed." },
        { status: 401 },
      );
    }
    if (!requestHasSameOrigin(request)) {
      return Response.json({ error: "Study feed writes must be same-origin." }, { status: 403 });
    }

    const formData = await request.formData();
    const title = String(formData.get("title") || "").trim();
    const goal =
      String(formData.get("goal") || "").trim() ||
      "stay close to the material when attention slips";
    const pastedText = String(formData.get("sourceText") || "");
    const uploaded = formData.get("file");
    const uploadDocumentId = String(formData.get("uploadDocumentId") || "").trim();

    let sourceText = pastedText;
    let sourceKind = "paste";
    let pageRefs = [];
    let parseResult = null;
    let resolvedTitle = title;

    if (uploadDocumentId) {
      const upload = await repository.getDocumentUploadForUser(session.user.id, uploadDocumentId);
      if (!upload) {
        return Response.json(
          { error: "The upload record was not found for this user." },
          { status: 400 },
        );
      }
    }

    if (uploaded instanceof File) {
      const validation = validateUploadDescriptor({
        fileName: uploaded.name,
        contentType: uploaded.type,
        sizeBytes: uploaded.size,
      });
      if (!validation.ok) {
        return Response.json(
          { error: validation.message, code: validation.code },
          { status: 400 },
        );
      }

      const extracted = await extractFile(uploaded);
      if (!extracted.ok) {
        if (uploadDocumentId) {
          await repository.markDocumentParseFailed({
            userId: session.user.id,
            documentId: uploadDocumentId,
            status: extracted.status,
            failureReason: extracted.error,
            diagnostics: extracted.diagnostics,
          });
        }
        return Response.json(
          {
            error: extracted.error,
            code: extracted.code,
            parse: buildParseResponse(extracted),
          },
          { status: extracted.status === PDF_PARSE_STATUSES.PARSE_FAILED ? 400 : 422 },
        );
      }

      parseResult = extracted;
      sourceText = extracted.text;
      sourceKind = extracted.sourceKind;
      pageRefs = extracted.pages;
      resolvedTitle = resolvedTitle || extracted.title;
    }

    sourceText = sanitize(sourceText);
    if (!sourceText) {
      return Response.json(
        { error: "No readable source text was provided." },
        { status: 400 },
      );
    }

    const pages = pageRefs.length ? pageRefs.map((page) => ({
      pageNumber: page.pageNumber || page.num,
      num: page.pageNumber || page.num,
      citation: page.citation || `Page ${page.pageNumber || page.num}`,
      text: sanitize(page.text),
      wordCount: page.wordCount,
      characterCount: page.characterCount,
    })) : createPseudoPages(sourceText);

    if (uploadDocumentId && parseResult) {
      await repository.saveParsedDocument({
        userId: session.user.id,
        documentId: uploadDocumentId,
        text: sourceText,
        pages,
        diagnostics: parseResult.diagnostics,
      });
    }

    const passages = createPassages(pages);
    const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
    const baseDeck = {
      documentTitle: resolvedTitle || "Untitled study source",
      goal,
      sourceKind,
      stats: {
        estimatedMinutes: Math.max(4, Math.round(wordCount / 180)),
        chunkCount: passages.length,
        parseStatus: parseResult?.status,
        pageCount: parseResult?.diagnostics?.pageCount || pages.length,
        extractedWordCount: parseResult?.diagnostics?.wordCount || wordCount,
      },
    };

    if (!passages.length) {
      return Response.json(
        { error: "The source did not produce enough readable passages to build cards." },
        { status: 400 },
      );
    }

    const environment = getEnvironmentReport();
    if (!environment.generation.enabled) {
      const fallbackCards = createCards(passages, goal);
      const payload = {
        ...baseDeck,
        focusTags: collectFocusTags(passages),
        cards: fallbackCards,
        generationMode: "fallback",
        model: "heuristic-fallback",
        warning: environment.generation.explicitlyEnabled
          ? environment.generation.issues.join(" ")
          : undefined,
        stats: {
          ...baseDeck.stats,
          cardCount: fallbackCards.length,
        },
      };
      return Response.json(
        await persistDeck({ payload, passages, session, repository, uploadDocumentId }),
      );
    }

    try {
      const aiDeck = await generateDeckWithNvidia({
        documentTitle: baseDeck.documentTitle,
        goal,
        passages,
        apiKey: environment.generation.apiKey,
        model: environment.generation.model,
      });

      const payload = {
        ...baseDeck,
        focusTags: aiDeck.focusTags,
        cards: aiDeck.cards,
        generationMode: "ai",
        model: environment.generation.model,
        stats: {
          ...baseDeck.stats,
          cardCount: aiDeck.cards.length,
        },
      };
      return Response.json(
        await persistDeck({ payload, passages, session, repository, uploadDocumentId }),
      );
    } catch (generationError) {
      const fallbackCards = createCards(passages, goal);
      const payload = {
        ...baseDeck,
        focusTags: collectFocusTags(passages),
        cards: fallbackCards,
        generationMode: "fallback",
        model:
          generationError instanceof Error
            ? `fallback-after-${environment.generation.model}`
            : "heuristic-fallback",
        warning:
          generationError instanceof Error
            ? generationError.message
            : "The NVIDIA generation request failed, so the heuristic fallback was used.",
        stats: {
          ...baseDeck.stats,
          cardCount: fallbackCards.length,
        },
      };
      return Response.json(
        await persistDeck({ payload, passages, session, repository, uploadDocumentId }),
      );
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not turn the source into a study feed.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before loading a private study feed." },
        { status: 401 },
      );
    }

    const deck = await getDefaultStudyRepository().getLatestDeckForUser(session.user.id);
    if (!deck) {
      return Response.json({ deck: null });
    }

    return Response.json({ deck });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load the persisted study feed.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before saving study interactions." },
        { status: 401 },
      );
    }
    if (!requestHasSameOrigin(request)) {
      return Response.json(
        { error: "Study interaction writes must be same-origin." },
        { status: 403 },
      );
    }

    const payload = await request.json();
    const interaction = await getDefaultStudyRepository().recordInteraction({
      userId: session.user.id,
      sessionId: String(payload.sessionId || ""),
      cardId: String(payload.cardId || ""),
      interactionType: String(payload.interactionType || ""),
      value: typeof payload.value === "string" ? payload.value : JSON.stringify(payload.value ?? ""),
    });

    return Response.json({ interaction });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not save the study interaction.",
      },
      { status: 400 },
    );
  }
}

async function persistDeck({
  payload,
  passages,
  session,
  repository = getDefaultStudyRepository(),
  uploadDocumentId = "",
}) {
  const persisted = await repository.saveGeneratedDeck({
    user: session.user,
    documentId: uploadDocumentId,
    documentTitle: payload.documentTitle,
    goal: payload.goal,
    sourceKind: payload.sourceKind,
    sourceRef: payload.sourceRef || payload.documentTitle,
    passages,
    focusTags: payload.focusTags,
    cards: payload.cards,
    generationMode: payload.generationMode,
    model: payload.model,
    stats: payload.stats,
  });

  return {
    ...payload,
    ...persisted,
    warning: payload.warning,
  };
}

function buildParseResponse(result) {
  return {
    status: result.status,
    code: result.code,
    pageCount: result.diagnostics?.pageCount || 0,
    pagesWithText: result.diagnostics?.pagesWithText || 0,
    wordCount: result.diagnostics?.wordCount || 0,
    reason: result.diagnostics?.reason || result.error,
  };
}

async function extractFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const title = file.name.replace(/\.[^.]+$/, "");

  if (file.type === "application/pdf" || extension === "pdf") {
    return extractPdfFile(file, { title });
  }

  const text = normalizeExtractedText(await file.text());
  const pages = text
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
    status: "parsed",
    code: "readable_text",
    title,
    text,
    pages,
    diagnostics: {
      parser: "plain-text",
      status: "parsed",
      code: "readable_text",
      reason: "Readable text file was normalized into source sections.",
      pageCount: pages.length || 1,
      pagesWithText: pages.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      characterCount: text.length,
      averagePageChars: pages.length ? Math.round(text.length / pages.length) : text.length,
      warnings: [],
    },
    sourceKind: "file",
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
  const cards = normalizeCards(parsed.cards, passages);

  if (!cards.length) {
    throw new Error("The model response did not contain valid study cards.");
  }

  return {
    focusTags: normalizeTags(parsed.focusTags, passages),
    cards,
  };
}

function buildGenerationPrompt({ documentTitle, goal, passages }) {
  const passageText = passages
    .map((passage, index) => {
      return [
        `Passage ${index + 1}`,
        `Citation: ${passage.citation}`,
        `Topics: ${passage.topics.join(", ") || "None"}`,
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
    '  "focusTags": ["tag1", "tag2", "tag3", "tag4"],',
    '  "cards": [',
    "    {",
    '      "kind": "glance | recall | application | pitfall",',
    '      "title": "short card title",',
    '      "body": "1 to 2 concise sentences",',
    '      "question": "optional prompt for recall/application/pitfall",',
    '      "answer": "optional answer for recall/application/pitfall",',
    '      "excerpt": "short grounded excerpt from the passage",',
    '      "citation": "must match one of the given citations exactly"',
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

  return JSON.parse(normalized);
}

function normalizeTags(tags, passages) {
  if (!Array.isArray(tags)) {
    return collectFocusTags(passages);
  }

  const normalized = tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  return normalized.length ? normalized : collectFocusTags(passages);
}

function normalizeCards(cards, passages) {
  if (!Array.isArray(cards)) {
    return [];
  }

  const validKinds = new Set(["glance", "recall", "application", "pitfall"]);
  const validCitations = new Set(passages.map((passage) => passage.citation));

  return cards
    .map((card, index) => {
      const citation = String(card?.citation || "").trim();
      if (!validCitations.has(citation)) {
        return null;
      }

      const kind = validKinds.has(card?.kind) ? card.kind : "glance";
      const title = trimText(String(card?.title || "").trim(), 70);
      const body = trimText(String(card?.body || "").trim(), 240);
      const excerpt = trimText(String(card?.excerpt || "").trim(), 170);
      const question = trimText(String(card?.question || "").trim(), 220);
      const answer = trimText(String(card?.answer || "").trim(), 220);

      if (!title || !body || !excerpt) {
        return null;
      }

      return {
        id: `card-${index + 1}`,
        kind,
        title,
        body,
        question: question || undefined,
        answer: answer || undefined,
        excerpt,
        citation,
      };
    })
    .filter(Boolean)
    .slice(0, 16);
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
