# Attention Regain

Attention Regain is a minimal POC for a study product that competes with doomscrolling.

The input is a paper, notes, or another reading source. The output is a mobile-first feed of short, grounded cards so a distracted user can keep scrolling without leaving the study context.

## What This POC Includes

- Next.js App Router frontend with a mobile-first study workspace
- Paste-text and PDF upload intake
- Server-side PDF text extraction with `pdf-parse`
- A source-grounded feed generator that turns passages into:
  - quick-read cards
  - recall prompts
  - application prompts
  - pitfall cards
- Local session persistence in the browser

This first version is intentionally self-contained. There is no auth, database, vector store, or model dependency yet.

## Local Run

Install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

Current POC shape:

- `src/app/page.tsx`
  - server entry that renders the app shell
- `src/components/attention-regain-app.tsx`
  - intake form, session state, local persistence, feed layout
- `src/components/feed-card.tsx`
  - card presentation and lightweight interactions
- `src/app/api/study-feed/route.ts`
  - accepts pasted text or uploaded files and returns a generated feed
- `src/lib/study-feed.ts`
  - source sanitizing, chunking, and card generation logic

Target production direction after validation:

- `Next.js` frontend
- `Postgres` for users, documents, cards, interactions
- `pgvector` for grounded retrieval
- object storage for uploaded PDFs
- model-backed card generation with citations
- background jobs for chunking, embeddings, and replenishing the feed

## Product Boundaries

This POC is intentionally narrow:

- one document at a time
- one user at a time
- grounded cards only
- no social feed
- no recommendation engine
- no cross-document retrieval

That keeps the validation question clean: does this format make studying easier to reopen when attention slips?

## Next Steps

- replace the heuristic generator in `src/lib/study-feed.ts` with a model-backed pipeline
- persist documents and interactions in a database
- add document progress, streaks, and weak-area resurfacing
- chunk long sources with retrieval instead of generating a fixed initial deck
- add OCR fallback for scanned PDFs

## Verification

```bash
pnpm lint
pnpm build
```
