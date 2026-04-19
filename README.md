# Attention Regain

Attention Regain is a minimal POC for a study product that competes with doomscrolling.

The input is a paper, notes, or another reading source. The output is a mobile-first feed of short, grounded cards so a distracted user can keep scrolling without leaving the study context.

## What This Build Includes

- Next.js App Router frontend in a single page file
- Paste-text and PDF upload intake
- Server-side PDF text extraction with `pdf-parse`
- Source-grounded feed generation for:
  - quick-read cards
  - recall prompts
  - application prompts
  - pitfall cards
- Browser-local session persistence

## Local Run

```bash
cp .env.example .env.local
pnpm install
bash scripts/check.sh
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Validation Scripts

Use the repository scripts below as the canonical local validation entrypoints:

```bash
bash scripts/lint.sh
bash scripts/build.sh
bash scripts/test.sh
bash scripts/check.sh
```

`scripts/check.sh` runs environment validation, repository hygiene checks, the production build, and the automated tests in the same order expected for a review branch.

## Delivery Workflow

Daily milestone work ships on review branches named `day-<number>/<slug>`, never directly on `main`. The full branch, review, and merge rules live in [docs/delivery-workflow.md](./docs/delivery-workflow.md).

## Environment Contract

The current local and planned MVP configuration contract lives in [docs/environment-contract.md](./docs/environment-contract.md). Copy [.env.example](./.env.example) to `.env.local` and add only the keys needed for the features you are actively using.

The current runtime behavior is explicit:

- if no live generation key is configured, the app uses the local heuristic fallback
- if live generation is enabled but misconfigured, the app falls back with a warning instead of failing silently
- future AWS and database settings stay disabled until those features are turned on

## Local Setup And Release

Contributor bootstrap steps, AWS inventory assumptions, and the review-branch release flow live in [docs/setup-and-release.md](./docs/setup-and-release.md).

## NVIDIA API Setup

To enable live AI card generation, create a local `.env.local` file with:

```bash
NVIDIA_API_KEY=your_key_here
# Optional:
NVIDIA_MODEL=openai/gpt-oss-20b
```

The app now uses NVIDIA's OpenAI-compatible chat completions endpoint and falls back to the local heuristic generator if the key is missing or the request fails.

## File Layout

- `package.json`
- `src/app/layout.js`
- `src/app/globals.css`
- `src/app/page.js`
- `src/app/api/study-feed/route.js`
- `README.md`

## Product Boundary

This version is intentionally narrow:

- one document at a time
- one user at a time
- grounded cards only
- no auth
- no database
- no cross-document retrieval

That keeps the validation question clear: if the user is about to open a distraction app, is this feed easy enough to open instead while still reinforcing the material?

## Execution Plan

The current MVP build-out plan lives in [docs/mvp-15-day-plan.md](./docs/mvp-15-day-plan.md).
