# Observability And Cost Tracking

Day 13 adds a small operator trail for MVP support. The local JSON adapter writes
append-only `observabilityEvents`; the production-shaped migration creates an
`observability_events` table with the same owner-scoped contract.

## Event Model

Critical events are named explicitly:

- `upload.prepared`, `upload.rejected`, `upload.confirmed`
- `generation.queued`, `generation.retry_queued`
- `job.claimed`, `job.retrying`, `job.dead_lettered`
- `parse.started`, `parse.succeeded`, `parse.failed`
- `chunking.succeeded`
- `generation.started`, `generation.succeeded`, `generation.fallback`,
  `generation.failed`
- `feed.ready`

Each event stores `userId`, optional `documentId`, optional `sessionId`, optional
`jobId`, `stage`, `status`, `latencyMs`, `cost`, `payload`, and `createdAt`.
Payloads are intentionally small and machine-readable: codes, counts, selected
model, failure reason, or source kind. The event trail is not a raw source-text
log and must not duplicate private document content.

## Latency Rules

`generation.queued` measures request-to-queue latency. Worker events then split
the background path into parse, chunking, retrieval, generation, and ready-feed
points. `feed.ready.latencyMs` is the current time-to-first-feed metric:

```text
feed.ready.createdAt - document_processing_jobs.createdAt
```

Pipeline stage timing is also persisted in `study_sessions.stats.pipelineTiming`
so a generated deck carries its own parse/chunk/retrieval/generation breakdown.

## Cost Rules

Every generated deck carries `study_sessions.stats.modelCost`.

- Heuristic fallback records zero estimated cost with a reason.
- Live model generation records estimated input/output tokens and estimated USD.
- When provider usage is returned, provider token counts win. Otherwise token
  counts use the existing repository token estimator.
- The default estimate is documented in code as USD per 1K input/output tokens
  and can be replaced when production model pricing is finalized.

The operational report aggregates estimated document spend from generation and
ready-feed events. It is an MVP support estimate, not an accounting ledger.

## Operator View

Authenticated users can load `/api/operations/report`. The protected workspace
shows a compact Health report with event count, failure count, latest
time-to-first-feed, estimated spend, and recent events. This keeps MVP debugging
inside the app instead of requiring raw infrastructure log access for every
support check.
