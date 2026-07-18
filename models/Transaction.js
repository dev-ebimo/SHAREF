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

module.exports = mongoose.model("Transaction", transactionSchema);