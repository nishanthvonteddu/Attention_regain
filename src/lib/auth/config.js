const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const DEFAULT_AUTH_ROUTES = {
  callbackPath: "/auth/callback",
  signOutPath: "/auth/sign-out",
  protectedHomePath: "/app",
  publicHomePath: "/",
};

const DEFAULT_SESSION_COOKIE_NAME = "attention_regain_session";

export const AUTH_ENV_CONTRACT = [
  {
    name: "AWS_COGNITO_DOMAIN",
    scope: "server",
  },
  {
    name: "AUTH_CALLBACK_PATH",
    scope: "server",
  },
  {
    name: "AUTH_SIGN_OUT_PATH",
    scope: "server",
  },
  {
    name: "AUTH_PROTECTED_HOME_PATH",
    scope: "server",
  },
  {
    name: "AUTH_PUBLIC_HOME_PATH",
    scope: "server",
  },
  {
    name: "AUTH_SESSION_COOKIE_NAME",
    scope: "server",
  },
];

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBoolean(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function missingKeys(env, keys) {
  return keys.filter((key) => !hasValue(env[key]));
}

function normalizePath(value, fallback) {
  if (!hasValue(value)) {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeHostedUiDomain(value) {
  if (!hasValue(value)) {
    return "";
  }

  return value.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function hasPartialCognitoConfig(env) {
  return [
    "AWS_REGION",
    "AWS_COGNITO_USER_POOL_ID",
    "AWS_COGNITO_CLIENT_ID",
    "AWS_COGNITO_DOMAIN",
  ].some((key) => hasValue(env[key]));
}

export function getCognitoAuthReport(env = process.env) {
  const awsServicesEnabled = parseBoolean(env.ENABLE_AWS_SERVICES, false);
  const issues = [];
  const warnings = [];
  const missingCoreConfig = missingKeys(env, [
    "AWS_REGION",
    "AWS_COGNITO_USER_POOL_ID",
    "AWS_COGNITO_CLIENT_ID",
    "AWS_COGNITO_DOMAIN",
  ]);

  if (awsServicesEnabled && missingCoreConfig.length) {
    issues.push(
      `Cognito auth is missing required values: ${missingCoreConfig.join(", ")}.`,
    );
  }

  if (!awsServicesEnabled && hasPartialCognitoConfig(env) && missingCoreConfig.length) {
    warnings.push(
      `Cognito is only partially configured for the scaffold. Missing: ${missingCoreConfig.join(
        ", ",
      )}.`,
    );
  }

  const routes = {
    callbackPath: normalizePath(env.AUTH_CALLBACK_PATH, DEFAULT_AUTH_ROUTES.callbackPath),
    signOutPath: normalizePath(env.AUTH_SIGN_OUT_PATH, DEFAULT_AUTH_ROUTES.signOutPath),
    protectedHomePath: normalizePath(
      env.AUTH_PROTECTED_HOME_PATH,
      DEFAULT_AUTH_ROUTES.protectedHomePath,
    ),
    publicHomePath: normalizePath(env.AUTH_PUBLIC_HOME_PATH, DEFAULT_AUTH_ROUTES.publicHomePath),
  };
  const hostedUiDomain = normalizeHostedUiDomain(env.AWS_COGNITO_DOMAIN);
  const configured = missingCoreConfig.length === 0;

  return {
    awsServicesEnabled,
    configured,
    status: configured ? "cognito-ready" : "local-preview",
    issues,
    warnings,
    routes,
    client: {
      region: env.AWS_REGION || "",
      clientId: env.AWS_COGNITO_CLIENT_ID || "",
      hostedUiDomain,
      routes,
    },
    server: {
      region: env.AWS_REGION || "",
      userPoolId: env.AWS_COGNITO_USER_POOL_ID || "",
      sessionCookieName: env.AUTH_SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME,
    },
  };
}

export function toClientAuthConfig(report) {
  return {
    configured: report.configured,
    status: report.status,
    warnings: report.warnings,
    routes: report.routes,
    client: report.client,
  };
}

export function buildCognitoHostedUiUrl({
  auth,
  origin,
  prompt = "login",
  redirectPath,
} = {}) {
  if (!auth?.configured || !hasValue(origin) || !auth.client.hostedUiDomain) {
    return null;
  }

  const callbackTarget = new URL(
    redirectPath || auth.routes.callbackPath,
    origin,
  ).toString();
  const authorizeUrl = new URL(
    "/oauth2/authorize",
    `https://${auth.client.hostedUiDomain}`,
  );

  authorizeUrl.searchParams.set("client_id", auth.client.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid email profile");
  authorizeUrl.searchParams.set("redirect_uri", callbackTarget);
  authorizeUrl.searchParams.set("prompt", prompt);

  return authorizeUrl.toString();
}

export function buildCognitoLogoutUrl({ auth, origin } = {}) {
  if (!auth?.configured || !hasValue(origin) || !auth.client.hostedUiDomain) {
    return null;
  }

  const logoutUrl = new URL("/logout", `https://${auth.client.hostedUiDomain}`);
  logoutUrl.searchParams.set("client_id", auth.client.clientId);
  logoutUrl.searchParams.set(
    "logout_uri",
    new URL(auth.routes.publicHomePath, origin).toString(),
  );

  return logoutUrl.toString();
}
