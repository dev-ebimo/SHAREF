const express = require("express");
const router = express.Router();

const { getUserFilterOptions, getUsers, getUserProfile, suspendUser, reactivateUser } = require("../controllers/adminUserController");
const { protect, restrictTo } = require("../middleware/protect");

router.use(protect, restrictTo("admin"));

router.get("/filter-options", getUserFilterOptions);
router.get("/", getUsers);
router.get("/:id", getUserProfile);
router.post("/:id/suspend", suspendUser);
router.post("/:id/reactivate", reactivateUser);

module.exports = router;