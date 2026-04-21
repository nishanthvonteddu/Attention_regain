# Persistent Data Layer

Day 03 chooses a Postgres-compatible relational model for the MVP data layer. The
first implementation also includes a dependency-free local JSON adapter so the
authenticated app can persist document and session state server-side before the
hosted database is provisioned.

## Data Store Choice

- Production target: PostgreSQL, addressed through ordered SQL migrations under
  `db/migrations`.
- Local MVP adapter: `.data/attention-regain-store.json`, controlled by
  `ATTENTION_REGAIN_DATA_DIR`, for repeatable development and tests.
- Public identifiers: application-generated UUIDs, not incrementing IDs.
- Ownership boundary: every user-owned row carries `user_id`; repository
  functions must receive the authenticated user id before reading or writing.

## Core Entities

### users

Owns private study data. The Cognito subject or local preview subject maps to
`users.id`; email and display name are optional profile metadata.

### documents

Represents an uploaded PDF, uploaded text file, or pasted source. Documents are
owned by a user and move through parsing, chunking, card generation, and failure
states.

Fields:

- `id`, `user_id`, `title`, `source_kind`, `source_ref`
- `goal`, `status`, `content_hash`, `word_count`
- `created_at`, `updated_at`, `parsed_at`, `failed_at`
- `failure_reason`

### document_uploads

Tracks private S3 upload metadata for a document before parsing. Upload rows are
owned by the same user as the document and store bucket, object key, object URI,
original file name, content type, byte size, upload mode, and lifecycle
timestamps.

Statuses:

- `ready` after the server creates an owner-bound upload handshake.
- `uploaded` after the browser confirms the object reached private storage.
- `consumed` after study feed generation stores cards against that document.
- `failed` when upload confirmation or later processing cannot continue.

### document_chunks

Stores normalized source slices used for retrieval and grounded generation.
Chunks belong to one document and include stable citation text such as `Page 2`.
Embedding vectors are planned for the hosted adapter; the initial migration keeps
provider metadata and vector status separate from the chunk text.

### study_sessions

Represents one generated feed for one document and one goal. Sessions are owned
by a user, carry the selected generation mode and model, and track readiness for
the feed UI.

### study_cards

Stores generated or fallback cards. Cards belong to one session and usually point
back to a source chunk. Every card must retain a citation string and source
excerpt.

### study_interactions

Append-only interaction log for reveal, confidence, save, and dismiss events.
This keeps learning actions out of browser-only storage and leaves room for
later progress analytics.

## Status Transitions

Document status:

1. `draft` when the document row is created.
2. `uploaded` when a source file or pasted source is accepted.
3. `parsed` when readable text has been extracted.
4. `chunked` when source chunks have been stored.
5. `cards_generated` when at least one grounded card is persisted.
6. `failed` when parsing, chunking, or generation cannot complete.

Session status:

1. `building` while the feed request is active.
2. `ready` after cards and citations are stored.
3. `archived` when the user clears or replaces the session.
4. `failed` when generation cannot produce valid cards.

Card status:

1. `active` when visible in the feed.
2. `saved` when explicitly saved by the user.
3. `dismissed` when hidden from the current study loop.

Interaction types:

- `reveal_answer`
- `save_card`
- `unsave_card`
- `set_confidence`
- `dismiss_card`

## Migration Scope

Migration `0001_core_schema.sql` creates:

- `users`
- `documents`
- `document_chunks`
- `study_sessions`
- `study_cards`
- `study_interactions`
- lookup check constraints and indexes for owner-scoped queries

Migration `0002_document_uploads.sql` creates:

- `document_uploads`
- owner and document foreign keys
- unique S3 bucket/object-key traceability
- upload lifecycle indexes for owner-scoped queries

Rollout order:

1. Create owner table and document tables.
2. Create chunks after documents.
3. Create sessions after documents.
4. Create cards after sessions and chunks.
5. Create interactions after sessions and cards.
6. Add indexes for user dashboards, latest session lookup, and source retrieval.
7. Add upload metadata after the core document table exists.

Rollback expectation: Day 03 migrations are reversible before production data is
loaded. After real user data exists, rollback should be a forward migration that
preserves user rows, documents, upload metadata, chunks, cards, sessions, and
interactions.

## Repository Boundaries

UI responsibilities:

- Gather source input.
- Render feed and interaction controls.
- Send interaction events to server routes.

API responsibilities:

- Enforce authenticated user boundaries.
- Parse files and normalize text.
- Call retrieval or generation services.
- Pass persistence requests through repository services only.

Repository responsibilities:

- Generate public resource IDs.
- Store documents, chunks, sessions, cards, and interactions.
- Return only rows owned by the authenticated user.
- Keep local JSON storage and future Postgres storage behind the same service
  boundary.

Worker responsibilities:

- Later background jobs will read pending documents, fill chunk embeddings, run
  retrieval and reranking, and update sessions through repository services.

## Local Reset And Fixtures

Run this to reset local development state:

```sh
node scripts/reset-local-data.mjs --seed
```

Run this to clear the local store:

```sh
node scripts/reset-local-data.mjs --empty
```

The seeded fixture covers one user, one PDF document, two chunks, one ready
study session, two cards, and interaction examples. Tests may set
`ATTENTION_REGAIN_DATA_DIR` to a temporary directory to avoid touching the local
developer store.
