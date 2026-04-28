# Learning Loop

Day 10 turns raw study interactions into a durable learning loop.

## Action Model

- `save_card` and `unsave_card` are bookmark actions. Saved cards stay easy to find but are not treated as weak by themselves.
- `set_confidence=review` marks a weak card. Review-again cards resurface before neutral, saved, and locked cards.
- `set_confidence=locked` marks a learned card. Locked cards remain in the session but are deprioritized in the review queue.
- `reveal_answer` marks exposure to an answer without implying mastery.

The system stores the event stream in `study_interactions`. The current card state is derived by replaying interactions in `createdAt` order, so repeated interactions use latest-state semantics instead of creating conflicting card state.

## Progress Contract

`GET /api/study-feed` returns:

- `deck.feedback`: compatibility state for controls.
- `deck.progress`: document-level totals for touched, saved, review-again, locked, revealed, and completion percent.
- `deck.sessionSummary`: the same progress metrics plus the next queued card.
- `card.learningState`: derived state for the individual card.
- `card.resurfacing`: queue name, score, position, and reason.

Completion percent is `lockedCards / totalCards`. Touched percent is any card with a save, reveal, confidence, dismiss, or persisted status signal.

## Resurfacing Rules

Cards are ordered by derived resurfacing score, then latest interaction time, then original source sequence:

1. Review-again cards.
2. Saved cards.
3. Active or newly touched cards.
4. Seen cards.
5. Locked-in cards.
6. Dismissed cards.

Saved and weak cards are intentionally distinct: saved is a keep signal, while review-again is a weakness signal. A saved card marked review again follows the weak-card path. A saved card marked locked in remains saved but moves later in the queue.
