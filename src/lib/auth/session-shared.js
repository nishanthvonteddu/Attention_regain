export const SESSION_COOKIE_VERSION = 1;

export function createAnonymousProductSession(reason = "anonymous-preview") {
  return {
    version: SESSION_COOKIE_VERSION,
    status: "anonymous",
    access: "public-preview",
    persistence: "browser-local",
    reason,
    user: null,
    expiresAt: null,
  };
}

export function createAuthenticatedProductSession({
  userId,
  email = "",
  displayName = "",
  expiresAt = null,
  source = "cognito",
}) {
  if (!userId) {
    throw new Error("Authenticated product sessions require a stable user id.");
  }

  return {
    version: SESSION_COOKIE_VERSION,
    status: "authenticated",
    access: "private-app",
    persistence: "account-bound",
    reason: source,
    user: {
      id: userId,
      email,
      displayName,
    },
    expiresAt,
  };
}

export function isAuthenticatedProductSession(session) {
  return session?.status === "authenticated" && typeof session.user?.id === "string";
}

export function serializeProductSession(session) {
  if (!isAuthenticatedProductSession(session)) {
    return "";
  }

  return Buffer.from(
    JSON.stringify({
      version: SESSION_COOKIE_VERSION,
      sub: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      expiresAt: session.expiresAt,
    }),
    "utf8",
  ).toString("base64url");
}

export function readSerializedProductSession(value) {
  if (typeof value !== "string" || !value) {
    return createAnonymousProductSession("missing-session-cookie");
  }

  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof payload.sub !== "string" || !payload.sub) {
      return createAnonymousProductSession("invalid-session-cookie");
    }

    return createAuthenticatedProductSession({
      userId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      displayName: typeof payload.displayName === "string" ? payload.displayName : "",
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
    });
  } catch {
    return createAnonymousProductSession("invalid-session-cookie");
  }
}

export function getProductShellState({ auth, session }) {
  if (isAuthenticatedProductSession(session)) {
    return {
      label: "Signed in",
      description:
        "The shell is using an account-bound session. Protected routes can now rely on a server-issued session cookie instead of browser-local state.",
      persistenceLabel: "Account-bound session",
      authLabel: "Cognito session active",
    };
  }

  if (auth?.configured) {
    return {
      label: "Cognito scaffold ready",
      description:
        "Cognito config, callback assumptions, and the server/client session boundary are in place. Day 02.2 will connect the real sign-in and protected route flow.",
      persistenceLabel: "Browser-local until sign-in ships",
      authLabel: "Hosted UI wiring defined",
    };
  }

  return {
    label: "Local preview mode",
    description:
      "The app still runs as an anonymous preview because Cognito is not fully configured. The shell keeps browser-local persistence and does not assume a signed-in user.",
    persistenceLabel: "Browser-local session",
    authLabel: "Cognito config incomplete",
  };
}
