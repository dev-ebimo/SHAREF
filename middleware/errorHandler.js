const multer = require("multer");
const sanitizeError = require("../utils/sanitizeError");

function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: "File too large. Max size is 20MB." });
    }
    return res.status(400).json({ success: false, message: err.message });
  }

  if (err) {
    return res.status(400).json({ 
        success: false,
        message: err.message || "Something went wrong",
        error: sanitizeError(err)
    });
  }

  next();
}

module.exports = errorHandler;