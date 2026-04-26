# Grounded Generation Contract

Day 08 hardens card generation before deeper persistence and resume work. The
pipeline now treats generated cards as untrusted model output until they pass a
single contract in `src/lib/study/card-contract.js`.

## Contract Shape

Generated batches must be JSON objects with:

- `contractVersion`: `day08.generated-card.v1`
- `focusTags`: up to four short strings
- `cards`: one or more generated cards

Each card must include:

- `kind`: `glance`, `recall`, `application`, or `pitfall`
- `title`: required, capped at 70 characters
- `body`: required, capped at 240 characters
- `excerpt`: required, capped at 170 characters, grounded in the cited passage
- `citation`: required and exactly equal to one retrieved passage citation
- `sourceReference`: canonical source metadata derived from the cited chunk

Recall, application, and pitfall cards must also include both `question` and
`answer`. Glance cards may omit them.

## Validation And Repair

The model response is parsed as JSON and may be repaired only when the repair is
deterministic and source-safe:

- fenced or wrapped JSON can be extracted
- an unsupported card kind can be downgraded to `glance`
- overlong text can be trimmed
- a missing excerpt can be filled from the cited passage

Cards are rejected when they are uncited, cite a passage that was not retrieved,
lack required text, or include an excerpt that is not grounded in the cited
passage. Rejected cards are not persisted. If no valid cards remain, model
generation is considered failed.

## Persistence Rules

`saveGeneratedDeck` revalidates the deck with repair disabled before writing
cards. Persisted cards always carry a `chunkId` and `sourceReference`, so later
resume, progress, and review flows can trace a card back to the exact source
chunk. This second validation step prevents callers from bypassing the pipeline
contract.

## Failure And Retry Behavior

If live generation fails because of API errors or contract rejection, the worker
uses the deterministic fallback generator and records `generationFailure` in the
session stats. If fallback validation or persistence fails, the document job
uses the existing bounded retry and dead-letter path; failed documents remain
visible in the workspace and can be retried from the stored job payload.
