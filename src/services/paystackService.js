const PAYSTACK_BASE_URL = "https://api.paystack.co";

async function paystackRequest(env, path, { method = "GET", body } = {}) {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok || json.status === false) {
    throw new Error(json?.message || `Paystack request failed (${res.status})`);
  }
  return json.data; // e.g. authorization_url/access_code/reference, or status/amount/reference
}

export async function initializeTransaction(env, { email, amountNaira, reference, callbackUrl }) {
  return paystackRequest(env, "/transaction/initialize", {
    method: "POST",
    body: {
      email,
      amount: amountNaira * 100, // Paystack expects kobo
      reference,
      callback_url: callbackUrl,
    },
  });
}

export async function verifyTransaction(env, reference) {
  return paystackRequest(env, `/transaction/verify/${reference}`);
}
