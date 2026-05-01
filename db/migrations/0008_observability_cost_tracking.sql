-- Day 13 observability and cost tracking.
-- Product events are owner-scoped and append-only so support can inspect the
-- upload, parse, generation, retry, failure, latency, and cost trail.

CREATE TABLE IF NOT EXISTS observability_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  document_id TEXT REFERENCES documents(id),
  session_id TEXT REFERENCES study_sessions(id),
  job_id TEXT REFERENCES document_processing_jobs(id),
  event_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  cost JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS observability_events_user_created_idx
  ON observability_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS observability_events_document_created_idx
  ON observability_events(document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS observability_events_stage_status_created_idx
  ON observability_events(stage, status, created_at DESC);
