const express = require("express");
const router = express.Router();

const { getTransactionSummary, getTransactions } = require("../controllers/adminTransactionController");
const { protect, restrictTo } = require("../middleware/protect");

// Every route below requires a logged-in admin
router.use(protect, restrictTo("admin"));

router.get("/transactions/summary", getTransactionSummary);
router.get("/transactions", getTransactions);

module.exports = router;