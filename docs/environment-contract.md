# Environment Contract

## Purpose

Day 1 locks the configuration boundary before the AWS and backend layers exist. The current app is still a local single-user MVP, so not every variable below is active yet. The contract makes the future boundary explicit now so later work can extend the product without rewriting configuration assumptions.

## Public Client Configuration

These variables are safe to expose in the browser because they do not contain credentials.

| Variable | Required Now | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | No | UI display name. Defaults to `Attention Regain`. |
| `NEXT_PUBLIC_DEFAULT_GOAL` | No | Default study goal copy shown in the app. |
| `NEXT_PUBLIC_ENABLE_UPLOADS` | No | UI feature flag for source uploads. Defaults to `true`. |

## Server-Only Runtime Configuration

These variables must stay server-side. They are consumed by API routes, background jobs, or future backend services.

| Variable | Required Now | Required When | Notes |
| --- | --- | --- | --- |
| `ATTENTION_REGAIN_ENV` | No | Never | Environment label such as `local`, `ci`, `staging`, or `production`. |
| `ENABLE_LIVE_GENERATION` | No | Never | Explicitly turns on model-backed card generation. If omitted, the app enables live generation automatically only when a text generation key is present. |
| `NVIDIA_TEXT_API_KEY` | No | `ENABLE_LIVE_GENERATION=true` | Preferred server-only key for text generation. |
| `NVIDIA_TEXT_MODEL` | No | `ENABLE_LIVE_GENERATION=true` | Preferred text generation model id. |
| `NVIDIA_API_KEY` | No | Legacy compatibility only | Backward-compatible fallback key for older local setups. |
| `NVIDIA_MODEL` | No | Legacy compatibility only | Backward-compatible fallback model id. |
| `ENABLE_RETRIEVAL_PIPELINE` | No | Never | Turns on embedding and rerank validation once retrieval is wired in. |
| `NVIDIA_EMBEDDING_API_KEY` | No | `ENABLE_RETRIEVAL_PIPELINE=true` | Embedding key for document chunk vectors. |
| `NVIDIA_EMBEDDING_MODEL` | No | `ENABLE_RETRIEVAL_PIPELINE=true` | Embedding model id. |
| `NVIDIA_RERANK_API_KEY` | No | `ENABLE_RETRIEVAL_PIPELINE=true` | Reranker key. |
| `NVIDIA_RERANK_MODEL` | No | `ENABLE_RETRIEVAL_PIPELINE=true` | Reranker model id. |
| `ENABLE_VISION_FALLBACK` | No | Never | Enables image and scanned-PDF fallback validation. |
| `NVIDIA_VISION_API_KEY` | No | `ENABLE_VISION_FALLBACK=true` | Vision model key. |
| `NVIDIA_VISION_MODEL` | No | `ENABLE_VISION_FALLBACK=true` | Vision model id. |
| `ENABLE_AWS_SERVICES` | No | Never | Enables validation of the planned AWS inventory once those layers are introduced. |
| `AWS_REGION` | No | `ENABLE_AWS_SERVICES=true` | Shared AWS region. |
| `AWS_S3_BUCKET_DOCUMENTS` | No | `ENABLE_AWS_SERVICES=true` | Private document bucket. |
| `AWS_COGNITO_USER_POOL_ID` | No | `ENABLE_AWS_SERVICES=true` | Cognito user pool for sign-in. |
| `AWS_COGNITO_CLIENT_ID` | No | `ENABLE_AWS_SERVICES=true` | Cognito app client id. |
| `AWS_COGNITO_DOMAIN` | No | `ENABLE_AWS_SERVICES=true` | Cognito Hosted UI domain used for sign-in and sign-out redirects. |
| `AUTH_CALLBACK_PATH` | No | Never | App route that will exchange the Cognito callback for a server-issued session cookie. Defaults to `/auth/callback`. |
| `AUTH_SIGN_OUT_PATH` | No | Never | App route reserved for clearing the session and initiating Cognito logout. Defaults to `/auth/sign-out`. |
| `AUTH_PROTECTED_HOME_PATH` | No | Never | Intended signed-in landing route for the product shell. Defaults to `/app`. |
| `AUTH_PUBLIC_HOME_PATH` | No | Never | Anonymous landing route after sign-out. Defaults to `/`. |
| `AUTH_SESSION_COOKIE_NAME` | No | Never | Server-issued session cookie name used by the product shell boundary. Defaults to `attention_regain_session`. |
| `QUEUE_URL_DOCUMENT_PROCESSING` | No | `ENABLE_AWS_SERVICES=true` | Queue url for background document processing. |
| `ENABLE_DATABASE` | No | Never | Enables database validation before persistence work begins. |
| `DATABASE_URL` | No | `ENABLE_DATABASE=true` | Server-only database connection string. |

## Separation Rules

- Never prefix secrets with `NEXT_PUBLIC_`.
- Keep `.env.local` local only. The repository tracks `.env.example` and ignores real `.env*` files.
- Public configuration is limited to presentation or non-sensitive feature flags.
- Model keys, AWS identifiers, and database credentials remain server-only.
- The browser receives only the client-safe auth subset from `toClientAuthConfig()`.
- The protected study route (`/app`) and `POST /api/study-feed` now require a valid server-issued product session cookie.
- The auth shell passes only a client-safe Cognito subset into React: region, app client id, Hosted UI domain, and route paths.
- The product shell never stores Cognito tokens in `localStorage`; Day 02 uses a server-issued session cookie boundary instead.

## Validation Strategy

The Day 1 validation contract has two layers:

1. `node scripts/validate-env.mjs --mode=local`
   - checks the documented contract
   - rejects impossible flag combinations
   - catches missing required values when a feature is explicitly enabled
2. runtime fallback in `src/app/api/study-feed/route.js`
   - if live generation is disabled or unconfigured, the route uses heuristic card generation
   - if live generation is explicitly enabled but misconfigured, the route still falls back and returns a warning instead of silently pretending the model ran

## Failure Paths

- Missing text generation key with live generation disabled:
  - expected result: local heuristic fallback
- Missing text generation key with `ENABLE_LIVE_GENERATION=true`:
  - expected result: validation failure in `scripts/validate-env.mjs`
  - runtime behavior: heuristic fallback with a warning
- Missing AWS or database settings while those feature flags stay disabled:
  - expected result: no failure during the local MVP phase
- Missing AWS or database settings after those feature flags are enabled:
  - expected result: validation failure before merge or deployment
- Partial Cognito scaffold values while `ENABLE_AWS_SERVICES=false`:
  - expected result: local preview mode with an explicit warning instead of a silent half-configured auth shell
