import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_SOURCE_CHARS = 80_000;
const MAX_PASSAGES = 8;

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
    const formData = await request.formData();
    const title = String(formData.get("title") || "").trim();
    const goal =
      String(formData.get("goal") || "").trim() ||
      "stay close to the material when attention slips";
    const pastedText = String(formData.get("sourceText") || "");
    const uploaded = formData.get("file");

    let sourceText = pastedText;
    let sourceKind = "paste";
    let pageRefs = [];
    let resolvedTitle = title;

    if (uploaded instanceof File && uploaded.size > 0) {
      if (uploaded.size > MAX_FILE_SIZE) {
        return Response.json(
          { error: "Keep uploads under 12 MB for the first POC." },
          { status: 400 },
        );
      }

      const extracted = await extractFile(uploaded);
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
      num: page.num,
      text: sanitize(page.text),
    })) : createPseudoPages(sourceText);
    const passages = createPassages(pages);
    const cards = createCards(passages, goal);
    const wordCount = sourceText.split(/\s+/).filter(Boolean).length;

    return Response.json({
      documentTitle: resolvedTitle || "Untitled study source",
      goal,
      sourceKind,
      focusTags: collectFocusTags(passages),
      cards,
      stats: {
        estimatedMinutes: Math.max(4, Math.round(wordCount / 180)),
        cardCount: cards.length,
        chunkCount: passages.length,
      },
    });
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

async function extractFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const title = file.name.replace(/\.[^.]+$/, "");

  if (file.type === "application/pdf" || extension === "pdf") {
    return extractPdf(file, title);
  }

  const text = await file.text();
  return {
    title,
    text,
    pages: text
      .split(/\n{2,}/)
      .map((block, index) => ({
        num: index + 1,
        text: block,
      }))
      .filter((page) => page.text.trim()),
    sourceKind: "file",
  };
}

async function extractPdf(file, title) {
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    return {
      title,
      text: result.text,
      pages: result.pages
        .map((page) => ({ num: page.num, text: page.text }))
        .filter((page) => page.text.trim()),
      sourceKind: "pdf",
    };
  } finally {
    await parser.destroy();
  }
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
      pages.push({ num: pageNum, text: current });
      pageNum += 1;
      current = block;
      continue;
    }
    current = next;
  }

  if (current) {
    pages.push({ num: pageNum, text: current });
  }

  return pages.length ? pages : [{ num: 1, text }];
}

function createPassages(pages) {
  const passages = [];

  for (const page of pages) {
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
        citation: `Page ${page.num}`,
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
