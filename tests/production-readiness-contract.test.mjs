import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  summarizeProductionReadiness,
  validateProductionReadiness,
} from "../scripts/validate-production-readiness.mjs";
import { getEnvironmentReport } from "../src/lib/env.js";

test("production runtime requires hosted deployment settings", () => {
  const report = getEnvironmentReport({
    ATTENTION_REGAIN_ENV: "production",
    ENABLE_AWS_SERVICES: "false",
  });

  assert.match(
    report.fatalIssues.join("\n"),
    /PRODUCTION_APP_URL, PRODUCTION_DEPLOYMENT_TARGET, PRODUCTION_WORKER_RUNTIME/,
  );
});

test("production readiness contract validates AWS, database, auth, and hosted URLs", async () => {
  const result = await validateProductionReadiness(buildProductionEnv());

  assert.equal(result.ok, true);
  assert.equal(result.expected.appUrl, "https://study.example.com/");
  assert.equal(result.expected.callbackUrl, "https://study.example.com/auth/callback");
  assert.equal(result.expected.logoutUrl, "https://study.example.com/");
  assert.equal(result.expected.hostedUiDomain, "attention-regain.auth.us-east-1.amazoncognito.com");
  assert.equal(result.expected.deploymentTarget, "app-runner");
  assert.equal(result.expected.workerRuntime, "lambda");
  assert.equal(result.expected.queueConfigured, true);
  assert.equal(result.expected.databaseConfigured, true);

  const summary = summarizeProductionReadiness(result);
  assert.match(summary, /production readiness contract passed/);
  assert.doesNotMatch(summary, /secret-key/);
  assert.doesNotMatch(summary, /postgres:\/\/reader:password/);
});

test("production readiness contract blocks unsafe or incomplete production wiring", async () => {
  const result = await validateProductionReadiness({
    ATTENTION_REGAIN_ENV: "production",
    PRODUCTION_APP_URL: "http://study.example.com",
    ENABLE_AWS_SERVICES: "false",
    ENABLE_DATABASE: "false",
    ENABLE_RETRIEVAL_PIPELINE: "false",
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /PRODUCTION_APP_URL must use HTTPS/);
  assert.match(result.issues.join("\n"), /ENABLE_AWS_SERVICES must be true/);
  assert.match(result.issues.join("\n"), /ENABLE_DATABASE must be true/);
  assert.match(result.issues.join("\n"), /Cognito Hosted UI settings are incomplete/);
});

test("Day 15 production docs define inventory, secrets, deployment, connectivity, and smoke checks", async () => {
  const productionDoc = await readFile(
    new URL("../docs/production-readiness.md", import.meta.url),
    "utf8",
  );
  const setupDoc = await readFile(
    new URL("../docs/setup-and-release.md", import.meta.url),
    "utf8",
  );
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

  for (const expected of [
    "AWS Service Inventory",
    "Secret Placement",
    "Deployment Flow",
    "Connectivity Validation",
    "Production Smoke Test",
    "Release Freeze",
    "validate-production-readiness.mjs --http",
  ]) {
    assert.match(productionDoc, new RegExp(expected));
  }

  assert.match(productionDoc, /Cognito callback and logout URLs/);
  assert.match(productionDoc, /SQS receives a document-processing payload/);
  assert.match(productionDoc, /worker consumes the job/);
  assert.match(setupDoc + readme, /production-readiness\.md/);
  assert.match(envExample, /^PRODUCTION_APP_URL=$/m);
  assert.match(envExample, /^PRODUCTION_DEPLOYMENT_TARGET=$/m);
  assert.match(envExample, /^PRODUCTION_WORKER_RUNTIME=$/m);
});

function buildProductionEnv() {
  return {
    ATTENTION_REGAIN_ENV: "production",
    PRODUCTION_APP_URL: "https://study.example.com",
    PRODUCTION_DEPLOYMENT_TARGET: "app-runner",
    PRODUCTION_WORKER_RUNTIME: "lambda",
    ENABLE_AWS_SERVICES: "true",
    ENABLE_DATABASE: "true",
    ENABLE_RETRIEVAL_PIPELINE: "true",
    ENABLE_LIVE_GENERATION: "true",
    AWS_REGION: "us-east-1",
    AWS_S3_BUCKET_DOCUMENTS: "attention-regain-prod-documents",
    AWS_ACCESS_KEY_ID: "access-key",
    AWS_SECRET_ACCESS_KEY: "secret-key",
    AWS_COGNITO_USER_POOL_ID: "us-east-1_pool",
    AWS_COGNITO_CLIENT_ID: "client-id",
    AWS_COGNITO_DOMAIN: "attention-regain.auth.us-east-1.amazoncognito.com",
    QUEUE_URL_DOCUMENT_PROCESSING: "https://sqs.us-east-1.amazonaws.com/123456789012/document-processing",
    DATABASE_URL: "postgres://reader:password@db.example.com:5432/attention",
    NVIDIA_TEXT_API_KEY: "text-key",
    NVIDIA_EMBEDDING_API_KEY: "embedding-key",
    NVIDIA_EMBEDDING_MODEL: "embedding-model",
    NVIDIA_RERANK_API_KEY: "rerank-key",
    NVIDIA_RERANK_MODEL: "rerank-model",
  };
}
