# Resume Flow

Day 09 makes the study workspace resumable from backend state instead of
restoring generated feeds from browser storage.

## Server Contract

`GET /api/study-feed` returns one owner-scoped workspace:

- `document`: the last active document for the authenticated user.
- `job`: the latest processing job for that document, when one exists.
- `deck`: the ready session, persisted cards, citations, and derived feedback.
- `resume`: explicit entry metadata for the app shell.

Last-active selection uses document activity, session activity, and interaction
activity. A user who returns to an older ready feed and saves, reveals, or marks a
card moves that session back to the front for the next visit.

## Session State

Generated cards are persisted in `study_cards`. Study actions are append-only
`study_interactions` rows and are folded into `deck.feedback` during load:

- `save_card` and `unsave_card` restore saved state.
- `set_confidence` restores the latest confidence choice.
- `reveal_answer` restores answer visibility for the current session.

The browser may keep draft source text locally, but it does not store the active
deck, document, or feedback as the source of truth.

## Document Views

The workspace renders distinct states from the same server response:

- `ready`: persisted cards, source citations, and feedback are available.
- `processing`: the document or job is queued, processing, parsed, or chunked.
- `failed`: parsing or generation stopped and retry guidance is shown.
- `empty`: no server-backed document exists yet.

Retry actions use the stored job payload, so failed documents can be requeued
without losing the original document linkage.
