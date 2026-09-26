const axios = require("axios");

const paystackAPI = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY || ""}`,
    "Content-Type": "application/json",
  },
});

async function initializeTransaction({ email, amountNaira, reference, callbackUrl }) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.log(`[Paystack Demo] Initialized transaction for ${email}: ₦${amountNaira} (ref: ${reference})`);
    const separator = callbackUrl.includes("?") ? "&" : "?";
    return {
      authorization_url: `${callbackUrl}${separator}reference=${encodeURIComponent(reference)}&trxref=${encodeURIComponent(reference)}`,
      reference,
      access_code: `demo_${Date.now()}`,
    };
  }

  const response = await paystackAPI.post("/transaction/initialize", {
    email,
    amount: amountNaira * 100, // Paystack expects kobo
    reference,
    callback_url: callbackUrl,
  });
  return response.data.data; // contains authorization_url, access_code, reference
}

async function verifyTransaction(reference) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.log(`[Paystack Demo] Verified transaction: ${reference}`);
    return {
      status: "success",
      reference,
      gateway_response: "Successful (Demo)",
    };
  }

  const response = await paystackAPI.get(`/transaction/verify/${reference}`);
  return response.data.data; // contains status, amount, reference, etc.
}

module.exports = { initializeTransaction, verifyTransaction };
