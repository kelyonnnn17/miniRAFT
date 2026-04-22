const WINDOW_MS = Number(process.env.MINIRAFT_RATE_LIMIT_WINDOW_MS || 60_000);
const MAX_REQUESTS = Number(process.env.MINIRAFT_RATE_LIMIT_MAX_REQUESTS || 120);

const buckets = new Map();

export function consumeRateLimit(key) {
  const now = Date.now();
  const bucket = buckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start >= WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, MAX_REQUESTS - bucket.count);
  return {
    allowed: bucket.count <= MAX_REQUESTS,
    remaining,
    resetAt: bucket.start + WINDOW_MS,
  };
}
