const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["deposit", "purchase"], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["pending", "successful", "failed"], default: "pending" },

    // Only set for deposits — Paystack's unique transaction reference
    reference: { type: String, unique: true, sparse: true },

    // Only set for purchases — links the charge to the resource it paid for
    resource: { type: mongoose.Schema.Types.ObjectId, ref: "Resource" },

    description: { type: String, default: "" },
  },
  { timestamps: true }
);

// `reference` already has a unique sparse index from the field definition.
// These cover the per-user lookups: the wallet history list, the
// already-purchased check in chargeForDownload, and the deposited/spent
// aggregations on the admin user profile.
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ user: 1, type: 1, status: 1 });

module.exports = mongoose.model("Transaction", transactionSchema);