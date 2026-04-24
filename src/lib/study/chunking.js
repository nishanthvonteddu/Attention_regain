import { estimateTokens } from "../data/schema.js";

export const CHUNKING_LIMITS = Object.freeze({
  minChunkChars: 240,
  targetChunkChars: 760,
  maxChunkChars: 980,
  maxRetrievedChunks: 8,
});

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

export function buildDocumentChunks(pages, options = {}) {
  const limits = { ...CHUNKING_LIMITS, ...options };
  const chunks = [];

  for (const page of Array.isArray(pages) ? pages : []) {
    const pageNumber = resolvePageNumber(page, chunks.length + 1);
    const paragraphs = splitParagraphs(page?.text);
    let sectionLabel = String(page?.citation || `Page ${pageNumber}`);
    let buffer = null;

    for (const paragraph of paragraphs) {
      if (looksLikeSectionHeading(paragraph.text)) {
        sectionLabel = trimText(paragraph.text.replace(/^[#\d.\s-]+/, ""), 80);
      }

      const paragraphPieces = splitOversizedParagraph(paragraph, limits.maxChunkChars);
      for (const piece of paragraphPieces) {
        if (!buffer) {
          buffer = createChunkBuffer(piece, sectionLabel);
          continue;
        }

        const combinedText = `${buffer.text}\n\n${piece.text}`;
        const canMerge =
          combinedText.length <= limits.targetChunkChars ||
          buffer.text.length < limits.minChunkChars;

        if (canMerge && piece.start === buffer.end + 1) {
          buffer = {
            ...buffer,
            text: combinedText,
            end: piece.end,
            sectionLabel,
          };
          continue;
        }

        chunks.push(materializeChunk(buffer, chunks.length, pageNumber));
        buffer = createChunkBuffer(piece, sectionLabel);
      }
    }

    if (buffer) {
      chunks.push(materializeChunk(buffer, chunks.length, pageNumber));
    }
  }

  if (chunks.length) {
    return chunks;
  }

  const fallbackText = (Array.isArray(pages) ? pages : [])
    .map((page) => String(page?.text || ""))
    .join("\n\n")
    .trim();
  return fallbackText
    ? [
        materializeChunk(
          {
            text: fallbackText,
            start: 1,
            end: 1,
            sectionLabel: "Section 1",
          },
          0,
          1,
        ),
      ]
    : [];
}

export function selectRetrievalPassages(chunks, { title = "", goal = "", maxPassages } = {}) {
  const candidates = Array.isArray(chunks) ? chunks : [];
  const limit = Math.max(1, Number(maxPassages) || CHUNKING_LIMITS.maxRetrievedChunks);
  if (candidates.length <= limit) {
    return {
      passages: candidates.map((chunk, index) => annotateRetrieval(chunk, {
        rank: index + 1,
        score: 1,
        reason: "all_chunks_fit",
      })),
      stats: {
        strategy: "all-chunks",
        totalChunkCount: candidates.length,
        retrievedChunkCount: candidates.length,
        lowConfidence: false,
      },
    };
  }

  const queryTerms = extractTerms(`${title} ${goal}`);
  const scored = candidates.map((chunk) => {
    const chunkTerms = extractTerms([
      chunk.text,
      chunk.sectionLabel,
      ...(Array.isArray(chunk.topics) ? chunk.topics : []),
    ].join(" "));
    const score = scoreChunk({ chunk, chunkTerms, queryTerms, totalChunks: candidates.length });

    return { chunk, score };
  });
  const ranked = scored
    .sort((left, right) => right.score - left.score || left.chunk.sequence - right.chunk.sequence)
    .slice(0, limit);
  const lowConfidence = !queryTerms.length || ranked.every((entry) => entry.score < 0.12);
  const selected = lowConfidence
    ? selectEvenly(candidates, limit).map((chunk, index) => ({
        chunk,
        score: 0,
        rank: index + 1,
        reason: "low_confidence_even_spread",
      }))
    : ranked.map((entry, index) => ({
        ...entry,
        rank: index + 1,
        reason: "query_term_overlap",
      }));

  return {
    passages: selected
      .sort((left, right) => left.chunk.sequence - right.chunk.sequence)
      .map((entry) => annotateRetrieval(entry.chunk, {
        rank: entry.rank,
        score: entry.score,
        reason: entry.reason,
      })),
    stats: {
      strategy: lowConfidence ? "even-spread-fallback" : "keyword-overlap",
      totalChunkCount: candidates.length,
      retrievedChunkCount: selected.length,
      queryTermCount: queryTerms.length,
      lowConfidence,
    },
  };
}

export function splitIntoSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function extractTopics(text) {
  const counts = new Map();
  for (const word of extractTerms(text)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

function splitParagraphs(text) {
  const blocks = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean);

  return blocks.map((paragraph, index) => ({
    text: paragraph,
    start: index + 1,
    end: index + 1,
  }));
}

function splitOversizedParagraph(paragraph, maxChunkChars) {
  if (paragraph.text.length <= maxChunkChars) {
    return [paragraph];
  }

  const pieces = [];
  let current = "";
  for (const sentence of splitIntoSentences(paragraph.text)) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxChunkChars && current) {
      pieces.push({ ...paragraph, text: current.trim() });
      current = sentence;
      continue;
    }
    current = next;
  }

  if (current) {
    pieces.push({ ...paragraph, text: current.trim() });
  }

  return pieces.length ? pieces : [paragraph];
}

function createChunkBuffer(piece, sectionLabel) {
  return {
    text: piece.text,
    start: piece.start,
    end: piece.end,
    sectionLabel,
  };
}

function materializeChunk(buffer, sequence, pageNumber) {
  const text = buffer.text.trim();
  const paragraphStart = buffer.start;
  const paragraphEnd = buffer.end;
  const citation = buildCitation({ pageNumber, paragraphStart, paragraphEnd });
  const sentences = splitIntoSentences(text);

  return {
    sequence,
    citation,
    pageNumber,
    sectionLabel: buffer.sectionLabel || `Page ${pageNumber}`,
    paragraphStart,
    paragraphEnd,
    text,
    sentences,
    topics: extractTopics(text),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    characterCount: text.length,
    tokenEstimate: estimateTokens(text),
  };
}

function buildCitation({ pageNumber, paragraphStart, paragraphEnd }) {
  if (paragraphStart === paragraphEnd) {
    return `Page ${pageNumber}, paragraph ${paragraphStart}`;
  }
  return `Page ${pageNumber}, paragraphs ${paragraphStart}-${paragraphEnd}`;
}

function scoreChunk({ chunk, chunkTerms, queryTerms, totalChunks }) {
  if (!queryTerms.length || !chunkTerms.length) {
    return 0;
  }

  const chunkTermSet = new Set(chunkTerms);
  const overlap = queryTerms.filter((term) => chunkTermSet.has(term)).length;
  const coverage = overlap / queryTerms.length;
  const topicBoost = (Array.isArray(chunk.topics) ? chunk.topics : [])
    .map((topic) => topic.toLowerCase())
    .filter((topic) => queryTerms.includes(topic)).length * 0.08;
  const positionBoost = Math.max(0, 1 - chunk.sequence / Math.max(totalChunks, 1)) * 0.04;

  return coverage + topicBoost + positionBoost;
}

function extractTerms(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z][a-z'-]{3,}/g)
    ?.filter((word) => !STOP_WORDS.has(word)) || [];
}

function selectEvenly(chunks, limit) {
  if (chunks.length <= limit) {
    return chunks;
  }

  const selected = [];
  const lastIndex = chunks.length - 1;
  for (let index = 0; index < limit; index += 1) {
    selected.push(chunks[Math.round((index * lastIndex) / Math.max(limit - 1, 1))]);
  }
  return [...new Map(selected.map((chunk) => [chunk.sequence, chunk])).values()];
}

function annotateRetrieval(chunk, retrieval) {
  return {
    ...chunk,
    retrieval,
  };
}

function resolvePageNumber(page, fallback) {
  return Number.isSafeInteger(page?.pageNumber)
    ? page.pageNumber
    : Number.isSafeInteger(page?.num)
      ? page.num
      : fallback;
}

function looksLikeSectionHeading(text) {
  const normalized = String(text || "").trim();
  return normalized.length > 0 && normalized.length <= 90 && !/[.!?]$/.test(normalized);
}

function trimText(text, maxLength) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}...`;
}
