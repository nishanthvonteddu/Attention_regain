# Background Worker Contract

Day 06 moves parse and card-generation orchestration out of `POST /api/study-feed`
and into a durable document-processing queue.

## Queue Message Contract

Each job payload is a JSON object with this shape:

```json
{
  "version": 1,
  "queueName": "document-processing",
  "documentId": "doc_...",
  "title": "Document title",
  "goal": "Study goal",
  "source": {
    "type": "inline_text | inline_file",
    "sourceKind": "paste | file | pdf",
    "text": "normalized source text when inline_text",
    "fileName": "source.pdf when inline_file",
    "contentType": "application/pdf when inline_file",
    "sizeBytes": 12345,
    "base64": "raw uploaded bytes when inline_file"
  }
}
```

## Worker Entry Point

The worker entry point is `src/lib/jobs/document-processing-worker.js`.

Responsibilities:

- claim one queued or retryable job for a specific document
- move the document into `processing`
- parse the source and persist page diagnostics
- generate grounded cards through the normal pipeline
- mark success, schedule retry, or dead-letter the job explicitly

The worker is the only layer that owns long-running parse and generation work.
API routes may enqueue and nudge jobs, but they do not parse PDFs or build cards
inside the request path anymore.

## Retry And Dead-Letter Rules

- `queued`: ready to run
- `processing`: currently leased by a worker
- `retrying`: prior attempt failed and will be retried after backoff
- `succeeded`: worker finished; terminal document status lives on the document row
- `dead_letter`: max attempts exhausted; document status is set to `failed`

The local MVP adapter stores jobs in the JSON repository so queued work survives
route boundaries. Future AWS wiring can map the same payload contract onto SQS.
