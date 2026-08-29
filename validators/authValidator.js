const { body } = require("express-validator");

const registerValidator = [
  body("fullName").trim().notEmpty().withMessage("Full name is required"),

  body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Please enter a valid email address")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("Password is required")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),

  body("matricNumber").optional({ checkFalsy: true }).trim(),

  body("university").optional({ checkFalsy: true }).trim(),

  body("faculty").optional({ checkFalsy: true }).trim(),

  body("department").optional({ checkFalsy: true }).trim(),

  body("level")
    .optional({ checkFalsy: true })
    .isIn(["100", "200", "300", "400", "500", "600"])
    .withMessage("Please select a valid level"),

  body("gender")
    .optional({ checkFalsy: true })
    .isIn(["Male", "Female", "Other"])
    .withMessage("Please select a valid gender"),

  body("communitySurvey").optional().trim(),
];

const loginValidator = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Please enter a valid email address")
    .normalizeEmail(),

  body("password").notEmpty().withMessage("Password is required"),
];

const otpValidator = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Please enter a valid email address")
    .normalizeEmail(),

  body("otp")
    .trim()
    .notEmpty().withMessage("OTP is required")
    .isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 digits"),
];
const forgotPasswordValidator = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Please enter a valid email address")
    .normalizeEmail(),
];

const resetPasswordValidator = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Please enter a valid email address")
    .normalizeEmail(),

  body("otp")
    .trim()
    .notEmpty().withMessage("OTP is required")
    .isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 digits"),

  body("newPassword")
    .notEmpty().withMessage("New password is required")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
];

module.exports = {
  registerValidator, loginValidator, otpValidator,
  forgotPasswordValidator, resetPasswordValidator,
};