const express = require("express");
const router = express.Router();

const { createAnnouncement, getAnnouncements } = require("../controllers/announcementController");
const { protect, restrictTo } = require("../middleware/protect");

router.use(protect, restrictTo("admin"));

router.post("/", createAnnouncement);
router.get("/", getAnnouncements);

module.exports = router;