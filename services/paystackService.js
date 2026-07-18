const axios = require("axios");

const paystackAPI = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

async function initializeTransaction({ email, amountNaira, reference, callbackUrl }) {
  const response = await paystackAPI.post("/transaction/initialize", {
    email,
    amount: amountNaira * 100, // Paystack expects kobo
    reference,
    callback_url: callbackUrl,
  });
  return response.data.data; // contains authorization_url, access_code, reference
}

async function verifyTransaction(reference) {
  const response = await paystackAPI.get(`/transaction/verify/${reference}`);
  return response.data.data; // contains status, amount, reference, etc.
}

module.exports = { initializeTransaction, verifyTransaction };