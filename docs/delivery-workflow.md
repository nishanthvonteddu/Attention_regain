# Delivery Workflow

## Purpose

This repository ships the 15-day Attention Regain MVP in small reviewable increments. The workflow below keeps daily milestone work, review, and validation consistent.

## Branching Rules

- Do not work directly on `main`.
- Start each scheduled day task from the latest `main`.
- Use the review branch format `codex/day-XX-<slug>`.
- Finish the lowest-numbered open day before touching later milestones.
- Within the active day, take the lowest-numbered open child issue first unless GitHub marks it blocked.

## Delivery Loop

1. Confirm the active day milestone and child issue from GitHub.
2. Create a review branch for that issue.
3. Implement the issue end to end before moving to another child issue.
4. Run the local validation commands.
5. Push the branch and request review before merge.

## Local Validation Commands

Use the repository scripts as the canonical local entrypoints:

- `zsh scripts/lint.sh` runs repository hygiene checks from `scripts/lint.mjs`.
- `zsh scripts/build.sh` runs the production Next.js build through `pnpm build`.
- `zsh scripts/test.sh` runs the repository contract smoke tests in `tests/`.
- `zsh scripts/check.sh` runs the full local delivery sequence in order.

## Commit And Review Expectations

- Keep commits scoped and coherent.
- Use commit messages in the format `<type>(day-XX): add|update|remove <path>`.
- Prefer per-file commits when a change touches multiple concerns.
- Merge only after the review branch passes the required local checks.
- Close the child issue only after the acceptance criteria are met and validation passes.
