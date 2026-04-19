# Daily MVP Automation Runbook

## Purpose

This runbook defines how the daily Codex automation should execute the Attention Regain MVP build from the current repo state through the open GitHub day milestones.

## Source Of Truth

Use these in order:

1. GitHub open day milestones `#2` through `#16`
2. GitHub open day parent issues `#1` through `#15`
3. GitHub open child issues under each day parent
4. [`memory.md`](/Users/work/Desktop/learning/Attention_regain/memory.md)
5. [`docs/mvp-15-day-plan.md`](/Users/work/Desktop/learning/Attention_regain/docs/mvp-15-day-plan.md)

If the repo plan and GitHub issue disagree, prefer GitHub issues and then update `memory.md`.

## Work Order

- Always start with the lowest-numbered open day parent issue
- Under that day, take the lowest-numbered open child issue first
- Do not start a higher day while a lower day is still actionable
- Only move to a higher day if the current lower day is genuinely blocked
- Record any blocker in `memory.md` before stopping

## Preflight Checks

Run these before code changes:

1. Confirm the repo is reachable and the current worktree is understood
2. Confirm local env exists if AI work is involved
3. Run [`scripts/mvp-preflight.sh`](/Users/work/Desktop/learning/Attention_regain/scripts/mvp-preflight.sh)
4. Read `memory.md` and the target GitHub issue before editing
5. Verify the branch naming plan for the selected issue

If preflight fails:

- stop implementation
- record the failure in `memory.md`
- report the exact failed check in the run summary

## Dependency Rules

- Treat lower-numbered days as dependencies of higher-numbered days
- Respect explicit dependencies written in each parent or child issue
- Do not remove or bypass earlier work to make later work easier
- If a later issue can be partially prepared without violating dependency order, keep that work in docs only unless the lower day is blocked

## Per-Issue Workflow

For every run:

1. Select the lowest actionable open child issue
2. Create or switch to a review branch named `codex/day-XX-<slug>`
3. Implement the issue with minimal blast radius
4. Run validation relevant to the issue
5. Update `memory.md`
6. Commit coherent progress
7. Push the branch
8. If the issue acceptance criteria are met, close the child issue
9. If all child issues for the day are closed and the day definition of done is satisfied, close the parent day issue
10. If the parent day issue is closed, close the matching day milestone

## Frontend Rules

- Preserve a clean, professional, mobile-first interface
- Keep the feed interaction polished and intentional
- Avoid generic default UI patterns
- Prioritize real state handling over static demos
- Validate both mobile and desktop behavior before closing UI-heavy work

## AI Pipeline Rules

Normal text-document path:

1. parse text
2. chunk source
3. embed chunks
4. retrieve candidates
5. rerank candidates
6. generate cards from the best grounded chunks
7. validate card schema and citations
8. persist or render safely

Scanned or image-heavy path:

1. detect low-signal or image-first pages
2. use the vision model only for fallback extraction or understanding
3. normalize the recovered text
4. re-enter the standard chunk, retrieve, rerank, and generate pipeline

## Card Generation Rules

- Every card must be source-grounded
- Every card must carry a citation or source reference
- Preferred card types:
  - quick summary
  - recall prompt
  - application question
  - pitfall or trap
- Card copy should be concise and scroll-native
- Do not invent facts
- Reject malformed or uncited cards

## Validation Rules

Use the strongest applicable validation for the issue:

- `pnpm build`
- UI verification with Playwright when behavior changes materially
- visual checks when the interface changes materially
- targeted local route or API probes for AI and parsing work

If a check cannot run, record why in `memory.md` and in the run summary.

## Skills And Tooling Rules

Use the repo with the strongest relevant Codex capabilities available during a run:

- [$frontend-skill](/Users/work/.codex/skills/frontend-skill/SKILL.md)
- [$playwright](/Users/work/.codex/skills/playwright/SKILL.md)
- [$playwright-interactive](/Users/work/.codex/skills/playwright-interactive/SKILL.md)
- [$screenshot](/Users/work/.codex/skills/screenshot/SKILL.md)
- [$pdf](/Users/work/.codex/skills/pdf/SKILL.md)
- [$doc](/Users/work/.codex/skills/doc/SKILL.md)
- [$security-best-practices](/Users/work/.codex/skills/security-best-practices/SKILL.md)
- [$security-threat-model](/Users/work/.codex/skills/security-threat-model/SKILL.md)

Use only the skills relevant to the current issue. Do not add noise.

## Closing Rules

Close a child issue only if:

- implementation for that issue is complete
- relevant validation passed
- the branch is pushed
- `memory.md` is updated

Close a parent day issue only if:

- all child issues are closed
- the day definition of done is satisfied
- no unresolved blocker remains for that day

Close a day milestone only if:

- the parent day issue is closed

## End-Of-Run Summary

Every run should end with a short summary that includes:

- issue worked on
- branch name
- changes made
- validation run
- issue or milestone state changes
- blockers, if any
- next expected issue
