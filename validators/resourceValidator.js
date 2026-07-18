const { body } = require("express-validator");

const uploadResourceValidator = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("type")
    .trim().notEmpty().withMessage("Resource type is required")
    .isIn(["Lecture Note", "Past Question", "Assignment Material", "Textbook", "Revision Sheet", "Other"])
    .withMessage("Please select a valid resource type"),
  body("department").trim().notEmpty().withMessage("Department is required"),
  body("course").trim().notEmpty().withMessage("Course is required"),
  body("level")
    .notEmpty().withMessage("Level is required")
    .isIn(["100", "200", "300", "400", "500", "600"])
    .withMessage("Please select a valid level"),
  body("semester")
    .notEmpty().withMessage("Semester is required")
    .isIn(["First", "Second"])
    .withMessage("Please select a valid semester"),
  body("session").trim().notEmpty().withMessage("Session is required"),
];

module.exports = { uploadResourceValidator };