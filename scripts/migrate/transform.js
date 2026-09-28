// Pure functions only — no MongoDB connection, no file I/O, no D1 access.
// Kept separate from export.js specifically so every one of these can be
// unit-tested against synthetic documents without needing a real database
// on either end. export.js is the thin I/O layer that calls these.

const DEFAULT_PREFERENCES = {
  landingPage: "dashboard",
  moderation: {
    landingPage: "pending",
    itemsPerPage: 25,
    autoOpenNext: true,
    confirmBeforeApproval: false,
    confirmBeforeRejection: true,
  },
  review: { defaultSort: "oldest" },
  notifications: {
    uploadStatus: { email: true, inApp: true },
    announcements: { email: true, inApp: true },
  },
};

// Plain-object recursive merge (not the request-facing deepMerge in
// userSettingsController.js — this only ever runs against our own
// DEFAULT_PREFERENCES as the base, never against attacker input, so the
// prototype-pollution guard that function needs doesn't apply here).
function mergeDefaults(base, override) {
  const result = { ...base };
  for (const key in override) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
    const value = override[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeDefaults(base[key] || {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// THE reason this migration script exists as carefully-tested code rather
// than a quick one-off: Mongoose applies schema defaults at READ time,
// inside the application layer. A raw MongoDB driver query (used here,
// deliberately, instead of pulling Mongoose into a one-time migration
// script) returns exactly what's actually stored in the document — if an
// old user's `preferences` subdocument was only ever partially set (or
// never set at all, for accounts created before some preference was
// added to the schema), the fields Mongoose would have silently defaulted
// in the live app come back completely missing here. Without this
// function, those users would migrate with a broken/incomplete
// preferences object — exactly the class of bug the defensive `??`
// fallback in src/controllers/authController.js's login handler exists to
// protect against, except here it's fixed permanently at migration time
// instead of papered over on every login.
function normalizePreferences(rawPreferences) {
  return mergeDefaults(DEFAULT_PREFERENCES, rawPreferences || {});
}

function toIsoOrNull(date) {
  return date ? new Date(date).toISOString() : null;
}
function toIdOrNull(id) {
  return id ? id.toString() : null;
}
function toBoolInt(value) {
  return value ? 1 : 0;
}

export function transformUser(doc) {
  return {
    id: doc._id.toString(),
    full_name: doc.fullName,
    email: doc.email,
    password: doc.password,
    matric_number: doc.matricNumber || null,
    university: doc.university || null,
    faculty: doc.faculty || null,
    department: doc.department || null,
    level: doc.level || null,
    gender: doc.gender || null,
    community_survey: doc.communitySurvey || "",
    role: doc.role || "student",
    wallet_balance: doc.walletBalance || 0,
    account_status: doc.accountStatus || "active",
    last_login_at: toIsoOrNull(doc.lastLoginAt),
    suspension_reason: doc.suspensionReason || "",
    suspended_at: toIsoOrNull(doc.suspendedAt),
    is_verified: toBoolInt(doc.isVerified),
    // Deliberately NOT carried forward — see migrate/README.md's "OTP
    // fields are cleared" section for why. Any in-flight verification or
    // password-reset flow at the exact moment of migration will need to
    // be re-requested; a one-time, low-stakes disruption traded for not
    // carrying stale unencrypted codes into the new system.
    verification_otp: null,
    verification_otp_expires: null,
    reset_password_otp: null,
    reset_password_otp_expires: null,
    preferences: JSON.stringify(normalizePreferences(doc.preferences)),
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
    updated_at: toIsoOrNull(doc.updatedAt) || new Date().toISOString(),
  };
}

export function transformResource(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    type: doc.type,
    department: doc.department,
    course: doc.course,
    level: doc.level,
    semester: doc.semester,
    session: doc.session,
    uploader_id: toIdOrNull(doc.uploader),
    file_name: doc.fileName,
    file_url: doc.fileUrl,
    cloudinary_public_id: doc.cloudinaryPublicId,
    // Passed through as-is, whatever it already was — "image" for
    // legacy uploads, "raw" for everything after the preview-image
    // pipeline was removed (see resourceController.js's uploadResource).
    cloudinary_resource_type: doc.cloudinaryResourceType || "raw",
    preview_image_public_id: doc.previewImagePublicId || null,
    // Also passed through as-is: an already-approved/rejected resource
    // from before the Workers migration already has a real computed
    // previewType ("image"/"text"/"none") and keeps it. Only genuinely
    // NEW uploads after cutover ever start at "pending" — see
    // resourceController.js's uploadResource and the CPU-limit fix it
    // was introduced for.
    preview_type: doc.previewType || "none",
    preview_snippet: doc.previewSnippet || "",
    preview_message: doc.previewMessage || "",
    file_size_bytes: doc.fileSizeBytes,
    file_extension: doc.fileExtension,
    pages: doc.pages || 1,
    status: doc.status || "pending",
    rejection_reason: doc.rejectionReason || "",
    downloads: doc.downloads || 0,
    reviewed_by: toIdOrNull(doc.reviewedBy),
    reviewed_at: toIsoOrNull(doc.reviewedAt),
    description: doc.description || "",
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
    updated_at: toIsoOrNull(doc.updatedAt) || new Date().toISOString(),
  };
}

export function transformTransaction(doc) {
  return {
    id: doc._id.toString(),
    user_id: toIdOrNull(doc.user),
    type: doc.type,
    amount: doc.amount,
    status: doc.status || "pending",
    reference: doc.reference || null,
    resource_id: toIdOrNull(doc.resource),
    description: doc.description || "",
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
    updated_at: toIsoOrNull(doc.updatedAt) || new Date().toISOString(),
  };
}

export function transformAnnouncement(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    message: doc.message,
    target_departments: JSON.stringify(doc.targetDepartments || []),
    target_levels: JSON.stringify(doc.targetLevels || []),
    created_by: toIdOrNull(doc.createdBy),
    recipient_count: doc.recipientCount || 0,
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
    updated_at: toIsoOrNull(doc.updatedAt) || new Date().toISOString(),
  };
}

export function transformDeletedAccountLog(doc) {
  return {
    id: doc._id.toString(),
    full_name: doc.fullName,
    email: doc.email,
    matric_number: doc.matricNumber || "",
    university: doc.university || "",
    department: doc.department || "",
    level: doc.level || "",
    account_status: doc.accountStatus || "active",
    joined_at: toIsoOrNull(doc.joinedAt),
    wallet_balance_at_deletion: doc.walletBalanceAtDeletion || 0,
    uploads_count: doc.uploadsCount || 0,
    total_deposited: doc.totalDeposited || 0,
    total_spent: doc.totalSpent || 0,
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
  };
}

export function transformNotification(doc) {
  return {
    id: doc._id.toString(),
    resource_id: toIdOrNull(doc.resource),
    announcement_id: toIdOrNull(doc.announcement),
    deleted_account_log_id: toIdOrNull(doc.deletedAccountLog),
    recipient_id: toIdOrNull(doc.recipient),
    type: doc.type || "new_upload",
    unread: toBoolInt(doc.unread ?? true),
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
    updated_at: toIsoOrNull(doc.updatedAt) || new Date().toISOString(),
  };
}

export function transformBookmark(doc) {
  return {
    id: doc._id.toString(),
    user_id: toIdOrNull(doc.user),
    resource_id: toIdOrNull(doc.resource),
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
    updated_at: toIsoOrNull(doc.updatedAt) || new Date().toISOString(),
  };
}

export function transformDownloadLog(doc) {
  return {
    id: doc._id.toString(),
    user_id: toIdOrNull(doc.user),
    resource_id: toIdOrNull(doc.resource),
    created_at: toIsoOrNull(doc.createdAt) || new Date().toISOString(),
    updated_at: toIsoOrNull(doc.updatedAt) || new Date().toISOString(),
  };
}

export { normalizePreferences, DEFAULT_PREFERENCES };
