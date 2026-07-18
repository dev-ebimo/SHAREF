const express = require("express");
const router = express.Router();

const {
  getMyNotifications, toggleMyNotificationRead, markAllMyNotificationsRead,
} = require("../controllers/studentNotificationController");
const { protect } = require("../middleware/protect");

router.use(protect);

router.get("/mine", getMyNotifications);
router.patch("/mine/mark-all-read", markAllMyNotificationsRead);
router.patch("/mine/:id/toggle-read", toggleMyNotificationRead);

module.exports = router;