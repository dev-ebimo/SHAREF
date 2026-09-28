// Simple in-memory rate limiter — same idea as express-rate-limit's default
// MemoryStore, which is what the original app actually used in production.
//
// Honest limitation: this Map lives in one Worker isolate. Under real
// traffic, Cloudflare may route requests to multiple isolates, so a
// determined attacker spread across them could exceed these limits more
// than the numbers below suggest. For a small app this is a reasonable
// v1 — if it ever needs to be airtight, move the counters into Cloudflare
// KV or a Durable Object (or use Cloudflare's own dashboard-level Rate
// Limiting rules, which are enforced at the edge before a request even
// reaches this code).

const buckets = new Map(); // key -> { count, resetAt }

export function rateLimiter({ windowMs, max, message }) {
  return async (c, next) => {
    const ip = c.req.header("CF-Connecting-IP") || "unknown";
    const key = `${c.req.path}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > max) {
      return c.json(message, 429);
    }

    await next();
  };
}

export const loginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
});

export const otpLimiter = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many attempts. Please try again in 10 minutes." },
});
