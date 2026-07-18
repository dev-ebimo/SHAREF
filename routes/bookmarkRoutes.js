const express = require("express");
const router = express.Router();

const { toggleBookmark, getBookmarks, checkBookmark } = require("../controllers/bookmarkController");
const { protect } = require("../middleware/protect");

router.use(protect);

router.get("/", getBookmarks);
router.get("/check/:resourceId", checkBookmark);
router.post("/:resourceId", toggleBookmark);

module.exports = router;