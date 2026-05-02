# Release Validation

Day 14 treats the local MVP as a release candidate. The goal is not to prove AWS production readiness; that belongs to Day 15. The goal is to make the local product path, frontend behavior, and review-branch gate explicit enough that a human can decide whether the branch is ready to deploy.

## Release Checklist

Run these checks on a fresh review branch before requesting release review:

1. Confirm the active GitHub milestone and child issues are complete.
2. Run the merge-blocking local gate:
   ```bash
   bash scripts/check.sh
   ```
3. Confirm `pnpm build` passes. The build can report the current Turbopack NFT trace warning, but it must still complete successfully.
4. Run the fixture PDF validation when the files are available outside the repo:
   - `/Users/work/Downloads/AIAYN.pdf`
   - `/Users/work/Downloads/SAM.pdf`
   - `/Users/work/Downloads/OPUS.pdf`
5. Verify the app flow with an authenticated local preview session:
   - sign in through `/auth/sign-in`
   - upload or paste source material
   - generate a grounded feed
   - confirm cards include citations and source references
   - save/review/lock at least one card
   - reload `/app` and confirm the session resumes
6. Exercise known failure paths:
   - empty feed generation is rejected
   - unsupported upload types are rejected
   - OCR-needed or parse-failed states remain visible and recoverable when applicable
7. Review mobile and desktop layouts for overflowing labels, clipped controls, inaccessible status changes, and unusable tap targets.
8. Check the Health report for failures, time-to-first-feed, and estimated model spend.

## CI Release Gate

The required GitHub Actions job is `release-quality-gate`. It runs `bash scripts/check.sh`, which performs:

- environment contract validation
- repository lint and hygiene checks
- production build
- automated contract and fixture tests

This job is the merge-blocking release quality check for Day 14 branches. A branch with a failed `release-quality-gate` is not launch-ready, even if individual local commands pass on one machine.

## Validation Gaps

These gaps are explicit before launch:

- Local fixture PDFs are optional because the files are intentionally outside the repository.
- Browser automation validates the local preview path, but Day 14 does not prove hosted AWS callbacks, S3, SQS, or database connectivity.
- Live AI generation depends on external NVIDIA configuration; the release gate always validates the grounded heuristic fallback path.
- Scanned PDFs can reach `ocr_needed`; full vision recovery is intentionally deferred until the configured vision fallback exists.

## Rollback Procedure

If a release candidate fails validation after merge:

1. Stop deployment promotion and keep the failed commit out of production.
2. Revert the merge commit on `main` or deploy the previous known-good commit.
3. Re-run `bash scripts/check.sh` on the rollback commit.
4. If data migrations were included, inspect the corresponding `db/migrations/` file and decide whether the local JSON store or production database needs manual restoration from backup.
5. Record the failed check, rollback commit, and follow-up issue in GitHub before retrying release.

For Day 15 production rollback, prefer restoring the previous app and worker deployment together so API and background job contracts stay aligned. The hosted production readiness contract and smoke-test checklist live in [production-readiness.md](./production-readiness.md).
