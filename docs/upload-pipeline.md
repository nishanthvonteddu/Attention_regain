# Private Upload Pipeline

Day 04 adds the private S3 upload boundary that sits in front of PDF parsing and
feed generation. The local MVP can still parse uploaded bytes in the API route so
the real PDF fixtures remain testable before the Day 05 backend parser consumes
objects from S3.

## Flow

1. The authenticated app calls `POST /api/document-uploads` with file name,
   content type, size, title, and goal.
2. The server validates the descriptor, creates a document row, creates a
   document upload row, and returns owner-bound private object metadata.
3. When `ENABLE_AWS_SERVICES=true`, the response includes a short-lived
   presigned S3 `PUT` URL and the exact headers the browser must send.
4. The browser uploads the object to S3, then calls `PATCH /api/document-uploads`
   to mark the upload as complete.
5. `POST /api/study-feed` receives the upload document id, verifies that the
   record belongs to the current user, and consumes the upload record when cards
   are persisted.

## Ownership And Keys

Object keys are deterministic from the authenticated owner, document id, and
sanitized file name:

```text
private/users/<sha256-user-segment>/documents/<document-id>/source/<file-name>
```

The user id is hashed before it appears in the key, so object paths stay stable
without exposing raw account identifiers. The document id remains the bridge
between the database record and the S3 object URI.

## Validation Rules

- Supported uploads: PDF, TXT, MD, and TEXT files.
- Maximum upload size: 12 MB.
- Empty uploads are rejected before parsing.
- Unsupported MIME types or extensions are rejected with a clear error.
- Upload writes require a valid product session cookie and same-origin requests.

## Metadata

`document_uploads` records:

- owner id and document id
- S3 bucket, object key, and `s3://` object URI
- original file name, content type, and byte size
- lifecycle status: `ready`, `uploaded`, `consumed`, or `failed`
- creation, expiry, upload, and consumption timestamps

The `documents.source_ref` field stores the S3 object URI so document records can
be traced back to private storage.

## Local Mode

When AWS services are disabled, the same owner-bound metadata is persisted with
`upload_mode=metadata-only` and a local placeholder bucket. This keeps tests and
local PDF fixture validation deterministic while preserving the same repository
and API contract used by the S3 path.
