const express = require("express");
const router = express.Router();

const { uploadResource, getMyUploads, getResources, getResourceById } = require("../controllers/resourceController");
const {
  getRecentFeed, getTrending, getContinueLearning, searchPastQuestions, getResourcePreview,
} = require("../controllers/browseController");
const { streamResourceDownload } = require("../controllers/downloadController");
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
router.get("/my-uploads", protect, getMyUploads);
router.get("/:id/preview", protect, getResourcePreview);
// Deliberately no `protect` here — this is reached by a plain browser
// navigation, not an authenticated fetch, so it can't carry the normal
// Authorization header. Access is instead controlled by the short-lived
// signed token in the query string — see utils/downloadToken.js.
router.get("/:id/stream", streamResourceDownload);
router.get("/", protect, getResources);
router.get("/:id", protect, getResourceById);

module.exports = router;