import { pathToFileURL } from "node:url";

import { buildCognitoHostedUiUrl, getCognitoAuthReport } from "../src/lib/auth/config.js";
import { getEnvironmentReport, parseBoolean } from "../src/lib/env.js";

const DEFAULT_TIMEOUT_MS = 8000;
const REQUIRED_PRODUCTION_FLAGS = [
  "ENABLE_AWS_SERVICES",
  "ENABLE_DATABASE",
  "ENABLE_RETRIEVAL_PIPELINE",
];
const REQUIRED_ENV = [
  "ATTENTION_REGAIN_ENV",
  "PRODUCTION_APP_URL",
  "PRODUCTION_DEPLOYMENT_TARGET",
  "PRODUCTION_WORKER_RUNTIME",
  "AWS_REGION",
  "AWS_S3_BUCKET_DOCUMENTS",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_COGNITO_USER_POOL_ID",
  "AWS_COGNITO_CLIENT_ID",
  "AWS_COGNITO_DOMAIN",
  "QUEUE_URL_DOCUMENT_PROCESSING",
  "DATABASE_URL",
];

export async function validateProductionReadiness(env = process.env, options = {}) {
  const issues = [];
  const warnings = [];
  const checks = [];
  const appUrl = normalizeUrl(env.PRODUCTION_APP_URL);
  const authReport = getCognitoAuthReport(env);
  const environmentReport = getEnvironmentReport(env);

  if (String(env.ATTENTION_REGAIN_ENV || "").trim() !== "production") {
    issues.push("ATTENTION_REGAIN_ENV must be production for hosted release validation.");
  }

  for (const key of REQUIRED_PRODUCTION_FLAGS) {
    if (!parseBoolean(env[key], false)) {
      issues.push(`${key} must be true for production release validation.`);
    }
  }

  for (const key of REQUIRED_ENV) {
    if (!hasValue(env[key])) {
      issues.push(`${key} is required for production release validation.`);
    }
  }

  issues.push(...environmentReport.fatalIssues);
  warnings.push(...environmentReport.warnings, ...authReport.warnings);

  if (!appUrl) {
    issues.push("PRODUCTION_APP_URL must be an absolute HTTPS URL.");
  } else if (appUrl.protocol !== "https:") {
    issues.push("PRODUCTION_APP_URL must use HTTPS.");
  }

  if (!authReport.configured) {
    issues.push("Cognito Hosted UI settings are incomplete.");
  }

  const hostedUiUrl = buildCognitoHostedUiUrl({
    auth: {
      configured: authReport.configured,
      client: authReport.client,
      routes: authReport.routes,
    },
    origin: appUrl?.origin,
    redirectPath: authReport.routes.callbackPath,
    state: authReport.routes.protectedHomePath,
  });

  if (!hostedUiUrl) {
    issues.push("Cognito Hosted UI start URL could not be generated.");
  }

  const expected = {
    appUrl: appUrl?.toString() || "",
    callbackUrl: appUrl ? new URL(authReport.routes.callbackPath, appUrl).toString() : "",
    logoutUrl: appUrl ? new URL(authReport.routes.publicHomePath, appUrl).toString() : "",
    hostedUiDomain: authReport.client.hostedUiDomain,
    deploymentTarget: clean(env.PRODUCTION_DEPLOYMENT_TARGET),
    workerRuntime: clean(env.PRODUCTION_WORKER_RUNTIME),
    awsRegion: clean(env.AWS_REGION),
    documentBucket: clean(env.AWS_S3_BUCKET_DOCUMENTS),
    queueConfigured: hasValue(env.QUEUE_URL_DOCUMENT_PROCESSING),
    databaseConfigured: hasValue(env.DATABASE_URL),
  };

  if (options.http && appUrl) {
    checks.push(...(await runHttpSmokeChecks({ appUrl, hostedUiDomain: expected.hostedUiDomain })));
  }

  return {
    ok: issues.length === 0 && checks.every((check) => check.ok),
    issues,
    warnings: Array.from(new Set(warnings)),
    expected,
    checks,
  };
}

export function summarizeProductionReadiness(result) {
  const lines = [];

  if (result.ok) {
    lines.push("production readiness contract passed.");
  } else {
    lines.push("production readiness contract failed.");
  }

  if (result.issues.length) {
    lines.push("blocking issues:");
    for (const issue of result.issues) {
      lines.push(`- ${issue}`);
    }
  }

  if (result.checks.length) {
    lines.push("http checks:");
    for (const check of result.checks) {
      lines.push(`- ${check.name}: ${check.ok ? "passed" : "failed"}${check.detail ? ` (${check.detail})` : ""}`);
    }
  }

  lines.push("expected production wiring:");
  lines.push(`- app url: ${result.expected.appUrl || "(missing)"}`);
  lines.push(`- callback url: ${result.expected.callbackUrl || "(missing)"}`);
  lines.push(`- logout url: ${result.expected.logoutUrl || "(missing)"}`);
  lines.push(`- hosted ui domain: ${result.expected.hostedUiDomain || "(missing)"}`);
  lines.push(`- deployment target: ${result.expected.deploymentTarget || "(missing)"}`);
  lines.push(`- worker runtime: ${result.expected.workerRuntime || "(missing)"}`);
  lines.push(`- aws region: ${result.expected.awsRegion || "(missing)"}`);
  lines.push(`- document bucket: ${result.expected.documentBucket || "(missing)"}`);
  lines.push(`- queue configured: ${result.expected.queueConfigured ? "yes" : "no"}`);
  lines.push(`- database configured: ${result.expected.databaseConfigured ? "yes" : "no"}`);

  return `${lines.join("\n")}\n`;
}

async function runHttpSmokeChecks({ appUrl, hostedUiDomain }) {
  const checks = [];
  checks.push(await fetchCheck("home page reachable", new URL("/", appUrl)));
  checks.push(
    await redirectCheck({
      name: "Cognito start redirects to Hosted UI",
      url: new URL("/auth/sign-in/start?redirect=/app", appUrl),
      expectedHost: hostedUiDomain,
    }),
  );
  checks.push(await fetchCheck("unauthenticated study feed is protected", new URL("/api/study-feed", appUrl), 401));
  return checks;
}

async function fetchCheck(name, url, expectedStatus = null) {
  try {
    const response = await fetchWithTimeout(url, { redirect: "manual" });
    const ok = expectedStatus ? response.status === expectedStatus : response.status >= 200 && response.status < 400;
    return {
      name,
      ok,
      detail: `status ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error.message,
    };
  }
}

async function redirectCheck({ name, url, expectedHost }) {
  try {
    const response = await fetchWithTimeout(url, { redirect: "manual" });
    const location = response.headers.get("location") || "";
    const target = location ? new URL(location, url) : null;
    return {
      name,
      ok: response.status >= 300 && response.status < 400 && target?.host === expectedHost,
      detail: location ? `status ${response.status} -> ${target.host}` : `status ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error.message,
    };
  }
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUrl(value) {
  if (!hasValue(value)) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function clean(value) {
  return String(value || "").trim();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await validateProductionReadiness(process.env, {
    http: args.has("--http"),
  });

  process.stdout.write(summarizeProductionReadiness(result));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
