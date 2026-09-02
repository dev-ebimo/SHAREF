const mongoose = require("mongoose");

const resourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["Lecture Note", "Past Question", "Assignment Material", "Textbook", "Revision Sheet", "Other"],
    },
    department: { type: String, required: true, trim: true },
    course: { type: String, required: true, trim: true },
    level: { type: String, required: true, enum: ["100", "200", "300", "400", "500", "600"] },
    semester: { type: String, required: true, enum: ["First", "Second"] },
    session: { type: String, required: true, trim: true }, // e.g. "2024/2025"

    uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    fileName: { type: String, required: true },
    
    fileUrl: { type: String, required: true },
    cloudinaryPublicId: { type: String, required: true },
    previewAvailable: { type: Boolean, default: false },
    previewSnippet: { type: String, default: "" },
    previewMessage: { type: String, default: "" },

    fileSizeBytes: { type: Number, required: true },
    fileExtension: { type: String, required: true },
    pages: { type: Number, required: true, default: 1 },

    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    rejectionReason: { type: String, default: "" },

    downloads: { type: Number, default: 0 },
    
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    description: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Resource", resourceSchema);