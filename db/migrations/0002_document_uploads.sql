-- Day 04 private S3 upload metadata.
-- Uploads are owner-bound and traceable from documents to S3 object keys.

CREATE TABLE document_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ready', 'uploaded', 'consumed', 'failed')),
  provider TEXT NOT NULL CHECK (provider IN ('s3')),
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  object_uri TEXT NOT NULL,
  upload_mode TEXT NOT NULL CHECK (upload_mode IN ('presigned-put', 'metadata-only')),
  original_file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  etag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  UNIQUE (document_id),
  UNIQUE (bucket, object_key)
);

CREATE INDEX document_uploads_user_status_idx
  ON document_uploads(user_id, status, updated_at DESC);

CREATE INDEX document_uploads_document_idx
  ON document_uploads(document_id);
