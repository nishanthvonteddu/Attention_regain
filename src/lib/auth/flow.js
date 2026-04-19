const AUTH_ERROR_MESSAGES = {
  auth_required: "Sign in before opening the private study workspace.",
  missing_identity: "Add at least a display name or email to start a local session.",
  cognito_not_configured:
    "Cognito is not configured yet. Use the local preview sign-in for the single-user MVP.",
  callback_missing_code: "The auth callback did not include a code to exchange.",
  callback_exchange_not_implemented:
    "The Hosted UI callback reached the app, but token exchange is intentionally deferred until the backend auth pass.",
  access_denied:
    "The Hosted UI returned an error. Sign in again or continue with the local preview session.",
};

export function normalizeRedirectPath(value, fallback = "/app") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }

  return trimmed;
}

export function buildSignInPath({
  redirectPath = "/app",
  error = "",
  basePath = "/auth/sign-in",
} = {}) {
  const params = new URLSearchParams();
  const normalizedRedirect = normalizeRedirectPath(redirectPath, "/app");

  if (normalizedRedirect) {
    params.set("redirect", normalizedRedirect);
  }

  if (error) {
    params.set("error", error);
  }

  return params.toString() ? `${basePath}?${params.toString()}` : basePath;
}

export function getAuthErrorMessage(errorCode) {
  if (typeof errorCode !== "string" || !errorCode) {
    return "";
  }

  return AUTH_ERROR_MESSAGES[errorCode] || "The auth flow could not be completed.";
}

