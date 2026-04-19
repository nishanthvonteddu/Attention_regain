import assert from "node:assert/strict";
import test from "node:test";

import { buildSignInPath, getAuthErrorMessage, normalizeRedirectPath } from "../src/lib/auth/flow.js";

function withTemporaryAuthEnv(overrides, run) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === null) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (typeof value === "string") {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      }
    });
}

test("redirect normalization rejects external redirects", () => {
  assert.equal(normalizeRedirectPath("/app", "/fallback"), "/app");
  assert.equal(normalizeRedirectPath("https://evil.example", "/fallback"), "/fallback");
  assert.equal(normalizeRedirectPath("//evil.example", "/fallback"), "/fallback");
});

test("sign-in paths preserve redirect and auth errors", () => {
  const path = buildSignInPath({
    redirectPath: "/app",
    error: "auth_required",
  });

  assert.equal(path, "/auth/sign-in?redirect=%2Fapp&error=auth_required");
  assert.match(getAuthErrorMessage("auth_required"), /Sign in before opening/i);
});

test("local preview sign-in route mints a session cookie and redirects", async () => {
  const { POST } = await import("../src/app/auth/local-sign-in/route.js");
  const formData = new FormData();
  formData.set("displayName", "Focused Reader");
  formData.set("email", "reader@example.com");
  formData.set("redirect", "/app");

  const response = await POST(
    new Request("http://localhost/auth/local-sign-in", {
      method: "POST",
      body: formData,
    }),
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/app");
  assert.match(response.headers.get("set-cookie") || "", /attention_regain_session=/);
});

test("sign-in start route reports missing Cognito config clearly", async () => {
  const { GET } = await import("../src/app/auth/sign-in/start/route.js");
  await withTemporaryAuthEnv(
    {
      ENABLE_AWS_SERVICES: "false",
      AWS_REGION: null,
      AWS_COGNITO_USER_POOL_ID: null,
      AWS_COGNITO_CLIENT_ID: null,
      AWS_COGNITO_DOMAIN: null,
    },
    async () => {
      const response = await GET(
        new Request("http://localhost/auth/sign-in/start?redirect=%2Fapp"),
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "http://localhost/auth/sign-in?redirect=%2Fapp&error=cognito_not_configured",
      );
    },
  );
});

test("callback route exposes failure states instead of silently accepting bad input", async () => {
  const { GET } = await import("../src/app/auth/callback/route.js");
  await withTemporaryAuthEnv(
    {
      ENABLE_AWS_SERVICES: "false",
      AWS_REGION: null,
      AWS_COGNITO_USER_POOL_ID: null,
      AWS_COGNITO_CLIENT_ID: null,
      AWS_COGNITO_DOMAIN: null,
    },
    async () => {
      const response = await GET(new Request("http://localhost/auth/callback?state=%2Fapp"));

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "http://localhost/auth/sign-in?redirect=%2Fapp&error=cognito_not_configured",
      );
    },
  );
});

test("sign-out route clears the server session cookie", async () => {
  const { POST } = await import("../src/app/auth/sign-out/route.js");
  await withTemporaryAuthEnv(
    {
      ENABLE_AWS_SERVICES: "false",
      AWS_REGION: null,
      AWS_COGNITO_USER_POOL_ID: null,
      AWS_COGNITO_CLIENT_ID: null,
      AWS_COGNITO_DOMAIN: null,
    },
    async () => {
      const response = await POST(new Request("http://localhost/auth/sign-out", { method: "POST" }));

      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), "http://localhost/");
      assert.match(response.headers.get("set-cookie") || "", /Expires=Thu, 01 Jan 1970/);
    },
  );
});
