export const MAX_SOURCE_CHARS = 80_000;
const TARGET_PASSAGE_COUNT = 8;
const ACTIVE_RECALL_RATIO = 0.66;

export type SourceKind = "demo" | "paste" | "file" | "pdf";
export type StudyCardKind = "glance" | "recall" | "application" | "pitfall";

export interface SourcePage {
  num: number;
  text: string;
}

export interface StudyCard {
  id: string;
  kind: StudyCardKind;
  title: string;
  body: string;
  question?: string;
  answer?: string;
  citation: string;
  page: number | null;
  excerpt: string;
}

export interface StudyDeck {
  documentTitle: string;
  goal: string;
  sourceKind: SourceKind;
  generatedAt: string;
  preview: string;
  focusTags: string[];
  cards: StudyCard[];
  stats: {
    wordCount: number;
    pageCount: number;
    chunkCount: number;
    cardCount: number;
    activeRecallShare: number;
    estimatedMinutes: number;
  };
}

interface BuildStudyDeckInput {
  title: string;
  goal: string;
  sourceText: string;
  sourceKind: SourceKind;
  pages?: SourcePage[];
}

interface Passage {
  id: string;
  text: string;
  sentences: string[];
  page: number | null;
  citation: string;
  topics: string[];
}

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

export const sampleSource = {
  id: "attention-demo",
  title: "Focused Reading for Interview Preparation",
  goal: "prepare for interviews without drifting into passive rereading",
  body: `
Interview prep fails when reading stays passive. A candidate can spend hours with a system design article or a machine learning paper and still remember very little because the session feels productive without demanding retrieval. Attention needs a task, not just a source.

Working memory is narrow. When a page introduces several new ideas at once, the brain cannot hold all of them with equal clarity. Strong readers reduce load by chunking concepts, naming the main move in each section, and revisiting the thread before the details disappear.

Retrieval practice turns reading into memory. Instead of highlighting another sentence, the learner pauses and asks, "What was the claim here, and why did it matter?" That short pause forces reconstruction. Reconstruction is effortful, but the effort is exactly what makes later recall faster.

Spacing matters because familiarity is deceptive. When the same page is reread immediately, the text feels fluent, and that fluency can be mistaken for understanding. Returning later introduces a little friction, and the friction reveals what has and has not been stored.

Elaboration improves transfer. If a paragraph explains a tradeoff, the learner should connect it to a likely interview question, an exam prompt, or a real decision. A concept becomes more durable when it can be restated in a new setting without copying the original words.

Interleaving keeps attention awake. Mixing architecture, behavioral preparation, and core theory is often more demanding than finishing one topic in a single block, but the switching pressure teaches discrimination. The learner stops relying on pattern repetition and starts identifying what makes one concept different from another.

The goal is not to make studying feel heavy. The goal is to make the easy action useful. If the student is already reaching for a phone, a feed grounded in the actual source material can capture that habit and redirect it toward repetition, recall, and explanation.
`.trim(),
};

export function sanitizeSource(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

export function buildStudyDeck(input: BuildStudyDeckInput): StudyDeck {
  const goal = input.goal.trim() || "stay close to the material when attention slips";
  const sourceText = sanitizeSource(input.sourceText);
  const pages = input.pages?.length
    ? input.pages
        .map((page) => ({
          num: page.num,
          text: sanitizeSource(page.text),
        }))
        .filter((page) => page.text.length > 0)
    : createPseudoPages(sourceText);
  const passages = createPassages(pages);
  const cards = createCards(passages, goal);
  const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
  const estimatedMinutes = Math.max(4, Math.round(wordCount / 180));
  const focusTags = collectFocusTags(passages);

  return {
    documentTitle: input.title.trim() || "Untitled study source",
    goal,
    sourceKind: input.sourceKind,
    generatedAt: new Date().toISOString(),
    preview: sentencesToSummary(splitIntoSentences(sourceText), 2, 220),
    focusTags,
    cards,
    stats: {
      wordCount,
      pageCount: pages.length,
      chunkCount: passages.length,
      cardCount: cards.length,
      activeRecallShare: ACTIVE_RECALL_RATIO,
      estimatedMinutes,
    },
  };
}

export const demoDeck = buildStudyDeck({
  title: sampleSource.title,
  goal: sampleSource.goal,
  sourceText: sampleSource.body,
  sourceKind: "demo",
});

function createPseudoPages(sourceText: string): SourcePage[] {
  const chunks: SourcePage[] = [];
  const blocks = sourceText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  let current = "";
  let pageNum = 1;

  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > 1500 && current) {
      chunks.push({ num: pageNum, text: current });
      pageNum += 1;
      current = block;
      continue;
    }
    current = next;
  }

  if (current) {
    chunks.push({ num: pageNum, text: current });
  }

  return chunks.length > 0 ? chunks : [{ num: 1, text: sourceText }];
}

function createPassages(pages: SourcePage[]): Passage[] {
  const passages: Passage[] = [];

  for (const page of pages) {
    const blocks = page.text
      .split(/\n{2,}/)
      .flatMap((block) => splitLongBlock(block.trim()))
      .filter((block) => block.length > 120);

    for (const block of blocks) {
      const sentences = splitIntoSentences(block);
      if (sentences.length === 0) {
        continue;
      }

      passages.push({
        id: `passage-${page.num}-${passages.length + 1}`,
        text: block,
        sentences,
        page: page.num,
        citation: `Page ${page.num}`,
        topics: extractTopics(block),
      });

      if (passages.length >= TARGET_PASSAGE_COUNT) {
        return passages;
      }
    }
  }

  if (passages.length > 0) {
    return passages;
  }

  const fallbackSentences = splitIntoSentences(pages.map((page) => page.text).join(" "));
  if (fallbackSentences.length === 0) {
    return [];
  }

  return [
    {
      id: "passage-1",
      text: fallbackSentences.join(" "),
      sentences: fallbackSentences,
      page: 1,
      citation: "Section 1",
      topics: extractTopics(fallbackSentences.join(" ")),
    },
  ];
}

function splitLongBlock(block: string) {
  const sentences = splitIntoSentences(block);
  if (sentences.length <= 2 && block.length < 420) {
    return [block];
  }

  const segments: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > 420 && current) {
      segments.push(current.trim());
      current = sentence;
      continue;
    }
    current = next;
  }

  if (current) {
    segments.push(current.trim());
  }

  return segments.length > 0 ? segments : [block];
}

function splitIntoSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function createCards(passages: Passage[], goal: string): StudyCard[] {
  const primaryCards = passages.map((passage, index) => {
    const slot = index % 4;
    if (slot === 0) {
      return createGlanceCard(passage, index);
    }
    if (slot === 1) {
      return createRecallCard(passage, index);
    }
    if (slot === 2) {
      return createApplicationCard(passage, index, goal);
    }
    return createPitfallCard(passage, index);
  });

  const reinforcementCards = passages
    .slice(0, Math.min(passages.length, 6))
    .map((passage, index) =>
      index % 2 === 0
        ? createRecallCard(passage, primaryCards.length + index, true)
        : createApplicationCard(
            passage,
            primaryCards.length + index,
            goal,
            true,
          ),
    );

  return [...interleave(primaryCards, reinforcementCards)].slice(0, 16);
}

function interleave(primaryCards: StudyCard[], reinforcementCards: StudyCard[]) {
  const cards: StudyCard[] = [];
  const maxLength = Math.max(primaryCards.length, reinforcementCards.length);

  for (let index = 0; index < maxLength; index += 1) {
    const primary = primaryCards[index];
    const reinforcement = reinforcementCards[index];

    if (primary) {
      cards.push(primary);
    }

    if (reinforcement) {
      cards.push(reinforcement);
    }
  }

  return cards;
}

function createGlanceCard(passage: Passage, index: number): StudyCard {
  return {
    id: `card-${index + 1}`,
    kind: "glance",
    title: buildTitle(passage),
    body: sentencesToSummary(passage.sentences, 2, 220),
    citation: passage.citation,
    page: passage.page,
    excerpt: trimText(passage.text, 170),
  };
}

function createRecallCard(
  passage: Passage,
  index: number,
  isReinforcement = false,
): StudyCard {
  const title = isReinforcement
    ? `Recall loop: ${buildTopicLabel(passage)}`
    : `Say it back: ${buildTopicLabel(passage)}`;

  return {
    id: `card-${index + 1}`,
    kind: "recall",
    title,
    body: isReinforcement
      ? "Reconstruct the idea before you expose the wording again."
      : "Pause the scroll. Try to restate this section in one clean sentence.",
    question: buildRecallQuestion(passage),
    answer: sentencesToSummary(passage.sentences, 2, 190),
    citation: passage.citation,
    page: passage.page,
    excerpt: trimText(passage.text, 170),
  };
}

function createApplicationCard(
  passage: Passage,
  index: number,
  goal: string,
  isReinforcement = false,
): StudyCard {
  const useCase = trimText(
    `Tie this back to ${goal}. The point is to make the source reusable, not just familiar.`,
    160,
  );

  return {
    id: `card-${index + 1}`,
    kind: "application",
    title: isReinforcement
      ? `Use this under pressure`
      : `Translate it to the real task`,
    body: useCase,
    question: `Where would ${buildTopicLabel(passage).toLowerCase()} show up when you ${goal}?`,
    answer: buildApplicationAnswer(passage, goal),
    citation: passage.citation,
    page: passage.page,
    excerpt: trimText(passage.text, 170),
  };
}

function createPitfallCard(passage: Passage, index: number): StudyCard {
  const contrast = passage.sentences[1] ?? passage.sentences[0];
  return {
    id: `card-${index + 1}`,
    kind: "pitfall",
    title: "What passive reading would blur",
    body: "This is the detail most likely to vanish if the session stays too fluent.",
    question: "What would you probably miss if you skimmed this section instead of recalling it?",
    answer: trimText(contrast, 180),
    citation: passage.citation,
    page: passage.page,
    excerpt: trimText(passage.text, 170),
  };
}

function buildTitle(passage: Passage) {
  const sentence = passage.sentences[0] ?? passage.text;
  const trimmed = sentence
    .replace(/^[\d.\-)\s]+/, "")
    .replace(/[;:,-]\s.*$/, "")
    .trim();

  return trimText(uppercaseFirst(trimmed), 68);
}

function buildRecallQuestion(passage: Passage) {
  const sentence = passage.sentences[0] ?? passage.text;
  const matcher = sentence.match(/^(.{4,80}?)\s+(is|are|can|should|must)\s+/i);

  if (matcher) {
    return `What does this source say about ${matcher[1].trim().toLowerCase()}?`;
  }

  return `How would you explain ${buildTopicLabel(passage).toLowerCase()} without rereading the source?`;
}

function buildApplicationAnswer(passage: Passage, goal: string) {
  const opening = passage.sentences[0] ?? passage.text;
  return trimText(
    `${opening} Keep it in reach when you ${goal}, especially when the same idea appears in a slightly different form.`,
    200,
  );
}

function buildTopicLabel(passage: Passage) {
  if (passage.topics.length > 0) {
    return passage.topics[0];
  }

  return trimText(buildTitle(passage).toLowerCase(), 36);
}

function extractTopics(text: string) {
  const words =
    text
      .toLowerCase()
      .match(/[a-z][a-z'-]{3,}/g)
      ?.filter((word) => !STOP_WORDS.has(word)) ?? [];
  const counts = new Map<string, number>();

  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([word]) => uppercaseFirst(word));
}

function collectFocusTags(passages: Passage[]) {
  const counts = new Map<string, number>();

  for (const passage of passages) {
    for (const topic of passage.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([topic]) => topic);
}

function sentencesToSummary(
  sentences: string[],
  sentenceCount: number,
  maxLength: number,
) {
  return trimText(sentences.slice(0, sentenceCount).join(" "), maxLength);
}

function trimText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function uppercaseFirst(text: string) {
  if (!text) {
    return text;
  }

  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
