const express = require("express");
const router = express.Router();

const {
  uploadResource, getResources, getMyUploads, getResourceById, downloadResource,
} = require("../controllers/resourceController");
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

// "/my-uploads" must be registered before the "/:id" catch-all below,
// otherwise Express would treat "my-uploads" as an :id value.
router.get("/my-uploads", protect, getMyUploads);

router.get("/", protect, getResources);
router.get("/:id/preview", protect, getResourcePreview);
router.get("/:id/download", protect, downloadResource);
router.get("/:id", protect, getResourceById);

module.exports = router;