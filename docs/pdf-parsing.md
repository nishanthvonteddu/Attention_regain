# PDF Parsing Contract

Day 05 makes PDF extraction a backend contract instead of route-local helper
code. The parser runs only in the Node.js server runtime, extracts page-level
text, and records explicit diagnostics before cards are generated.

## Flow

1. Validate the upload descriptor as a PDF or text source.
2. Parse PDFs with `pdf-parse` on the server.
3. Normalize extracted text and page records.
4. Assess parse signal before retrieval or generation.
5. Persist parsed page text and diagnostics for uploaded documents.
6. Generate passages and cards only from readable source text.

## Parse States

- `parsed`: readable text was extracted and page references are available.
- `ocr_needed`: the PDF has no text or too little text signal for grounded
  generation; scanned and image-heavy files land here.
- `parse_failed`: the PDF parser could not read the document structure.

The API returns the explicit parse state and diagnostic code for failures.
When the request is tied to a private upload record, the same state is persisted
on the document and the upload is marked failed unless it has already been
consumed.

## Stored Output

- `documents.page_count` and `documents.parse_status` summarize the latest parse.
- `document_pages` stores normalized page text and citation labels.
- `document_parse_diagnostics` stores parser name, status, code, counts, and
  warnings for debugging and user-facing failure messages.
- `document_chunks.page_number` keeps generated passages aligned with source
  pages for retrieval and citations.

## Regression Coverage

The parser tests cover:

- a stable generated text PDF fixture with page-level extraction
- empty and low-signal parse heuristics
- invalid PDF parser failures
- repository persistence for page rows and diagnostics
- API failure responses for unreadable uploaded PDFs

The local fixture test also exercises `/Users/work/Downloads/AIAYN.pdf`,
`/Users/work/Downloads/SAM.pdf`, and `/Users/work/Downloads/OPUS.pdf` when those
files are present on the machine.
