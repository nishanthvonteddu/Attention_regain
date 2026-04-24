-- Day 07 chunking and retrieval baseline.
-- Chunks become stable page/paragraph source units before generation.

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS section_label TEXT,
  ADD COLUMN IF NOT EXISTS paragraph_start INTEGER CHECK (paragraph_start > 0),
  ADD COLUMN IF NOT EXISTS paragraph_end INTEGER CHECK (paragraph_end > 0),
  ADD COLUMN IF NOT EXISTS word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  ADD COLUMN IF NOT EXISTS character_count INTEGER NOT NULL DEFAULT 0 CHECK (character_count >= 0),
  ADD COLUMN IF NOT EXISTS retrieval_rank INTEGER CHECK (retrieval_rank > 0),
  ADD COLUMN IF NOT EXISTS retrieval_score REAL CHECK (retrieval_score >= 0),
  ADD COLUMN IF NOT EXISTS retrieval_reason TEXT;

CREATE INDEX IF NOT EXISTS document_chunks_document_page_paragraph_idx
  ON document_chunks(document_id, page_number, paragraph_start, sequence);

CREATE INDEX IF NOT EXISTS document_chunks_document_retrieval_idx
  ON document_chunks(document_id, retrieval_rank)
  WHERE retrieval_rank IS NOT NULL;
