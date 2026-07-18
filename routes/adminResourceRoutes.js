const express = require("express");
const router = express.Router();

const {
  getFilterOptions, getApprovedResources, getRejectedResources,
  getResourceDetails, removeApprovedResource, restoreToPending, permanentlyDeleteResource,
} = require("../controllers/adminResourceController");
const { protect, restrictTo } = require("../middleware/protect");

router.use(protect, restrictTo("admin"));

router.get("/filter-options", getFilterOptions);
router.get("/approved", getApprovedResources);
router.get("/rejected", getRejectedResources);
router.get("/:id", getResourceDetails);
router.post("/:id/remove", removeApprovedResource);
router.post("/:id/restore", restoreToPending);
router.delete("/:id", permanentlyDeleteResource);

module.exports = router;