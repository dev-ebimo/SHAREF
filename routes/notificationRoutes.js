const express = require("express");
const router = express.Router();

const {
  getNotifications, toggleRead, markAllRead, quickApprove, quickReject,
} = require("../controllers/notificationController");
const { protect, restrictTo } = require("../middleware/protect");

router.use(protect, restrictTo("admin"));

router.get("/", getNotifications);
router.patch("/mark-all-read", markAllRead);
router.patch("/:id/toggle-read", toggleRead);
router.post("/:id/approve", quickApprove);
router.post("/:id/reject", quickReject);

module.exports = router;