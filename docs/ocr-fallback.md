# OCR Fallback And Recovery

Day 11 keeps scanned and unreadable PDFs out of the normal generation path.
The worker still owns parse and generation, but low-signal extraction now
returns an explicit recovery contract instead of a generic failed state.

## Routing Contract

1. The worker parses the queued source.
2. Readable text follows the standard path: parse text, persist pages, chunk,
   retrieve, rerank, generate grounded cards, validate citations, persist feed.
3. Empty, scanned-like, or low-signal PDFs become `ocr_needed`.
4. Parser exceptions become `parse_failed`.
5. Generation failures remain `failed` and use the bounded retry path.

The OCR fallback route is terminal for the current job. A terminal parse outcome
marks the processing job `succeeded` with a result status of `ocr_needed` or
`parse_failed`, while the document itself carries the recovery state. This keeps
parse recovery distinct from job crashes and dead-lettered generation failures.

## Recovery States

- `ocr_needed`: the PDF has pages but too little extractable text for grounded
  cards. The user should supply an OCR text layer, export a cleaner copy, or
  reprocess when OCR support is available.
- `parse_failed`: the parser could not read the PDF structure. The user should
  retry after exporting the file again or upload another copy.
- `failed`: parsing succeeded, but generation did not produce a ready deck.

Every recovery response includes a badge, detail, next step, action label,
whether retry is currently allowed, and the remaining manual reprocess budget.

## Manual Retry Rules

Manual recovery is intentionally bounded. A document may have at most three
processing jobs, including the original job. The API rejects additional manual
reprocess requests after that limit so repeated clicks cannot create ambiguous
state or an unbounded local queue.

Active jobs cannot be retried. If the latest job is queued, processing, or
retrying, the route returns a conflict and leaves the current job in charge.

## Operator Notes

- `ocr_needed` is not a model-generation failure. Do not send low-signal text to
  retrieval or card generation.
- `parse_failed` is not OCR fallback. It means the parser could not load the PDF
  structure enough to classify it as scanned.
- A retry uses the stored job payload and moves the document back to `queued`.
- The fallback path must preserve source grounding: cards are generated only
  after readable text has been recovered and persisted with source references.
