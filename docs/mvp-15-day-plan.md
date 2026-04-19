# Attention Regain MVP Plan

## Current Phase

The project is currently in the `functional POC` phase.

What already exists:

- single-page Next.js app
- upload or paste source flow
- PDF text extraction
- generated study feed
- NVIDIA-backed live generation path with fallback
- browser-local session state

What is missing for MVP:

- auth
- persistent backend data model
- private file storage
- background generation
- real study history and progress loop
- operational logging and rate limiting
- AWS deployment

## MVP Target

By Day 15, the app should support this real user flow:

1. user signs in
2. user uploads a private exam-prep document
3. file is stored privately in S3
4. document is parsed and queued for generation
5. user gets a grounded study feed with citations
6. user can save cards, mark weak cards, and come back later
7. user can see progress on the document
8. app is deployed on AWS and usable outside local dev

## Recommended MVP Stack

Use this as the default build path unless you want to override it:

- frontend and app server: `Next.js`
- auth: `Amazon Cognito`
- file storage: `Amazon S3` with private buckets only
- primary app database: `Postgres` on AWS
- background queue: `Amazon SQS`
- background workers: `AWS Lambda` or a small worker service
- deployment: `AWS Amplify Hosting` for the web app, or `App Runner` if you prefer a container path
- document parsing: normal PDF text extraction first, OCR only as fallback
- AI provider: user-provided

`Postgres` is recommended instead of `DynamoDB` for the MVP because document state, cards, user actions, and progress history are relational and easier to query cleanly.

## Product Rules

- target user: `exam prep`
- target input: `PDF and pasted text`
- target output: `grounded study cards`
- every card must cite the source section or page
- creative phrasing is fine, invented facts are not
- every session must be resumable

## Day-by-Day Plan

### Day 1: Lock MVP scope and backend contracts

- Freeze the MVP scope around `exam prep only`
- Define the database entities
- Define the API contracts between UI, parser, generator, and progress system
- Decide the AWS deployment path

Subtasks:

- write the canonical MVP scope
- define tables for users, documents, chunks, cards, sessions, interactions
- define statuses for documents: `uploaded`, `processing`, `ready`, `failed`
- define statuses for cards: `new`, `saved`, `review`, `locked`
- decide whether deployment is `Amplify Hosting` or `App Runner`

Deliverable:

- stable technical blueprint and schema draft

### Day 2: Auth and environment foundation

- Integrate Cognito
- Add environment validation
- Separate server-only secrets from client config

Subtasks:

- configure Cognito user pool and app client
- add sign-in and sign-out flow
- protect private routes
- add env validation for AWS, model, and database settings
- add `.env.example`

Deliverable:

- authenticated app shell with safe config loading

### Day 3: Persistent backend data layer

- Add the real database layer
- Move away from browser-only persistence

Subtasks:

- connect Postgres
- create migrations
- create repository or service functions for documents, cards, sessions, interactions
- store document metadata and processing state

Deliverable:

- database-backed document records

### Day 4: Private upload pipeline

- Move uploads into private S3
- Keep files inaccessible from public URLs

Subtasks:

- create S3 upload path by user and document id
- generate secure upload flow
- save object key and metadata in database
- add size and file-type validation
- reject empty files and unsupported files

Deliverable:

- private file upload flow working end to end

### Day 5: Reliable document parsing

- Make PDF parsing robust for normal text PDFs
- Add fallback rules for failures

Subtasks:

- parse text PDFs on the server or worker side
- detect empty parse results
- detect likely scanned PDFs
- mark OCR-required documents separately instead of silently failing
- store extracted text and per-page references

Deliverable:

- stable parsing for normal PDFs with explicit failure states

### Day 6: Background generation pipeline

- Remove fragile request-time generation
- Queue generation work

Subtasks:

- add SQS queue for document processing
- create worker entry point
- move chunking and generation into the worker
- update document processing status in database
- add retry limits and dead-letter handling

Deliverable:

- queued processing instead of blocking UI requests

### Day 7: Source chunking and retrieval baseline

- Add a stable chunking strategy
- Keep every generated card tied to retrievable source passages

Subtasks:

- chunk by page and paragraph first
- add section-aware chunk boundaries where possible
- cap chunk length for generation stability
- store chunk citation data
- add simple retrieval for long documents

Recommended MVP chunking strategy:

- first split by `page`
- then split by `paragraph`
- then merge or re-split to a target size of roughly `400 to 900 words`
- preserve `page number`, `section label`, and `chunk order`

Deliverable:

- chunk store with citations and retrieval-ready structure

### Day 8: Grounded card generation hardening

- Make the model output predictable and safe to use

Subtasks:

- enforce strict JSON output
- validate card schema before save
- reject uncited cards
- reject cards with empty body or bad kind
- attach chunk references to every card
- add fallback generation behavior if the model fails

Recommended fallback:

- if model call fails, mark document `generation_failed`
- surface retry option to user
- optionally use heuristic fallback only for internal testing, not silent production behavior

Deliverable:

- validated AI output saved into the database

### Day 9: Feed persistence and resume flow

- Make the study feed resumable
- Let users return to the same document later

Subtasks:

- load ready cards from the database
- persist user interactions per card
- reopen last active study session
- show processing and failed states cleanly

Deliverable:

- true comeback-later experience

### Day 10: Progress loop and learning actions

- Add the first real learning loop

Subtasks:

- persist `save`, `review again`, and `locked in`
- track completion percent by document
- track weak cards and saved cards
- show a session summary
- define resurfacing rules for weak cards

Recommended resurfacing logic:

- `review again` cards reappear first in the next session
- `saved` cards remain pinned to a review bucket
- `locked in` cards are shown less often

Deliverable:

- measurable progress loop

### Day 11: OCR fallback and failure handling

- Handle the non-text PDF edge case
- Make failures explicit instead of mysterious

Subtasks:

- add OCR fallback path for scanned PDFs
- add timeout handling
- add user-facing failure messages
- log parse failures and model failures

Recommendation:

- do not start with OCR as the default parser
- use OCR only when normal extraction returns near-empty text

Deliverable:

- resilient ingestion pipeline

### Day 12: Security and privacy hardening

- Tighten the MVP before public usage

Subtasks:

- confirm S3 buckets are private
- confirm secrets remain server-side only
- validate auth on all document endpoints
- add rate limits on upload and generation
- add ownership checks on every document fetch

Deliverable:

- private-by-default document flow

### Day 13: Observability and cost tracking

- Track whether the app is healthy and affordable

Subtasks:

- log uploads, parse jobs, generation jobs, failures, retries
- track time to first feed
- track model cost per document
- add basic dashboard or admin query path

Minimum metrics:

- uploads started
- uploads failed
- parse success rate
- generation success rate
- average processing time
- average cost per document

Deliverable:

- basic operational visibility

### Day 14: Full MVP testing

- Test the complete user journey

Subtasks:

- happy-path test for upload to feed
- bad PDF test
- empty file test
- timeout test
- auth boundary test
- resume session test
- rate limit test
- manual visual QA for mobile and desktop

Deliverable:

- full MVP test pass list and fixed blockers

### Day 15: AWS deployment and release checklist

- Deploy the usable MVP
- freeze the first release scope

Subtasks:

- deploy app to AWS
- configure production env vars
- verify Cognito callback URLs
- verify S3 permissions
- verify queue and worker wiring
- run smoke test in production
- create release checklist and rollback notes

Deliverable:

- publicly usable MVP environment

## What I Need From You

To execute this plan without blockers, get me these:

1. AWS region choice
2. AWS deployment choice: `Amplify Hosting` or `App Runner`
3. AWS database choice approval: `Postgres`
4. Cognito details or permission to create them
5. S3 bucket names or permission to create them
6. Queue choice approval: `SQS`
7. OCR choice: `AWS Textract`, `Tesseract`, or another provider
8. model provider and API key
9. budget guardrails per day or per month
10. whether you want task tracking as:
   - markdown in repo only
   - GitHub issues
   - both

## Definition Of Done

This project counts as MVP only when all of these are true:

- user can authenticate
- upload stays private
- documents are stored and processed reliably
- generation is grounded and validated
- users can come back later
- progress and weak-card review work
- failures are visible and recoverable
- app runs on AWS outside local dev
