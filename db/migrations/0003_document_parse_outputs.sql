-- Day 05 reliable PDF parsing and source references.
-- Parsed pages and diagnostics stay owner-reachable through documents.

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check CHECK (
    status IN (
      'draft',
      'uploaded',
      'parsed',
      'chunked',
      'cards_generated',
      'ocr_needed',
      'parse_failed',
      'failed'
    )
  );

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  ADD COLUMN IF NOT EXISTS parse_status TEXT CHECK (
    parse_status IN ('parsed', 'ocr_needed', 'parse_failed')
  );

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS page_number INTEGER CHECK (page_number > 0);

CREATE TABLE document_pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  citation TEXT NOT NULL,
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  character_count INTEGER NOT NULL DEFAULT 0 CHECK (character_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, page_number)
);

CREATE TABLE document_parse_diagnostics (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('parsed', 'ocr_needed', 'parse_failed')),
  code TEXT NOT NULL,
  parser TEXT NOT NULL,
  reason TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  pages_with_text INTEGER NOT NULL DEFAULT 0 CHECK (pages_with_text >= 0),
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  character_count INTEGER NOT NULL DEFAULT 0 CHECK (character_count >= 0),
  average_page_chars INTEGER NOT NULL DEFAULT 0 CHECK (average_page_chars >= 0),
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX document_pages_document_page_idx
  ON document_pages(document_id, page_number);

CREATE INDEX document_parse_diagnostics_document_created_idx
  ON document_parse_diagnostics(document_id, created_at DESC);
