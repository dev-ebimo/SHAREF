// Salted SHA-256 of an IP address. Stored at signup ONLY so referral rings
// (many accounts from one connection inviting each other) can be detected.
// The raw IP is never stored, and the salt is the server secret, so the hash
// can't be reversed or matched against another system's data.
export async function hashIp(env, ip) {
  if (!ip || typeof ip !== "string") return null;
  const data = new TextEncoder().encode(`${env.JWT_SECRET}:ip:${ip.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
