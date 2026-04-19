# Setup And Release

## Local Bootstrap

This repository is still in the single-user local MVP phase. A contributor only needs the local web app and validation flow to work.

### Prerequisites

- Node.js `20+`
- `pnpm`
- local `.env.local` copied from `.env.example`

### Bootstrap Steps

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Copy the contract file and fill only the values needed for the features you are using:
   ```bash
   cp .env.example .env.local
   ```
3. Run the Day 1 validation sequence:
   ```bash
   bash scripts/check.sh
   ```
4. Start the app:
   ```bash
   pnpm dev
   ```

### Optional Local Validation Fixtures

The scheduled automation currently validates the study flow against three local PDFs when they exist:

- `AIAYN.pdf`
- `SAM.pdf`
- `OPUS.pdf`

These files stay outside the repository and are only used for local regression checks.

## AWS Inventory Assumptions

These resources are not fully implemented yet, but the MVP plan assumes this shape:

- `Amazon Cognito` for auth
- `Amazon S3` for private document storage
- `Postgres on AWS` for persistence
- `Amazon SQS` for background generation jobs
- `AWS Lambda` or a small worker service for parsing and generation orchestration
- `AWS Amplify Hosting` or `AWS App Runner` for deployment
- `CloudWatch` for logs and operational visibility

Day 1 documents the inventory so later implementation can plug into a known target instead of redefining infrastructure mid-stream.

## Release Workflow

1. Confirm the earliest incomplete day from GitHub milestones and issues.
2. Create a review branch using `day-<number>/<slug>`.
3. Implement only the active child issue or tightly related Day 1 scope.
4. Run:
   ```bash
   bash scripts/check.sh
   ```
5. Push the branch and open it for review.
6. Merge to `main` only after review and green CI.
7. Close the child issue, then the parent day issue, then the day milestone once the definition of done is satisfied.

## CI Expectations

- CI runs the same environment validation, lint, build, and test contract as local development.
- A broken validation step blocks merge.
- If CI fails, fix the branch first. Do not merge with known red checks.
