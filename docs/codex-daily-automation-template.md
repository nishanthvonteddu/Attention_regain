# Codex Daily Automation Template

## Purpose

This is the exact daily automation template for Attention Regain.

## Schedule

- Frequency: `daily`
- Time: `9:00 AM`
- Time zone: `America/New_York`
- Workspace: `/Users/work/Desktop/learning/Attention_regain`

## Automation Prompt

```text
Work only on /Users/work/Desktop/learning/Attention_regain.

Start every run by reading:
- /Users/work/Desktop/learning/Attention_regain/memory.md
- /Users/work/Desktop/learning/Attention_regain/docs/daily-automation-runbook.md

Then run:
- /Users/work/Desktop/learning/Attention_regain/scripts/mvp-preflight.sh

Use the GitHub day milestones and issues in nishanthvonteddu/Attention_regain as the source of truth.

Work order:
- always select the lowest-numbered open day first
- then select the lowest-numbered open child issue under that day
- do not skip to a later day unless the lower day is genuinely blocked

Execution rules:
- use the stored GitHub token when needed for tracker operations
- work on a review branch named codex/day-XX-<slug>
- implement the selected issue end to end
- use relevant Codex skills when appropriate:
  - frontend-skill
  - playwright
  - playwright-interactive
  - screenshot
  - pdf
  - doc
  - security-best-practices
  - security-threat-model
- validate the work with the strongest applicable checks
- update memory.md with a timestamped summary
- commit coherent progress
- push the branch

Issue closing rules:
- close GitHub child issues only after the acceptance criteria are met and validation passes
- close parent day issues only when all child issues are closed and the day definition of done is satisfied
- close day milestones only when the parent day issue is closed

Safety rules:
- never commit secrets
- do not bypass the runbook
- if blocked, record the blocker in memory.md and stop

End every run with a concise summary of:
- issue worked
- branch pushed
- validation run
- issue state changes
- blockers
- next expected issue
```

## Recommended Codex Automation Settings

- Name: `Attention Regain Daily Ship`
- Kind: `cron`
- Model: `gpt-5.4`
- Reasoning effort: `high`
- Execution environment: `local`

## Supporting Files

- [`memory.md`](/Users/work/Desktop/learning/Attention_regain/memory.md)
- [`docs/daily-automation-runbook.md`](/Users/work/Desktop/learning/Attention_regain/docs/daily-automation-runbook.md)
- [`scripts/mvp-preflight.sh`](/Users/work/Desktop/learning/Attention_regain/scripts/mvp-preflight.sh)
