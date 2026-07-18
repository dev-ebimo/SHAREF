const express = require("express");
const router = express.Router();

const {
  getBalance, initializeFunding, verifyFunding, chargeForDownload,
} = require("../controllers/walletController");
const { protect } = require("../middleware/protect");

router.get("/balance", protect, getBalance);
router.post("/fund/initialize", protect, initializeFunding);
router.get("/fund/verify/:reference", protect, verifyFunding);
router.post("/charge", protect, chargeForDownload);

module.exports = router;