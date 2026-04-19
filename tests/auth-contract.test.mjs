import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCognitoHostedUiUrl,
  buildCognitoLogoutUrl,
  getCognitoAuthReport,
  toClientAuthConfig,
} from "../src/lib/auth/config.js";
import {
  createAuthenticatedProductSession,
  readSerializedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";

test("cognito scaffold reports missing config only when AWS auth is expected", () => {
  const report = getCognitoAuthReport({
    ENABLE_AWS_SERVICES: "true",
    AWS_REGION: "us-east-1",
    AWS_COGNITO_USER_POOL_ID: "pool-id",
    AWS_COGNITO_CLIENT_ID: "client-id",
  });

  assert.equal(report.configured, false);
  assert.match(report.issues.join("\n"), /AWS_COGNITO_DOMAIN/);
});

test("client auth config exposes only the safe Cognito subset", () => {
  const report = getCognitoAuthReport({
    AWS_REGION: "us-east-1",
    AWS_COGNITO_USER_POOL_ID: "pool-id",
    AWS_COGNITO_CLIENT_ID: "client-id",
    AWS_COGNITO_DOMAIN: "attention-regain.auth.us-east-1.amazoncognito.com",
  });
  const clientConfig = toClientAuthConfig(report);

  assert.equal(clientConfig.configured, true);
  assert.equal(clientConfig.client.clientId, "client-id");
  assert.equal(clientConfig.client.region, "us-east-1");
  assert.equal(clientConfig.client.hostedUiDomain.includes("amazoncognito.com"), true);
  assert.equal("server" in clientConfig, false);
});

test("hosted UI url builder uses the configured callback path", () => {
  const auth = toClientAuthConfig(
    getCognitoAuthReport({
      AWS_REGION: "us-east-1",
      AWS_COGNITO_USER_POOL_ID: "pool-id",
      AWS_COGNITO_CLIENT_ID: "client-id",
      AWS_COGNITO_DOMAIN: "attention-regain.auth.us-east-1.amazoncognito.com",
    }),
  );

  const url = buildCognitoHostedUiUrl({
    auth,
    origin: "http://localhost:3000",
    state: "/app",
  });

  assert.ok(url);
  assert.match(url, /oauth2\/authorize/);
  assert.match(url, /redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback/);
  assert.match(url, /state=%2Fapp/);
});

test("hosted UI builder preserves the protected post-login path in state", () => {
  const auth = toClientAuthConfig(
    getCognitoAuthReport({
      AWS_REGION: "us-east-1",
      AWS_COGNITO_USER_POOL_ID: "pool-id",
      AWS_COGNITO_CLIENT_ID: "client-id",
      AWS_COGNITO_DOMAIN: "attention-regain.auth.us-east-1.amazoncognito.com",
    }),
  );

  const url = buildCognitoHostedUiUrl({
    auth,
    origin: "http://localhost:3000",
    state: "/app",
  });

  assert.ok(url);
  assert.match(url, /state=%2Fapp/);
});

test("logout url builder returns the public-home redirect target", () => {
  const auth = toClientAuthConfig(
    getCognitoAuthReport({
      AWS_REGION: "us-east-1",
      AWS_COGNITO_USER_POOL_ID: "pool-id",
      AWS_COGNITO_CLIENT_ID: "client-id",
      AWS_COGNITO_DOMAIN: "attention-regain.auth.us-east-1.amazoncognito.com",
    }),
  );

  const url = buildCognitoLogoutUrl({
    auth,
    origin: "http://localhost:3000",
  });

  assert.ok(url);
  assert.match(url, /logout_uri=http%3A%2F%2Flocalhost%3A3000%2F/);
});

test("serialized product sessions round-trip through the shell cookie boundary", () => {
  const session = createAuthenticatedProductSession({
    userId: "user-123",
    email: "reader@example.com",
    displayName: "Focused Reader",
    expiresAt: "2026-04-20T12:00:00.000Z",
  });
  const serialized = serializeProductSession(session);
  const restored = readSerializedProductSession(serialized);

  assert.equal(restored.status, "authenticated");
  assert.equal(restored.user.id, "user-123");
  assert.equal(restored.user.email, "reader@example.com");
  assert.equal(restored.expiresAt, "2026-04-20T12:00:00.000Z");
});
