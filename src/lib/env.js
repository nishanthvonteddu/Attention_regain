const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const DEFAULT_TEXT_MODEL = "meta/llama-3.1-70b-instruct";
const DEFAULT_EMBEDDING_MODEL = "nvidia/llama-3.2-nemoretriever-300m-embed-v1";
const DEFAULT_RERANK_MODEL = "nv-rerank-qa-mistral-4b:1";
const DEFAULT_VISION_MODEL = "meta/llama-3.2-90b-vision-instruct";

export const ENV_CONTRACT = [
  {
    name: "NEXT_PUBLIC_APP_NAME",
    scope: "public",
  },
  {
    name: "NEXT_PUBLIC_DEFAULT_GOAL",
    scope: "public",
  },
  {
    name: "NEXT_PUBLIC_ENABLE_UPLOADS",
    scope: "public",
  },
  {
    name: "ATTENTION_REGAIN_ENV",
    scope: "server",
  },
  {
    name: "ENABLE_LIVE_GENERATION",
    scope: "server",
  },
  {
    name: "NVIDIA_TEXT_API_KEY",
    scope: "server",
  },
  {
    name: "NVIDIA_TEXT_MODEL",
    scope: "server",
  },
  {
    name: "NVIDIA_API_KEY",
    scope: "server",
  },
  {
    name: "NVIDIA_MODEL",
    scope: "server",
  },
  {
    name: "ENABLE_RETRIEVAL_PIPELINE",
    scope: "server",
  },
  {
    name: "NVIDIA_EMBEDDING_API_KEY",
    scope: "server",
  },
  {
    name: "NVIDIA_EMBEDDING_MODEL",
    scope: "server",
  },
  {
    name: "NVIDIA_RERANK_API_KEY",
    scope: "server",
  },
  {
    name: "NVIDIA_RERANK_MODEL",
    scope: "server",
  },
  {
    name: "ENABLE_VISION_FALLBACK",
    scope: "server",
  },
  {
    name: "NVIDIA_VISION_API_KEY",
    scope: "server",
  },
  {
    name: "NVIDIA_VISION_MODEL",
    scope: "server",
  },
  {
    name: "ENABLE_AWS_SERVICES",
    scope: "server",
  },
  {
    name: "AWS_REGION",
    scope: "server",
  },
  {
    name: "AWS_S3_BUCKET_DOCUMENTS",
    scope: "server",
  },
  {
    name: "AWS_COGNITO_USER_POOL_ID",
    scope: "server",
  },
  {
    name: "AWS_COGNITO_CLIENT_ID",
    scope: "server",
  },
  {
    name: "QUEUE_URL_DOCUMENT_PROCESSING",
    scope: "server",
  },
  {
    name: "ENABLE_DATABASE",
    scope: "server",
  },
  {
    name: "DATABASE_URL",
    scope: "server",
  },
];

export function parseBoolean(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function missingKeys(env, keys) {
  return keys.filter((key) => !hasValue(env[key]));
}

export function getTextGenerationConfig(env = process.env) {
  const apiKey = env.NVIDIA_TEXT_API_KEY || env.NVIDIA_API_KEY || "";
  const model = env.NVIDIA_TEXT_MODEL || env.NVIDIA_MODEL || DEFAULT_TEXT_MODEL;
  const explicitlyEnabled = parseBoolean(env.ENABLE_LIVE_GENERATION, hasValue(apiKey));
  const issues = [];
  const warnings = [];

  if (explicitlyEnabled && !hasValue(apiKey)) {
    issues.push(
      "ENABLE_LIVE_GENERATION is true but no NVIDIA text-generation key is configured.",
    );
  }

  if (!explicitlyEnabled) {
    warnings.push("Live generation is disabled. The study feed will use heuristic fallback cards.");
  }

  return {
    enabled: explicitlyEnabled && issues.length === 0,
    explicitlyEnabled,
    apiKey,
    model,
    issues,
    warnings,
  };
}

export function getEnvironmentFlags(env = process.env) {
  return {
    retrievalPipeline: parseBoolean(env.ENABLE_RETRIEVAL_PIPELINE, false),
    visionFallback: parseBoolean(env.ENABLE_VISION_FALLBACK, false),
    awsServices: parseBoolean(env.ENABLE_AWS_SERVICES, false),
    database: parseBoolean(env.ENABLE_DATABASE, false),
  };
}

export function getEnvironmentReport(env = process.env) {
  const flags = getEnvironmentFlags(env);
  const generation = getTextGenerationConfig(env);
  const fatalIssues = [...generation.issues];
  const warnings = [...generation.warnings];

  if (flags.retrievalPipeline) {
    const missing = missingKeys(env, [
      "NVIDIA_EMBEDDING_API_KEY",
      "NVIDIA_EMBEDDING_MODEL",
      "NVIDIA_RERANK_API_KEY",
      "NVIDIA_RERANK_MODEL",
    ]);
    if (missing.length) {
      fatalIssues.push(
        `ENABLE_RETRIEVAL_PIPELINE is true but these values are missing: ${missing.join(", ")}.`,
      );
    }
  }

  if (flags.visionFallback) {
    const missing = missingKeys(env, ["NVIDIA_VISION_API_KEY", "NVIDIA_VISION_MODEL"]);
    if (missing.length) {
      fatalIssues.push(
        `ENABLE_VISION_FALLBACK is true but these values are missing: ${missing.join(", ")}.`,
      );
    }
  }

  if (flags.awsServices) {
    const missing = missingKeys(env, [
      "AWS_REGION",
      "AWS_S3_BUCKET_DOCUMENTS",
      "AWS_COGNITO_USER_POOL_ID",
      "AWS_COGNITO_CLIENT_ID",
      "QUEUE_URL_DOCUMENT_PROCESSING",
    ]);
    if (missing.length) {
      fatalIssues.push(
        `ENABLE_AWS_SERVICES is true but these values are missing: ${missing.join(", ")}.`,
      );
    }
  }

  if (flags.database) {
    const missing = missingKeys(env, ["DATABASE_URL"]);
    if (missing.length) {
      fatalIssues.push(
        `ENABLE_DATABASE is true but these values are missing: ${missing.join(", ")}.`,
      );
    }
  }

  return {
    flags,
    generation: {
      ...generation,
      modelDefaults: {
        text: DEFAULT_TEXT_MODEL,
        embedding: DEFAULT_EMBEDDING_MODEL,
        rerank: DEFAULT_RERANK_MODEL,
        vision: DEFAULT_VISION_MODEL,
      },
    },
    fatalIssues,
    warnings,
  };
}
