const { body } = require("express-validator");

const updateProfileValidator = [
  body("fullName").optional().trim().notEmpty().withMessage("Full name cannot be empty"),
  body("email").optional().trim().isEmail().withMessage("Please enter a valid email address").normalizeEmail(),
  body("department").optional().trim().notEmpty().withMessage("Department cannot be empty"),
  body("level").optional().isIn(["100", "200", "300", "400", "500", "600"]).withMessage("Please select a valid level"),
];

const changePasswordValidator = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword").isLength({ min: 8 }).withMessage("New password must be at least 8 characters"),
];

const deleteAccountValidator = [
  body("confirmation").equals("DELETE").withMessage('Type "DELETE" exactly to confirm'),
];

module.exports = { updateProfileValidator, changePasswordValidator, deleteAccountValidator };