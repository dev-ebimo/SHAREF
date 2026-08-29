const User = require("../models/User");
const Resource = require("../models/Resource");
const generateOTP = require("../utils/generateOTP");
const { sendVerificationEmail } = require("../services/emailService");

const OTP_EXPIRY_MINUTES = 10;

function filterPreferencesForRole(preferences, role) {
  const filtered = preferences.toObject ? preferences.toObject() : { ...preferences };
  if (role !== "admin") {
    delete filtered.moderation;
    delete filtered.review;
    if (filtered.notifications) {
      delete filtered.notifications.pendingUploads;
      delete filtered.notifications.rejectedResources;
    }
  }
  return filtered;
}

// @route GET /api/users/me
async function getMyProfile(req, res) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

   const preferences = filterPreferencesForRole(user.preferences, user.role);

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        isVerified: user.isVerified,
        matricNumber: user.matricNumber,
        university: user.university,
        faculty: user.faculty,
        department: user.department,
        level: user.level,
        gender: user.gender,
        role: user.role,
        preferences,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch profile", error: err.message });
  }
}

// @route PATCH /api/users/me
async function updateMyProfile(req, res) {
  try {
    const {
      fullName, email, department, level, university, faculty, matricNumber, gender,
    } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let emailChanged = false;

    if (fullName) user.fullName = fullName;
    if (department) user.department = department;
    if (level) user.level = level;
    if (university) user.university = university;
    if (faculty) user.faculty = faculty;
    if (gender) user.gender = gender;

    if (matricNumber && matricNumber !== user.matricNumber) {
      const existingMatric = await User.findOne({ matricNumber, _id: { $ne: user._id } });
      if (existingMatric) {
        return res.status(409).json({ success: false, message: "That matric number is already registered to another account" });
      }
      user.matricNumber = matricNumber;
    }

    if (email && email !== user.email) {
      const existing = await User.findOne({ email, _id: { $ne: user._id } });
      if (existing) {
        return res.status(409).json({ success: false, message: "That email is already in use" });
      }
      emailChanged = true;
      user.email = email;
      user.isVerified = false;

      const otp = generateOTP();
      user.verificationOTP = otp;
      user.verificationOTPExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
      await sendVerificationEmail(user.email, user.fullName, otp);
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: emailChanged
        ? "Profile updated. Your new email needs verification — check your inbox for a code."
        : "Profile updated successfully",
      emailChanged,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update profile", error: err.message });
  }
}

// @route PATCH /api/users/me/preferences
// Accepts a partial preferences object and deep-merges it, so the frontend
// only needs to send whichever section changed (e.g. just `notifications`).
async function updateMyPreferences(req, res) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const incoming = req.body.preferences || {};

    if (req.user.role !== "admin") {
      delete incoming.moderation;
      delete incoming.review;
      if (incoming.notifications) {
          delete incoming.notifications.pendingUploads;
          delete incoming.notifications.rejectedResources;
      }
    }

    const current = user.preferences.toObject();

    function deepMerge(target, source) {
      for (const key in source) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
          target[key] = deepMerge(target[key] || {}, source[key]);
        } else {
          target[key] = source[key];
        }
      }
      return target;
    }

    user.preferences = deepMerge(current, incoming);
    await user.save();

    const responsePreferences = filterPreferencesForRole(user.preferences, req.user.role);
    return res.status(200).json({ success: true, message: "Preferences saved", preferences: responsePreferences });

  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not save preferences", error: err.message });
  }
}

// @route PATCH /api/users/me/password
async function changeMyPassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select("+password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }

    user.password = newPassword; // pre("save") hook re-hashes this
    await user.save();

    return res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not change password", error: err.message });
  }
}

// @route DELETE /api/users/me
async function deleteMyAccount(req, res) {
  try {
    const cloudinary = require("../config/cloudinary");
    const userResources = await Resource.find({ uploader: req.user.id });

    for (const r of userResources) {
      await cloudinary.uploader.destroy(r.cloudinaryPublicId, { resource_type: "raw" });
    }
    await Resource.deleteMany({ uploader: req.user.id });

    await User.findByIdAndDelete(req.user.id);

    return res.status(200).json({ success: true, message: "Account and all associated data deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not delete account", error: err.message });
  }
}

module.exports = { getMyProfile, updateMyProfile, updateMyPreferences, changeMyPassword, deleteMyAccount };