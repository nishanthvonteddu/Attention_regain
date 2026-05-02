# Production Readiness

Day 15 moves the MVP from a local release candidate to a hosted AWS release
candidate. The production environment is not considered complete until the app,
worker, auth, storage, queue, database, and smoke checks below all pass against
the same deployed version.

## AWS Service Inventory

| Capability | Production service | Required setting | Readiness check |
| --- | --- | --- | --- |
| Web app runtime | AWS App Runner or Amplify Hosting | `PRODUCTION_DEPLOYMENT_TARGET` | Hosted app URL returns a production page without `next dev`. |
| Auth | Amazon Cognito Hosted UI | `AWS_REGION`, `AWS_COGNITO_USER_POOL_ID`, `AWS_COGNITO_CLIENT_ID`, `AWS_COGNITO_DOMAIN` | `/auth/sign-in/start` redirects to the configured Hosted UI domain. |
| Private source storage | Amazon S3 | `AWS_S3_BUCKET_DOCUMENTS` | Bucket blocks public access and accepts only presigned encrypted uploads. |
| Background jobs | Amazon SQS | `QUEUE_URL_DOCUMENT_PROCESSING` | A hosted feed request creates a processing job and the worker consumes it. |
| Worker runtime | Lambda, App Runner worker, or equivalent | `PRODUCTION_WORKER_RUNTIME` | Worker logs show parse, chunk, retrieval, generation, and persistence events. |
| Persistence | Postgres on AWS | `DATABASE_URL` | App and worker can read/write the same document, card, interaction, and event rows. |
| Operations | CloudWatch | deployment platform settings | App and worker logs are visible for failed auth, upload, queue, and generation paths. |

All production resources must live in one AWS account and region for the first
release unless a later architecture decision records the cross-region reason.

## Secret Placement

- Store AWS credentials, database credentials, Cognito identifiers, NVIDIA keys,
  and queue URLs in the hosting platform secret store or runtime environment.
- Never add production values to `.env.example`, `.env.local`, GitHub issue
  comments, release notes, screenshots, or client-visible `NEXT_PUBLIC_*`
  variables.
- Prefer a scoped deployment role for the hosted runtime. If static AWS access
  keys are used for the MVP presigner, restrict them to the document bucket and
  rotate them after launch validation.
- Keep `DATABASE_URL` server-only. Production smoke output may say whether it is
  configured, but must not print the value.
- Use `ATTENTION_REGAIN_ENV=production`, `ENABLE_AWS_SERVICES=true`,
  `ENABLE_DATABASE=true`, and `ENABLE_RETRIEVAL_PIPELINE=true` for the hosted
  release candidate.

## Deployment Flow

1. Build the exact commit that will be released:
   ```bash
   bash scripts/check.sh
   ```
2. Provision or confirm the AWS inventory above.
3. Configure server-only production settings in the hosting platform:
   ```bash
   ATTENTION_REGAIN_ENV=production
   PRODUCTION_APP_URL=https://<hosted-app>
   PRODUCTION_DEPLOYMENT_TARGET=<app-runner|amplify|other>
   PRODUCTION_WORKER_RUNTIME=<lambda|app-runner-worker|other>
   ENABLE_AWS_SERVICES=true
   ENABLE_DATABASE=true
   ENABLE_RETRIEVAL_PIPELINE=true
   ```
4. Deploy the web app with `pnpm build` followed by the managed production
   runtime or `pnpm start`.
5. Deploy the worker from the same commit and point it at the same queue,
   database, model, and document-storage configuration.
6. Run the production readiness contract:
   ```bash
   node scripts/validate-production-readiness.mjs
   ```
7. Run hosted HTTP smoke checks after DNS and callbacks are live:
   ```bash
   node scripts/validate-production-readiness.mjs --http
   ```

## Connectivity Validation

Record these checks before declaring the day complete:

- Cognito callback and logout URLs exactly match:
  - `${PRODUCTION_APP_URL}/auth/callback`
  - `${PRODUCTION_APP_URL}/`
- S3 document bucket has public access blocks enabled and requires encrypted
  object uploads.
- The app can create an owner-bound upload row and return a presigned `PUT`
  response without exposing signing credentials.
- SQS receives a document-processing payload for the uploaded source.
- The hosted worker consumes the job and writes a ready or recoverable document
  state to the database.
- The operations report shows app, queue, worker, parse, generation, and
  feed-ready events for the same document id.

## Production Smoke Test

Use a new private account and a non-sensitive source document.

1. Open `PRODUCTION_APP_URL`.
2. Start Cognito sign-in and complete the Hosted UI callback.
3. Upload or paste source material.
4. Confirm the document reaches a processing state, then a ready feed.
5. Confirm generated cards have citations and source references.
6. Mark one card as review-again and one card as locked-in.
7. Reload `/app` and confirm the same session, feedback, and progress resume.
8. Open the Health report and confirm there are no unexpected failures.

The fixed local PDF fixtures remain useful for local regression checks, but they
are not production test data and should not be uploaded unless their contents are
approved for that AWS account.

## Release Freeze

Freeze the first releasable version only after:

- `bash scripts/check.sh` passes on the release commit.
- `node scripts/validate-production-readiness.mjs --http` passes against the
  hosted URL.
- The production smoke test above passes.
- The branch, commit SHA, deployment target, worker runtime, smoke-test time,
  and rollback target are recorded in the release note.

If any production check fails, keep the Day 15 milestone open. Fix the hosted
deployment or revert to the previous known-good commit before retrying the
freeze.
