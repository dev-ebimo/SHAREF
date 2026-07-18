const express = require("express");
const router = express.Router();

const { getTransactionSummary, getTransactions } = require("../controllers/adminTransactionController");
const { protect, restrictTo } = require("../middleware/protect");

// Every route below requires a logged-in admin.
// This router is mounted at /api/admin/transactions (see app.js) rather than
// the broad /api/admin prefix, so this middleware only runs for requests
// this router actually handles instead of running for every /api/admin/*
// request before falling through to the correct sibling router.
router.use(protect, restrictTo("admin"));

router.get("/summary", getTransactionSummary);
router.get("/", getTransactions);

module.exports = router;