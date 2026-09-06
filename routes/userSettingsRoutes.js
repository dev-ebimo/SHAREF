const express = require("express");
const router = express.Router();

const {
  getMyProfile, updateMyProfile, updateMyPreferences, changeMyPassword, deleteMyAccount,
} = require("../controllers/userSettingsController");
const {
  updateProfileValidator, changePasswordValidator, deleteAccountValidator,
} = require("../validators/userValidator");
const validateRequest = require("../middleware/validateRequest");
const { protect } = require("../middleware/protect");

router.use(protect);

router.get("/me", getMyProfile);
router.patch("/me", updateProfileValidator, validateRequest, updateMyProfile);
router.patch("/me/preferences", updateMyPreferences);
router.patch("/me/password", changePasswordValidator, validateRequest, changeMyPassword);
router.delete("/me", deleteAccountValidator, validateRequest, deleteMyAccount);

module.exports = router;