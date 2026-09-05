const fs = require("fs");
const { validationResult } = require("express-validator");

// Multer (upload.single/.array/.fields) runs before this middleware on
// routes that accept a file, so by the time we get here the file may
// already be sitting on disk even though the rest of the form is invalid.
// If we don't remove it here, every rejected upload leaks a file.
function cleanupUploadedFiles(req) {
  const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();

  for (const file of files) {
    if (file && file.path) {
      fs.unlink(file.path, (err) => {
        if (err) console.error(`Failed to remove orphaned upload ${file.path}:`, err.message);
      });
    }
  }
}

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    cleanupUploadedFiles(req);
    return res.status(400).json({
      success: false,
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

module.exports = validateRequest;