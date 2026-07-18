const mongoose = require("mongoose");

const downloadLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: "Resource", required: true },
  },
  { timestamps: true } // createdAt is what trending/continue-learning will query against
);

module.exports = mongoose.model("DownloadLog", downloadLogSchema);