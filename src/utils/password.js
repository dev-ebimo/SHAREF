import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Password hashing tuned for Cloudflare Workers' FREE plan (10 ms CPU/request).
//
// Why not bcryptjs: it is pure JavaScript. At cost 10 it needs ~80 ms of CPU
// per hash — roughly 8x the free-plan budget — so register/login/reset can be
// killed with Error 1102. PBKDF2 via Web Crypto runs in native code.
//
// Stored format:  pbkdf2-sha256$<iterations>$<saltBase64>$<hashBase64>
// The iteration count lives INSIDE each hash, so you can raise it later
// (set the PBKDF2_ITERATIONS var; Workers allows at most 100000) and every
// user is transparently upgraded the next time they log in.
//
// Legacy hashes ($2a$/$2b$ from the old Express app) still verify, and are
// re-hashed to PBKDF2 on that user's next successful login.
// ---------------------------------------------------------------------------
const ALGO = "pbkdf2-sha256";
export const DEFAULT_PBKDF2_ITERATIONS = 10000; // ~5 ms natively; fits the free plan
const MAX_WORKERS_ITERATIONS = 100000; // hard cap enforced by the Workers runtime
const SALT_BYTES = 16;
const KEY_BITS = 256;

const enc = new TextEncoder();

function toB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function configuredIterations(env) {
  const n = Number(env?.PBKDF2_ITERATIONS);
  if (!Number.isInteger(n) || n < 1000) return DEFAULT_PBKDF2_ITERATIONS;
  return Math.min(n, MAX_WORKERS_ITERATIONS);
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

// Constant-time comparison of two byte arrays.
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(env, password) {
  const iterations = configuredIterations(env);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${ALGO}$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

// Returns { ok, needsRehash }. Never throws on a malformed stored hash.
export async function verifyPassword(env, password, stored) {
  if (typeof stored !== "string" || !stored) return { ok: false, needsRehash: false };

  if (stored.startsWith(ALGO + "$")) {
    const [, itersStr, saltB64, hashB64] = stored.split("$");
    const iterations = Number(itersStr);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_WORKERS_ITERATIONS || !saltB64 || !hashB64) {
      return { ok: false, needsRehash: false };
    }
    let expected, actual;
    try {
      expected = fromB64(hashB64);
      actual = await derive(password, fromB64(saltB64), iterations);
    } catch {
      return { ok: false, needsRehash: false };
    }
    const ok = timingSafeEqual(actual, expected);
    return { ok, needsRehash: ok && iterations < configuredIterations(env) };
  }

  if (stored.startsWith("$2")) {
    // Legacy bcrypt from the pre-migration app. Expensive on the free plan,
    // but unavoidable for the one login that upgrades the hash.
    let ok = false;
    try {
      ok = await bcrypt.compare(password, stored);
    } catch {
      ok = false;
    }
    return { ok, needsRehash: ok };
  }

  return { ok: false, needsRehash: false };
}

// Burns roughly the same CPU as a real verification. Used when the account
// doesn't exist so response time doesn't reveal whether an email is registered.
export async function dummyVerify(env, password) {
  await derive(String(password ?? ""), crypto.getRandomValues(new Uint8Array(SALT_BYTES)), configuredIterations(env));
}
