# Cognito Auth Shell Scaffold

## Purpose

Day 02.1 does not implement full sign-in yet. It defines the integration boundary so the Day 02.2 flow can add Cognito login, logout, and protected routes without reshaping the app shell again.

## Integration Surface

The scaffold splits auth into three layers:

1. `src/lib/auth/config.js`
   - reads Cognito and auth route settings from the server environment
   - reports whether the Hosted UI is fully configured
   - exposes a client-safe subset for React usage
2. `src/lib/auth/session.server.js`
   - reads the product-shell session cookie on the server
   - returns anonymous mode when the cookie is absent or invalid
   - gives the layout a single bootstrap object for auth + session state
3. `src/components/auth-shell-provider.js`
   - hydrates the initial auth/session state into the React tree
   - gives client components a single `useAuthShell()` hook

## Current Assumptions

- Cognito sign-in will use the Hosted UI and return to `AUTH_CALLBACK_PATH`.
- The callback route will exchange Cognito output for a server-issued session cookie instead of exposing raw Cognito tokens to browser storage.
- `AUTH_PROTECTED_HOME_PATH` is the intended signed-in route for the product shell once Day 02.2 adds protected navigation.
- Anonymous users stay in preview mode until a valid session cookie exists.

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

## Follow-On Work

Day 02.2 should build on this scaffold by:

- creating `AUTH_CALLBACK_PATH` and `AUTH_SIGN_OUT_PATH`
- redirecting users into the Cognito Hosted UI
- minting and clearing the server-issued session cookie
- enforcing `AUTH_PROTECTED_HOME_PATH` for signed-in users only
