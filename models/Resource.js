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
    // The type the main file was uploaded with. This is "raw" for every
    // file, including PDFs — Cloudinary blocks serving the untransformed
    // original file through the "image" resource type by default (a
    // security measure against arbitrary user-uploaded PDFs), which broke
    // downloads and the admin full-document preview when PDFs briefly used
    // "image" here. Kept as a field (rather than hardcoded) so destroy
    // calls stay correct if this ever changes again.
    cloudinaryResourceType: { type: String, enum: ["raw", "image"], default: "raw" },
    // A SEPARATE Cloudinary asset (image resource type), PDFs only, that
    // exists purely so Cloudinary's pg_1 page-to-image transformation can
    // run on it. Its untransformed URL is never exposed anywhere in the
    // app — only ever requested with a page+crop+format transformation
    // attached, which Cloudinary always allows (it's a real converted
    // image, not raw PDF passthrough). Null for non-PDF resources.
    previewImagePublicId: { type: String, default: null },
    // "image"  -> PDF; student preview is a cropped top-half-of-page-1 image
    // "text"   -> DOCX/PPTX; student preview is half of page 1's extracted text
    // "none"   -> extraction failed or unsupported type; previewMessage explains why
    previewType: { type: String, enum: ["image", "text", "none"], default: "none" },
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