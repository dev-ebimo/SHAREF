import { sign } from "hono/jwt";

// Signs a token containing the user's id and role — same payload shape as
// the original jsonwebtoken-based generateToken, so existing tokens issued
// by the Render backend and new ones issued here are interchangeable during
// the cutover window.
export async function generateToken(env, userId, role) {
  const expireSeconds = 7 * 24 * 60 * 60; // 7d, matches JWT_EXPIRE default
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { id: userId, role, iat: now, exp: now + expireSeconds },
    env.JWT_SECRET
  );
}
