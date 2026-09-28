import { Hono } from "hono";
import { getMyProfile, updateMyProfile, updateMyPreferences, changeMyPassword, deleteMyAccount } from "../controllers/userSettingsController.js";
import { validateUpdateProfile, validateChangePassword, validateDeleteAccount } from "../validators/userValidators.js";
import { protect } from "../middleware/protect.js";

const userSettingsRoutes = new Hono();

userSettingsRoutes.use("*", protect);

userSettingsRoutes.get("/me", getMyProfile);
userSettingsRoutes.patch("/me", validateUpdateProfile, updateMyProfile);
userSettingsRoutes.patch("/me/preferences", updateMyPreferences);
userSettingsRoutes.patch("/me/password", validateChangePassword, changeMyPassword);
userSettingsRoutes.delete("/me", validateDeleteAccount, deleteMyAccount);

export default userSettingsRoutes;
