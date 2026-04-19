# Attention Regain MVP Plan

## Current Project State

The project is currently at `functional POC`.

What already exists:

- `Next.js` app shell
- source intake with pasted text and PDF upload
- PDF text extraction path
- study feed UI
- NVIDIA-backed generation path with fallback
- browser-local session persistence

What still needs to be built for MVP:

- AWS-backed auth
- persistent backend data model
- private S3 document storage
- queued background processing
- grounded document retrieval pipeline
- resumable study history and progress loops
- operational logging, rate limiting, and CI hardening
- AWS deployment and smoke-tested release flow

## MVP Outcome

By Day 15, the app should support this production-intended flow:

1. user signs in
2. user uploads a private exam-prep document
3. file is stored privately in S3
4. parsing and generation happen through a queued backend flow
5. user receives a grounded feed with citations
6. user can save, review again, and lock cards
7. user can come back later and resume progress
8. the app runs outside local development on AWS

## Execution Rules

- target user: `exam prep`
- target inputs: `PDF` and `pasted text`
- target outputs: `grounded study cards`
- every generated card must include a citation reference
- creative wording is allowed, invented facts are not
- every document must be resumable
- daily work ships to a review branch, not directly to `main`

## Recommended MVP Stack

- web app and server: `Next.js`
- auth: `Amazon Cognito`
- database: `Postgres on AWS`
- file storage: `Amazon S3`
- queue: `Amazon SQS`
- worker: `AWS Lambda` or a small worker service
- deployment: `AWS Amplify Hosting` or `AWS App Runner`
- parsing: text PDF first, OCR as explicit fallback
- model provider: user-provided

## Day-By-Day Build Plan

### Day 1: Project foundation, environment, and CI setup

Objective:
Establish the execution baseline so the next 14 days can move without setup churn.

Scope:

- finalize repo standards and branch workflow
- add environment contract and validation plan
- define required AWS resource inventory
- add CI pipeline for lint, build, and test validation
- add baseline docs for local setup, validation, and release workflow

Definition of done:

- project setup decisions are documented
- local bootstrap flow is clear
- CI runs the required checks
- environment variables and ownership are defined

### Day 2: Auth boundary and protected app shell

Objective:
Move the app from anonymous local usage into an authenticated product shell.

Scope:

- wire Cognito integration points
- build sign-in and sign-out flow
- protect private routes and document ownership boundaries
- add auth-aware loading and failure states

Definition of done:

- auth shell works end to end
- private product routes are protected
- anonymous users cannot access saved study data

### Day 3: Persistent data layer and migrations

Objective:
Replace browser-only persistence with a real backend data model.

Scope:

- connect `Postgres`
- create schema and migrations
- add data access layer for documents, chunks, cards, sessions, and interactions
- persist document and session state

Definition of done:

- core data model is stored in the database
- migrations are committed
- persistence no longer depends on browser-only state

### Day 4: Private S3 upload pipeline

Objective:
Move document storage into private AWS infrastructure.

Scope:

- add private S3 upload flow
- persist object metadata
- validate file type, file size, and empty uploads
- bind every document to an authenticated owner

Definition of done:

- documents upload into private S3
- invalid uploads fail cleanly
- stored objects are traceable to the document record

### Day 5: Reliable PDF parsing and source references

Objective:
Make normal text PDFs parse reliably and preserve source structure.

Scope:

- parse text PDFs in the backend flow
- store extracted text and per-page references
- detect empty or low-signal parse results
- identify likely OCR-needed documents

Definition of done:

- normal PDFs parse successfully
- citations can point to page-level references
- failure states are explicit

### Day 6: Background queue and worker pipeline

Objective:
Stop doing fragile request-time processing and move work into a queue.

Scope:

- add queue contract with `SQS`
- create worker entry point
- move parsing and generation orchestration into async processing
- add processing status transitions, retries, and dead-letter behavior

Definition of done:

- uploads trigger queued work
- UI reflects background progress
- failed jobs are visible and retryable

### Day 7: Chunking and retrieval baseline

Objective:
Create a stable grounding layer for long-document generation.

Scope:

- chunk by page and paragraph
- normalize chunk sizes for generation stability
- store citation metadata on every chunk
- add a simple retrieval strategy for long documents

Definition of done:

- large documents are chunked consistently
- retrieval can select relevant chunks for generation
- chunk metadata is citation-ready

### Day 8: Grounded generation hardening

Objective:
Make model output predictable, valid, and safe to persist.

Scope:

- enforce strict JSON response contract
- validate and reject malformed cards
- require citations on every saved card
- make generation failures visible to the user

Definition of done:

- generated cards are schema-valid
- uncited cards are rejected
- model failures do not corrupt document state

### Day 9: Feed persistence and comeback-later flow

Objective:
Make the study experience resumable across sessions.

Scope:

- load cards from the database
- persist user interactions per card
- restore last active document and session
- handle processing and failure states in the feed UI

Definition of done:

- users can leave and come back later
- session state persists server-side
- feed status is accurate for ready, processing, and failed documents

### Day 10: Progress loop and learning actions

Objective:
Turn the feed into a real study loop instead of passive scrolling.

Scope:

- persist `save`, `review again`, and `locked in`
- compute progress by document
- surface weak-card and saved-card counts
- define resurfacing rules for weak cards

Definition of done:

- core learning actions are durable
- progress is measurable
- weak cards can be intentionally resurfaced

### Day 11: OCR fallback and failure recovery

Objective:
Handle the scanned-PDF edge case without silent failure.

Scope:

- add OCR routing contract
- mark OCR-needed documents explicitly
- add recovery states and retry controls
- surface parse and OCR failures clearly in the UI

Definition of done:

- scanned files move into an explicit fallback path
- users understand what failed and what to retry
- OCR-ready records are distinguishable from normal parse records

### Day 12: Security, privacy, and abuse controls

Objective:
Harden the MVP so user documents stay private and misuse is bounded.

Scope:

- enforce document ownership checks
- keep S3 objects private
- add rate limiting and basic abuse controls
- review secrets handling and security headers

Definition of done:

- cross-user document access is blocked
- secrets remain server-side
- baseline abuse controls are active

### Day 13: Observability and cost tracking

Objective:
Make the product operable in practice.

Scope:

- log uploads, parses, generations, retries, and failures
- measure time to first feed
- estimate or record model cost per document
- provide a minimal operational visibility surface

Definition of done:

- critical product events are traceable
- cost per document is measurable
- latency to first feed is visible

### Day 14: Full MVP validation and frontend hardening

Objective:
Run the product like a release candidate and fix what breaks.

Scope:

- run end-to-end happy-path and failure-path validation
- harden mobile and desktop UI behavior
- clean up major accessibility and UX regressions
- make CI gating match release expectations

Definition of done:

- critical flows pass validation
- top frontend regressions are resolved
- CI reflects the final release bar

### Day 15: AWS deployment and release readiness

Objective:
Ship the MVP outside local development and lock the first releasable version.

Scope:

- deploy the web app and backend dependencies to AWS
- configure production environment variables
- validate auth callbacks, storage access, queue processing, and database connectivity
- run production smoke tests and release checks

Definition of done:

- the MVP is live on AWS
- core smoke tests pass in production
- rollback notes and release checklist exist
