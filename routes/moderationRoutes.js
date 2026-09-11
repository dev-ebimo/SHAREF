const express = require("express");
const router = express.Router();

const {
  getModerationQueue, approveResource, rejectResource, getResourcePreviewForAdmin, getPendingCount,
} = require("../controllers/moderationController");
const { protect, restrictTo } = require("../middleware/protect");

router.use(protect, restrictTo("admin"));

router.get("/queue", getModerationQueue);
router.get("/pending-count", getPendingCount);
router.get("/:id/preview", getResourcePreviewForAdmin);
router.post("/:id/approve", approveResource);
router.post("/:id/reject", rejectResource);

module.exports = router;