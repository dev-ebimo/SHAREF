// Cloudinary helpers for Workers. The Node SDK wraps Node's http/https modules
// and doesn't run here, so this signs requests against the REST API directly.
//
// Signing algorithm, per Cloudinary's docs (cloudinary.com/documentation/authentication_signatures):
//   1. Take every param in the request EXCEPT file, cloud_name, resource_type, api_key.
//   2. Sort those params alphabetically by key.
//   3. Join as "key=value" pairs with "&".
//   4. Append the api_secret directly (no separator).
//   5. SHA-1 hex digest of that string is the signature.
async function signParams(params, apiSecret) {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const toSign = sorted + apiSecret;

  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(toSign));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// File bytes never pass through the Worker (CPU limit). Instead the browser
// POSTs the file straight to Cloudinary using this short-lived signed permit.
// The signature pins the exact public_id, so a permit can't be reused to
// upload anywhere else, and an attacker can't choose their own filename/path.
export async function signUploadPermit(env, publicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { access_mode: "public", public_id: publicId, timestamp };
  const signature = await signParams(paramsToSign, env.CLOUDINARY_API_SECRET);
  return {
    url: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/raw/upload`,
    fields: {
      api_key: env.CLOUDINARY_API_KEY,
      timestamp: String(timestamp),
      signature,
      public_id: publicId,
      access_mode: "public",
    },
  };
}

// Raw assets are served from a deterministic URL derived from the public_id
// (for raw files the extension is part of the public_id). Built server-side
// so the client never gets to say where its file "is".
export function buildRawFileUrl(env, publicId) {
  return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/raw/upload/${publicId}`;
}

// Treats "not found" (the file was somehow already gone) as success rather
// than an error — the goal is the file no longer existing, which is already
// true either way, so callers' DB cleanup isn't blocked by it.
// resourceType defaults to "raw"; pass "image" for a legacy preview-image asset.
export async function deleteFromCloudinary(env, publicId, resourceType = "raw") {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { public_id: publicId, timestamp };
  const signature = await signParams(paramsToSign, env.CLOUDINARY_API_SECRET);

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", env.CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);

  const destroyUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`;
  const res = await fetch(destroyUrl, { method: "POST", body: form });
  const body = await res.json();

  if (!res.ok || (body.result !== "ok" && body.result !== "not found")) {
    throw new Error(body?.error?.message || `Cloudinary destroy failed (${res.status})`);
  }
  return body;
}
