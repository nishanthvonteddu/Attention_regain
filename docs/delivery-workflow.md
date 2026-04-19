# Delivery Workflow

## Purpose

This repository ships the 15-day Attention Regain MVP in small reviewable increments. The workflow below keeps daily milestone work, review, and validation consistent.

## Branching Rules

- Do not work directly on `main`.
- Start each scheduled day task from the latest `main`.
- Use the review branch format `day-<number>/<slug>`.
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

- `bash scripts/lint.sh` runs repository hygiene checks from `scripts/lint.mjs`.
- `bash scripts/build.sh` runs the production Next.js build through `pnpm build`.
- `bash scripts/test.sh` runs the repository contract and fixture tests in `tests/`.
- `bash scripts/check.sh` runs environment validation, lint, build, and tests in order.

## Commit And Review Expectations

- Keep commits scoped and coherent.
- Use commit messages in the format `<type>(day-XX): add|update|remove <path>`.
- Prefer per-file commits when a change touches multiple concerns.
- Merge only after the review branch passes the required local checks.
- Close the child issue only after the acceptance criteria are met and validation passes.

## CI And Broken Checks

- The GitHub Actions workflow in `.github/workflows/ci.yml` runs the same validation contract used locally.
- A review branch is not ready for merge until CI is green.
- If any check fails, fix the underlying issue on the same review branch, rerun the local scripts, and push the repair before requesting merge again.
