import { timingSafeEqual } from "./password.js";

// Generates a 6-digit numeric OTP as a string, e.g. "042917".
// Uses crypto.getRandomValues with rejection sampling (no modulo bias).
export function generateOTP() {
  const min = 100000;
  const max = 999999; // inclusive
  const range = max - min + 1;
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % range);

  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);

  return String(min + (value % range));
}

// OTPs are never stored in plaintext: a database leak (or a read-only
// SQL injection) must not hand out live verification / reset codes.
// HMAC-SHA256 keyed with the server secret, bound to the user id and the
// purpose, so the same code yields different hashes for different users/flows.
// (A 6-digit code is brute-forceable offline if the hash AND key leak — the
// real protection is the per-OTP attempt cap enforced in the DB, see
// authController.js. Hashing just removes the trivial plaintext exposure.)
export async function hashOtp(env, userId, purpose, otp) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`otp:${purpose}:${userId}:${otp}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function otpMatches(env, userId, purpose, submittedOtp, storedHash) {
  if (!storedHash || typeof submittedOtp !== "string") return false;
  const submitted = await hashOtp(env, userId, purpose, submittedOtp);
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(submitted), enc.encode(storedHash));
}
