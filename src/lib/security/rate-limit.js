const DEFAULT_LIMITS = Object.freeze({
  upload: { limit: 12, windowMs: 60_000 },
  generation: { limit: 10, windowMs: 60_000 },
  interaction: { limit: 120, windowMs: 60_000 },
  auth: { limit: 8, windowMs: 60_000 },
});

const buckets = new Map();

export function checkRateLimit({
  request,
  scope,
  userId = "",
  now = Date.now(),
  limits = DEFAULT_LIMITS,
} = {}) {
  const policy = limits[scope] || limits.default;
  if (!policy) {
    throw new Error(`Unknown rate limit scope: ${scope}`);
  }

  const identity = resolveRateLimitIdentity({ request, userId });
  const bucketKey = `${scope}:${identity}`;
  const existing = buckets.get(bucketKey);
  const resetAt =
    existing && existing.resetAt > now ? existing.resetAt : now + policy.windowMs;
  const count = existing && existing.resetAt > now ? existing.count + 1 : 1;
  const remaining = Math.max(0, policy.limit - count);

  buckets.set(bucketKey, {
    count,
    resetAt,
  });

  return {
    allowed: count <= policy.limit,
    scope,
    identity,
    limit: policy.limit,
    remaining,
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

export function rateLimitHeaders(result) {
  return {
    "Retry-After": String(result.retryAfterSeconds),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

export function rateLimitResponse(result) {
  return Response.json(
    {
      error: "Too many requests. Wait briefly before trying again.",
      code: "rate_limited",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: rateLimitHeaders(result),
    },
  );
}

export function resetRateLimitState() {
  buckets.clear();
}

function resolveRateLimitIdentity({ request, userId }) {
  if (userId) {
    return `user:${userId}`;
  }

  const forwardedFor = request?.headers?.get("x-forwarded-for") || "";
  const clientIp = forwardedFor.split(",")[0]?.trim();
  if (clientIp) {
    return `ip:${clientIp}`;
  }

  return "anonymous";
}
