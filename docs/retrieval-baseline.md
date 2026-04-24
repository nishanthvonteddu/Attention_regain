# Chunking And Retrieval Baseline

Day 07 stores source chunks before card generation so every generated card can
point back to a stable source unit.

## Chunking Rules

- Chunks are built page by page and preserve source order with a zero-based
  `sequence`.
- Blank-line separated paragraphs are the primary boundaries.
- Short adjacent paragraphs are merged until the chunk reaches the target size.
- Oversized paragraphs are split on sentence boundaries.
- Each chunk carries `pageNumber`, `sectionLabel`, `paragraphStart`,
  `paragraphEnd`, `citation`, token estimate, text counts, and topics.

Citation format:

- One paragraph: `Page 2, paragraph 4`
- Paragraph range: `Page 2, paragraphs 4-6`

## Retrieval Strategy

For small documents, every chunk is sent to generation. For larger documents,
the baseline retriever scores chunks against the document title and study goal
using deterministic keyword overlap, topic matches, and a small early-source
position boost. Selected chunks are sorted back into source order before
generation so cards remain readable and citations are predictable.

When the query has too little signal or no chunk clears the confidence floor, the
retriever falls back to an even spread across the document. This keeps large
documents from silently depending on the opening pages while still avoiding a
full-context prompt.

## Tuning Notes

- `minChunkChars` keeps single short paragraphs from becoming noisy standalone
  cards.
- `targetChunkChars` keeps chunks compact enough for prompt stability.
- `maxChunkChars` prevents very long paragraphs from dominating retrieval.
- `maxRetrievedChunks` caps generation context and should move with model
  context budget, latency, and card quality observations.

Embedding fields remain on `document_chunks` for the hosted retrieval worker.
The local MVP marks chunks as pending and uses lexical retrieval until an
embedding service is wired in.
