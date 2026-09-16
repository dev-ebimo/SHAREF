const mongoose = require("mongoose");

const downloadLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: "Resource", required: true },
  },
  { timestamps: true } // createdAt is what trending/continue-learning will query against
);

// "Continue learning" reads a user's recent downloads; the trending
// aggregation matches on createdAt + resource.
downloadLogSchema.index({ user: 1, createdAt: -1 });
downloadLogSchema.index({ user: 1, resource: 1 });
downloadLogSchema.index({ createdAt: -1, resource: 1 });

module.exports = mongoose.model("DownloadLog", downloadLogSchema);