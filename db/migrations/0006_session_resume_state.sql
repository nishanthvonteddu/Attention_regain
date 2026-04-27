-- Day 09 resume-state indexes.
-- Existing timestamps carry last-active state; these indexes make resume lookup owner-scoped.

CREATE INDEX IF NOT EXISTS study_sessions_user_updated_idx
  ON study_sessions(user_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS study_sessions_document_updated_idx
  ON study_sessions(document_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS study_interactions_session_card_created_idx
  ON study_interactions(session_id, card_id, created_at DESC);
