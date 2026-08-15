const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false, // never returned in queries by default
    },
    matricNumber: {
      type: String,
      required: [true, "Matric number is required"],
      unique: true,
      trim: true,
    },
    university: {
      type: String,
      required: [true, "University is required"],
      trim: true,
    },
    faculty: {
      type: String,
      required: [true, "Faculty is required"],
      trim: true,
    },
    department: {
      type: String,
      required: [true, "Department is required"],
      trim: true,
    },
    level: {
      type: String,
      required: [true, "Level is required"],
      enum: ["100", "200", "300", "400", "500", "600"],
    },
    gender: {
      type: String,
      required: [true, "Gender is required"],
      enum: ["Male", "Female", "Other"],
    },
    communitySurvey: {
      type: String,
      trim: true,
      default: "",
    },
    role: {
      type: String,
      enum: ["student", "admin"],
      default: "student",
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "inactive"],
      default: "active",
    },
    lastLoginAt: { type: Date },
    suspensionReason: { type: String, default: "" },
    suspendedAt: { type: Date },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationOTP: {
      type: String,
      select: false,
    },
    verificationOTPExpires: {
      type: Date,
      select: false,
    },
    resetPasswordOTP: {
      type: String,
      select: false,
    },
    resetPasswordOTPExpires: {
      type: Date,
      select: false,
    },
    preferences: {
      landingPage: {
        type: String,
        enum: ["dashboard", "resources", "bookmarks"],
        default: "dashboard",
      },
      moderation: {
        landingPage: {
          type: String,
          enum: ["dashboard", "pending", "approved"],
          default: "pending",
        },
        itemsPerPage: { type: Number, enum: [10, 25, 50], default: 25 },
        autoOpenNext: { type: Boolean, default: true },
        confirmBeforeApproval: { type: Boolean, default: false },
        confirmBeforeRejection: { type: Boolean, default: true },
      },
      review: {
        previewTab: { type: String, enum: ["same", "new"], default: "new" },
        defaultSort: {
          type: String,
          enum: ["oldest", "newest"],
          default: "oldest",
        },
      },
      notifications: {
        newResources: {
          email: { type: Boolean, default: true },
          inApp: { type: Boolean, default: true },
        },
        uploadStatus: {
          email: { type: Boolean, default: true },
          inApp: { type: Boolean, default: true },
        },
        discussionReplies: {
          email: { type: Boolean, default: false },
          inApp: { type: Boolean, default: true },
        },
        pendingUploads: {
          email: { type: Boolean, default: true },
          inApp: { type: Boolean, default: true },
        },
        rejectedResources: {
          email: { type: Boolean, default: false },
          inApp: { type: Boolean, default: true },
        },
        announcements: {
          email: { type: Boolean, default: true },
          inApp: { type: Boolean, default: true },
        },
      },
      privacy: {
        publicProfile: { type: Boolean, default: true },
        showStats: { type: Boolean, default: true },
      },
    },
  },
  { timestamps: true },
);

// Hash password before saving, only if it was modified
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});
// Instance method to compare entered password with the hashed one
userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
