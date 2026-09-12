const mongoose = require("mongoose");

// A snapshot taken at the moment a student deletes their own account —
// see deleteMyAccount in userSettingsController.js. By the time an admin
// looks at this, the actual User document is gone, so anything here has
// to be captured up front rather than referenced by id.
const deletedAccountLogSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    matricNumber: { type: String, default: "" },
    university: { type: String, default: "" },
    department: { type: String, default: "" },
    level: { type: String, default: "" },
    accountStatus: { type: String, default: "active" }, // was this account suspended at the time of deletion?
    joinedAt: { type: Date }, // the User document's original createdAt
    walletBalanceAtDeletion: { type: Number, default: 0 },
    uploadsCount: { type: Number, default: 0 },
    totalDeposited: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
  },
  { timestamps: true } // createdAt here doubles as "deletedAt"
);

module.exports = mongoose.model("DeletedAccountLog", deletedAccountLogSchema);
