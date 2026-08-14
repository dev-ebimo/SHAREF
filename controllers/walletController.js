const crypto = require("crypto");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Resource = require("../models/Resource");
const DownloadLog = require("../models/DownloadLog");
const calculateResourceCost = require("../utils/pricing");

const { initializeTransaction, verifyTransaction } = require("../services/paystackService");

// @route GET /api/wallet/balance
async function getBalance(req, res) {
  try {
    const user = await User.findById(req.user.id);
    return res.status(200).json({ success: true, balance: user.walletBalance });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch balance", error: err.message });
  }
}

// @route POST /api/wallet/fund/initialize
async function initializeFunding(req, res) {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Enter a valid amount" });
    }

    const reference = `SHAREF-${req.user.id}-${Date.now()}`;

    // Log the attempt as pending BEFORE calling Paystack, so the webhook has
    // something to match against even if the user closes the tab mid-payment.
    await Transaction.create({
      user: req.user.id,
      type: "deposit",
      amount,
      status: "pending",
      reference,
      description: "Wallet funding via Paystack",
    });

    const data = await initializeTransaction({
      email: req.user.email,
      amountNaira: amount,
      reference,
      callbackUrl: `${process.env.FRONTEND_URL}/payment-callback`,
    });

    return res.status(200).json({
      success: true,
      authorizationUrl: data.authorization_url,
      reference: data.reference,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not initialize payment", error: err.message });
  }
}

// @route GET /api/wallet/fund/verify/:reference
// Called by the frontend right after Paystack's checkout redirects back —
// this is a convenience for instant UI feedback. The webhook below is the
// real source of truth and will also credit the wallet if this is skipped.
async function verifyFunding(req, res) {
  try {
    const { reference } = req.params;
    const transaction = await Transaction.findOne({ reference });

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    if (transaction.status === "successful") {
      return res.status(200).json({ success: true, message: "Payment already confirmed" });
    }

    const paystackData = await verifyTransaction(reference);

    if (paystackData.status === "success") {
      transaction.status = "successful";
      await transaction.save();

      await User.findByIdAndUpdate(transaction.user, {
        $inc: { walletBalance: transaction.amount },
      });

      return res.status(200).json({ success: true, message: "Wallet funded successfully" });
    }

    transaction.status = "failed";
    await transaction.save();
    return res.status(400).json({ success: false, message: "Payment was not successful" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not verify payment", error: err.message });
  }
}

// @route POST /api/wallet/webhook  (called by Paystack's servers, not the frontend)
async function paystackWebhook(req, res) {
  try {
    const signature = req.headers["x-paystack-signature"];
    const expectedSignature = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(req.body) // raw Buffer — see app.js wiring notes below
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(401).send("Invalid signature");
    }

    const event = JSON.parse(req.body);

    if (event.event === "charge.success") {
      const { reference, amount } = event.data;
      const transaction = await Transaction.findOne({ reference });

      if (transaction && transaction.status !== "successful") {
        transaction.status = "successful";
        await transaction.save();

        await User.findByIdAndUpdate(transaction.user, {
          $inc: { walletBalance: amount / 100 }, // convert kobo back to naira
        });
      }
    }

    return res.status(200).send("Webhook received");
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(500).send("Webhook processing failed");
  }
}

// @route POST /api/wallet/charge  (used by the download flow across all pages)
async function chargeForDownload(req, res) {
  try {
    const { resourceId } = req.body;

    const resource = await Resource.findById(resourceId);
    if (!resource || resource.status !== "approved") {
      return res.status(404).json({ success: false, message: "Resource not available" });
    }

    // Already purchased? Skip the charge entirely — free re-download.
    const existingPurchase = await Transaction.findOne({
      user: req.user.id,
      resource: resourceId,
      type: "purchase",
      status: "successful",
    });

    if (existingPurchase) {
      resource.downloads += 1;
      await resource.save();
      await DownloadLog.create({ user: req.user.id, resource: resourceId });
      return res.status(200).json({ success: true, alreadyOwned: true, fileUrl: resource.fileUrl, message: "Download starting" });
    }

    const cost = calculateResourceCost(resource.pages);
    const user = await User.findById(req.user.id);

    if (user.walletBalance < cost) {
      return res.status(402).json({
        success: false,
        insufficientBalance: true,
        message: "Insufficient wallet balance",
        required: cost,
        currentBalance: user.walletBalance,
      });
    }

    user.walletBalance -= cost;
    await user.save();

    await Transaction.create({
      user: req.user.id,
      type: "purchase",
      amount: cost,
      status: "successful",
      resource: resourceId,
      description: `${resource.course} — ${resource.title}`,
    });

    resource.downloads += 1;
    await resource.save();
    await DownloadLog.create({ user: req.user.id, resource: resourceId });

    return res.status(200).json({
      success: true,
      alreadyOwned: false,
      fileUrl: resource.fileUrl,
      amountCharged: cost,
      newBalance: user.walletBalance,
      message: "Payment successful, download starting",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not process download", error: err.message });
  }
}

module.exports = { getBalance, initializeFunding, verifyFunding, paystackWebhook, chargeForDownload };