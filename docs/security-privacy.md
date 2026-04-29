# Security And Privacy Launch Notes

Day 12 hardens the MVP around document ownership, private upload storage, web
headers, rate limits, and launch review expectations.

## Document Ownership

Cross-user document access is blocked at the API and repository boundaries:

- Product API routes require an authenticated server session before reading or
  writing study data.
- State-changing API routes require same-origin requests before accepting
  cookie-authenticated writes.
- Document upload lookup and confirmation require both the authenticated user id
  and the target document id.
- Study-feed retry, processing, workspace, and interaction paths use
  user-scoped repository methods.
- Private uploads must reach `uploaded` status before study-feed processing can
  enqueue work against the document.

## Private Upload Storage

S3 objects are private by default. Browser clients only receive short-lived
presigned `PUT` URLs when AWS services are enabled. Signing credentials,
generation API keys, database URLs, and queue URLs stay server-side and must
never use a `NEXT_PUBLIC_` prefix.

Private object keys are scoped under:

```text
private/users/<sha256-user-segment>/documents/<document-id>/source/<file-name>
```

The key keeps the raw user id out of storage paths while preserving an
owner-bound document bridge in the database. Presigned uploads require
`x-amz-server-side-encryption: AES256`.

## Security Headers

The app-level Next.js header policy sets:

- Content Security Policy with `default-src 'self'`, `object-src 'none'`, and
  `frame-ancestors 'none'`.
- `X-Frame-Options: DENY`.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- A restrictive `Permissions-Policy` for camera, microphone, and geolocation.

The current CSP keeps `unsafe-inline` and `unsafe-eval` for Next.js runtime
compatibility. Tightening those directives should be part of a production edge
review once deployment hosting is fixed.

## Rate Limits

The MVP uses in-process rate limits as a baseline local and single-instance
guardrail:

- `auth`: local sign-in attempts.
- `upload`: private upload preparation and confirmation.
- `generation`: study-feed creation, retry, and processing requests.
- `interaction`: study-card learning actions.

Production should back these policies with an edge, gateway, or distributed
store so limits work across instances. Abuse responses are bounded with HTTP
`429`, `Retry-After`, and `X-RateLimit-*` headers.

## Launch Checklist

- Verify no secrets are committed or exposed through `NEXT_PUBLIC_*` variables.
- Confirm AWS credentials are scoped to the minimum S3, queue, and Cognito
  operations required by the deployment.
- Confirm S3 bucket public access blocks are enabled and object ACLs are not
  used for public reads.
- Confirm production uses `next build` and `next start` or an equivalent managed
  production runtime.
- Confirm security headers are visible in runtime responses.
- Confirm cross-user document access, upload confirmation, retry, and
  interaction attempts fail in tests.
- Confirm rate limits are enforced at the edge or shared infrastructure layer
  before public launch.
