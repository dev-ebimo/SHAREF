const express = require("express");
const router = express.Router();

const { uploadResource } = require("../controllers/resourceController");
const {
  getRecentFeed, getTrending, getContinueLearning, searchPastQuestions, getResourcePreview,
} = require("../controllers/browseController");
const upload = require("../middleware/uploadMiddleware");
const { uploadResourceValidator } = require("../validators/resourceValidator");
const validateRequest = require("../middleware/validateRequest");
const { protect } = require("../middleware/protect");

router.post(
  "/upload",
  protect,
  upload.single("file"),
  uploadResourceValidator,
  validateRequest,
  uploadResource
);

router.get("/recent", protect, getRecentFeed);
router.get("/trending", protect, getTrending);
router.get("/continue-learning", protect, getContinueLearning);
router.get("/past-questions", protect, searchPastQuestions);
router.get("/:id/preview", protect, getResourcePreview);

module.exports = router;