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
      label: "Private app unlocked",
      description:
        "The shell is using a server-issued session cookie. Protected routes now resolve against an authenticated product boundary instead of anonymous browser state.",
      persistenceLabel: "Account-bound session",
      authLabel: "Authenticated route boundary",
    };
  }

  if (auth?.configured) {
    return {
      label: "Sign in required",
      description:
        "The Hosted UI wiring is configured, but the user still needs a valid session before the private study workspace should open.",
      persistenceLabel: "Anonymous preview only",
      authLabel: "Hosted UI start route ready",
    };
  }

  return {
    label: "Local sign-in ready",
    description:
      "Cognito is not fully configured yet, so the shell exposes a local preview sign-in to exercise the protected route boundary during the single-user MVP phase.",
    persistenceLabel: "Server cookie after local sign-in",
    authLabel: "Local preview auth enabled",
  };
}
