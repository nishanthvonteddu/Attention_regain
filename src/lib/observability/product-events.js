import { createPublicId, estimateTokens, nowIso } from "../data/schema.js";

export const PRODUCT_EVENT_NAMES = Object.freeze([
  "upload.prepared",
  "upload.rejected",
  "upload.confirmed",
  "generation.queued",
  "generation.retry_queued",
  "job.claimed",
  "parse.started",
  "parse.succeeded",
  "parse.failed",
  "chunking.succeeded",
  "generation.started",
  "generation.succeeded",
  "generation.fallback",
  "generation.failed",
  "feed.ready",
  "job.retrying",
  "job.dead_lettered",
]);

export const PRODUCT_EVENT_STAGES = Object.freeze([
  "upload",
  "queue",
  "worker",
  "parse",
  "chunking",
  "retrieval",
  "generation",
  "feed",
]);

export const DEFAULT_MODEL_COST_RATE_USD_PER_1K = Object.freeze({
  input: 0.0002,
  output: 0.0002,
});

export function createProductEvent(input = {}) {
  const eventName = requireKnown(input.eventName, PRODUCT_EVENT_NAMES, "eventName");
  const stage = requireKnown(input.stage, PRODUCT_EVENT_STAGES, "stage");
  const status = normalizeStatus(input.status);
  const timestamp = nowIso();
  const cost = normalizeCost(input.cost);

  return {
    id: createPublicId("event"),
    eventName,
    stage,
    status,
    userId: requireNonEmpty(input.userId, "userId"),
    documentId: optionalString(input.documentId),
    sessionId: optionalString(input.sessionId),
    jobId: optionalString(input.jobId),
    latencyMs: normalizeNonNegativeNumber(input.latencyMs),
    cost,
    payload: normalizePayload(input.payload),
    createdAt: timestamp,
  };
}

export function estimateModelCost({
  model,
  prompt = "",
  output = "",
  usage = null,
  rate = DEFAULT_MODEL_COST_RATE_USD_PER_1K,
} = {}) {
  const inputTokens = usage && Number.isFinite(Number(usage.prompt_tokens))
    ? Number(usage.prompt_tokens)
    : estimateTokens(prompt);
  const outputTokens = usage && Number.isFinite(Number(usage.completion_tokens))
    ? Number(usage.completion_tokens)
    : estimateTokens(output);
  const inputCostUsd = (inputTokens / 1000) * rate.input;
  const outputCostUsd = (outputTokens / 1000) * rate.output;
  const estimatedCostUsd = roundUsd(inputCostUsd + outputCostUsd);

  return {
    currency: "USD",
    estimated: true,
    model: optionalString(model) || "unknown-model",
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputCostUsd: roundUsd(inputCostUsd),
    outputCostUsd: roundUsd(outputCostUsd),
    estimatedCostUsd,
    rateUsdPer1KTokens: {
      input: rate.input,
      output: rate.output,
    },
  };
}

export function createZeroModelCost({ model = "heuristic-fallback", reason = "no_model_request" } = {}) {
  return {
    currency: "USD",
    estimated: true,
    model,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputCostUsd: 0,
    outputCostUsd: 0,
    estimatedCostUsd: 0,
    reason,
    rateUsdPer1KTokens: {
      input: DEFAULT_MODEL_COST_RATE_USD_PER_1K.input,
      output: DEFAULT_MODEL_COST_RATE_USD_PER_1K.output,
    },
  };
}

export function summarizeOperationalEvents({
  documents = [],
  jobs = [],
  sessions = [],
  events = [],
} = {}) {
  const sortedEvents = [...events]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const failedEvents = events.filter((event) => event.status === "failed");
  const firstFeedEvents = events.filter(
    (event) => event.eventName === "feed.ready" && Number.isFinite(event.latencyMs),
  );
  const costEvents = events.filter((event) => event.cost?.estimatedCostUsd != null);
  const stageLatency = buildStageLatency(events);
  const estimatedSpendUsd = roundUsd(
    costEvents.reduce((sum, event) => sum + Number(event.cost.estimatedCostUsd || 0), 0),
  );

  return {
    generatedAt: nowIso(),
    totals: {
      documentCount: documents.length,
      jobCount: jobs.length,
      readySessionCount: sessions.filter((session) => session.status === "ready").length,
      eventCount: events.length,
      failureEventCount: failedEvents.length,
      estimatedSpendUsd,
    },
    latency: {
      timeToFirstFeedMs: latestMetric(firstFeedEvents, "latencyMs"),
      averageTimeToFirstFeedMs: averageMetric(firstFeedEvents, "latencyMs"),
      byStage: stageLatency,
    },
    failures: failedEvents.slice(-10).map(compactEvent),
    latestEvents: sortedEvents.slice(0, 12).map(compactEvent),
    documents: documents
      .map((document) => summarizeDocument({ document, jobs, sessions, events }))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))),
  };
}

export function compactEvent(event) {
  return {
    id: event.id,
    eventName: event.eventName,
    stage: event.stage,
    status: event.status,
    documentId: event.documentId || "",
    jobId: event.jobId || "",
    latencyMs: event.latencyMs,
    cost: event.cost || null,
    detail: event.payload?.detail || event.payload?.reason || "",
    createdAt: event.createdAt,
  };
}

function summarizeDocument({ document, jobs, sessions, events }) {
  const documentEvents = events.filter((event) => event.documentId === document.id);
  const documentJobs = jobs.filter((job) => job.documentId === document.id);
  const documentSessions = sessions.filter((session) => session.documentId === document.id);
  const latestJob = [...documentJobs]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
  const latestSession = [...documentSessions]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
  const spendUsd = roundUsd(
    documentEvents.reduce((sum, event) => sum + Number(event.cost?.estimatedCostUsd || 0), 0),
  );
  const feedReady = [...documentEvents]
    .reverse()
    .find((event) => event.eventName === "feed.ready");

  return {
    id: document.id,
    title: document.title,
    status: document.status,
    parseStatus: document.parseStatus || null,
    updatedAt: document.updatedAt,
    latestJobStatus: latestJob?.status || "",
    latestSessionId: latestSession?.id || "",
    firstFeedLatencyMs: feedReady?.latencyMs ?? null,
    estimatedSpendUsd: spendUsd,
    failureReason: document.failureReason || "",
    eventCount: documentEvents.length,
    latestEvent: documentEvents
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(compactEvent)[0] || null,
  };
}

function buildStageLatency(events) {
  const byStage = new Map();
  for (const event of events) {
    if (!Number.isFinite(event.latencyMs)) {
      continue;
    }
    const current = byStage.get(event.stage) || [];
    current.push(event.latencyMs);
    byStage.set(event.stage, current);
  }

  return Object.fromEntries(
    [...byStage.entries()].map(([stage, values]) => [
      stage,
      {
        latestMs: values[values.length - 1],
        averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
        sampleCount: values.length,
      },
    ]),
  );
}

function averageMetric(events, key) {
  const values = events.map((event) => event[key]).filter(Number.isFinite);
  if (!values.length) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function latestMetric(events, key) {
  const latest = [...events]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .find((event) => Number.isFinite(event[key]));
  return latest ? latest[key] : null;
}

function normalizeCost(cost) {
  if (!cost || typeof cost !== "object") {
    return null;
  }

  return {
    currency: optionalString(cost.currency) || "USD",
    estimated: cost.estimated !== false,
    model: optionalString(cost.model),
    inputTokens: normalizeNonNegativeNumber(cost.inputTokens),
    outputTokens: normalizeNonNegativeNumber(cost.outputTokens),
    totalTokens: normalizeNonNegativeNumber(cost.totalTokens),
    inputCostUsd: normalizeNonNegativeAmount(cost.inputCostUsd),
    outputCostUsd: normalizeNonNegativeAmount(cost.outputCostUsd),
    estimatedCostUsd: normalizeNonNegativeAmount(cost.estimatedCostUsd),
    reason: optionalString(cost.reason),
    rateUsdPer1KTokens: cost.rateUsdPer1KTokens || {},
  };
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return JSON.parse(JSON.stringify(payload));
}

function normalizeStatus(status) {
  return ["started", "succeeded", "failed", "queued", "fallback", "retrying"].includes(status)
    ? status
    : "succeeded";
}

function normalizeNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function normalizeNonNegativeAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? roundUsd(number) : null;
}

function roundUsd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000_000) / 1_000_000 : 0;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireKnown(value, allowed, label) {
  const normalized = requireNonEmpty(value, label);
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported ${label}: ${normalized}`);
  }
  return normalized;
}

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}
