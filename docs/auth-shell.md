# Auth Shell And Protected Route Flow

## Purpose

Day 02 introduces a real protected application route while still keeping the MVP usable without cloud auth. The result is a two-lane auth shell:

- a public preview at `/`
- a protected study workspace at `/app`

## Current Route Map

- `/`
  - public preview route
  - explains the auth boundary and points users toward sign-in
- `/app`
  - protected study workspace
  - requires a valid server-issued session cookie
- `/auth/sign-in`
  - auth entry page
  - supports local preview sign-in now
  - exposes the Hosted UI start path for later Cognito completion
- `/auth/sign-in/start`
  - starts Hosted UI when Cognito is configured
  - redirects back with a clear error when it is not
- `/auth/local-sign-in`
  - mints a server-issued local preview session cookie
  - exists so the protected route is testable before full Cognito token exchange
- `/auth/callback`
  - handles Hosted UI return states
  - currently redirects back with explicit failure messages because token exchange is intentionally deferred
- `/auth/sign-out`
  - clears the product session cookie
  - redirects to Hosted UI logout when available, otherwise back to `/`

## Integration Surface

The auth shell now splits into five layers:

1. `src/lib/auth/config.js`
   - reads Cognito and auth route settings from the server environment
   - reports whether the Hosted UI is fully configured
   - exposes a client-safe subset for React usage
2. `src/lib/auth/session.server.js`
   - reads the product-shell session cookie on the server
   - builds and clears the cookie for route handlers
   - gives the layout a single bootstrap object for auth + session state
3. `src/lib/auth/flow.js`
   - normalizes post-login redirects
   - maps auth errors into explicit user-facing states
4. `src/components/auth-shell-provider.js`
   - hydrates the initial auth/session state into the React tree
   - gives client components a single `useAuthShell()` hook
5. `src/app/auth/*`
   - owns sign-in start, callback, local sign-in, and sign-out route behavior

## Current Assumptions

- Cognito sign-in will use the Hosted UI and return to `AUTH_CALLBACK_PATH`.
- The callback route will eventually exchange Cognito output for a server-issued session cookie instead of exposing raw Cognito tokens to browser storage.
- `AUTH_PROTECTED_HOME_PATH` is now a real protected route.
- Anonymous users stay in preview mode until a valid session cookie exists.
- The local preview sign-in exists only to keep the protected shell functional before AWS auth is finished.

## Safe Client Boundary

The browser receives only:

- AWS region
- Cognito app client id
- Hosted UI domain
- path-level auth routes

The browser does not receive:

- Cognito user pool id
- cookie names beyond the shell boundary
- secrets or raw environment dumps

## Failure States

- anonymous user requests `/app`
  - server redirect to `/auth/sign-in?error=auth_required`
- local sign-in submitted without name or email
  - redirect back to `/auth/sign-in?error=missing_identity`
- Hosted UI start requested before Cognito is configured
  - redirect back to `/auth/sign-in?error=cognito_not_configured`
- callback arrives without a `code`
  - redirect back to `/auth/sign-in?error=callback_missing_code`
- callback arrives with a `code`
  - redirect back to `/auth/sign-in?error=callback_exchange_not_implemented`

## Day 02 Outcome

- Sign-in and sign-out behavior is explicit.
- Protected route behavior exists now.
- Anonymous access behavior is defined.
- Public and server-only auth config stay separated by runtime.
