-- Day 06 background document processing jobs.
-- Upload requests enqueue work; workers own parse and generation retries.

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check CHECK (
    status IN (
      'draft',
      'uploaded',
      'queued',
      'processing',
      'parsed',
      'chunked',
      'cards_generated',
      'ocr_needed',
      'parse_failed',
      'failed'
    )
  );

CREATE TABLE document_processing_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  queue_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'processing', 'retrying', 'succeeded', 'dead_letter')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  payload_json TEXT NOT NULL,
  result_status TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX document_processing_jobs_document_created_idx
  ON document_processing_jobs(document_id, created_at DESC);

CREATE INDEX document_processing_jobs_queue_available_idx
  ON document_processing_jobs(queue_name, status, available_at);
