const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const allowedExtensions = [".pdf", ".docx", ".pptx", ".zip", ".jpg", ".jpeg", ".png"];

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error("Unsupported file type. Allowed: PDF, DOCX, PPTX, ZIP, JPG, PNG"), false);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — kept comfortably under Cloudinary's free-tier 10MB per-file cap (see errorHandler.js and resourceController.js for what happens if that's ever exceeded anyway). Raise this back to 20MB once/if the Cloudinary account is upgraded to a plan that accepts larger files.
});

module.exports = upload;