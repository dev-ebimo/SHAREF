// Replaces the Cloudinary Node SDK's cloudinary.uploader.upload()/.destroy(),
// which wrap Node's http/https modules internally and don't run on Workers.
// This does the same signed requests directly against Cloudinary's REST API.
//
// Signing algorithm, per Cloudinary's own docs (cloudinary.com/documentation/authentication_signatures):
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

// `fileBlob` is whatever Hono's parseBody() gave us for the file field —
// already a Web File (extends Blob), so it drops straight into FormData
// with no conversion needed.
export async function uploadToCloudinary(env, fileBlob, { folder }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { access_mode: "public", folder, timestamp };
  const signature = await signParams(paramsToSign, env.CLOUDINARY_API_SECRET);

  const form = new FormData();
  form.append("file", fileBlob);
  form.append("api_key", env.CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);
  form.append("access_mode", "public");

  // The stored file always uploads as "raw", regardless of type — see the
  // comment in resourceController.js's uploadResource for why.
  const uploadUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/raw/upload`;
  const res = await fetch(uploadUrl, { method: "POST", body: form });
  const body = await res.json();

  if (!res.ok) {
    // Cloudinary's own file-size-limit error has a stable, recognizable
    // shape: "File size too large. Got <bytes>. Maximum is <bytes>." —
    // surfaced as-is by the caller, same as the original SDK-based version.
    const err = new Error(body?.error?.message || `Cloudinary upload failed (${res.status})`);
    throw err;
  }

  return { secure_url: body.secure_url, public_id: body.public_id };
}

// Used by adminResourceController.js's permanentlyDeleteResource. Treats
// "not found" (the file was somehow already gone from Cloudinary) as
// success rather than an error — the goal is the file no longer existing,
// which is already true either way, so the D1 cleanup that follows this
// call shouldn't be blocked by it.
// resourceType defaults to "raw" since that's what the main file always
// uploads as (see uploadToCloudinary above) — pass "image" for a legacy
// preview-image asset, which lives under a different destroy endpoint.
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
