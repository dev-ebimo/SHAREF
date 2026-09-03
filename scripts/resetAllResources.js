// One-time cleanup script — run this ONLY after deliberately deleting all
// files from Cloudinary, to remove the now-orphaned database records that
// reference them (Resources, Bookmarks, DownloadLogs, and any
// Notifications tied to a resource or resource-upload event).
//
// This does NOT touch Cloudinary — it only cleans up MongoDB. It's safe to
// run because it defaults to a dry run: it prints what it WOULD delete and
// exits. Nothing is actually deleted until you pass --confirm.
//
// Usage (from the project root, wherever your .env / MONGO_URI live):
//   node scripts/resetAllResources.js           -> dry run, no changes made
//   node scripts/resetAllResources.js --confirm -> actually deletes

require("dotenv").config();
const mongoose = require("mongoose");

const Resource = require("../models/Resource");
const Bookmark = require("../models/Bookmark");
const DownloadLog = require("../models/DownloadLog");
const Notification = require("../models/Notification");

const RESOURCE_NOTIFICATION_TYPES = ["resource_uploaded", "resource_approved", "resource_rejected"];

async function main() {
  const isConfirmed = process.argv.includes("--confirm");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set. Run this from an environment where your .env is loaded.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB: ${mongoose.connection.host}`);

  const resourceCount = await Resource.countDocuments({});
  const bookmarkCount = await Bookmark.countDocuments({});
  const downloadLogCount = await DownloadLog.countDocuments({});
  const notificationCount = await Notification.countDocuments({
    $or: [{ resource: { $ne: null } }, { type: { $in: RESOURCE_NOTIFICATION_TYPES } }],
  });

  console.log("\nThis will permanently delete:");
  console.log(`  Resources:                     ${resourceCount}`);
  console.log(`  Bookmarks (reference resources): ${bookmarkCount}`);
  console.log(`  Download logs:                 ${downloadLogCount}`);
  console.log(`  Resource-related notifications: ${notificationCount}`);
  console.log("\nUser accounts, wallet balances/transactions, and announcements are NOT touched.\n");

  if (!isConfirmed) {
    console.log("Dry run only — nothing was deleted. Re-run with --confirm to actually delete these records.");
    await mongoose.disconnect();
    return;
  }

  const resourceResult = await Resource.deleteMany({});
  const bookmarkResult = await Bookmark.deleteMany({});
  const downloadLogResult = await DownloadLog.deleteMany({});
  const notificationResult = await Notification.deleteMany({
    $or: [{ resource: { $ne: null } }, { type: { $in: RESOURCE_NOTIFICATION_TYPES } }],
  });

  console.log("Done. Deleted:");
  console.log(`  Resources:                     ${resourceResult.deletedCount}`);
  console.log(`  Bookmarks:                     ${bookmarkResult.deletedCount}`);
  console.log(`  Download logs:                 ${downloadLogResult.deletedCount}`);
  console.log(`  Resource-related notifications: ${notificationResult.deletedCount}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
