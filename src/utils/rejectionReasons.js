// The ONE list of rejection reasons. Admin screens send and store the CODE; anything a student sees (email,
// My Uploads, Notifications) must show the LABEL. Before this existed the codes ("poor_quality", "wrong_dept")
// leaked straight to students because each screen kept its own copy of the list, or none at all.
export const REJECTION_REASON_LABELS = {
  duplicate: "Duplicate resource",
  wrong_course: "Wrong course code",
  wrong_dept: "Wrong department",
  poor_quality: "Poor quality",
  incomplete: "Incomplete material",
  corrupted: "Corrupted or unreadable file",
  unsupported: "Unsupported file type",
  not_academic: "Not academic material",
  spam: "Spam or irrelevant",
  other: "Other",
};

export const REJECTION_REASONS = Object.keys(REJECTION_REASON_LABELS);

export const isRejectionReason = (code) => typeof code === "string" && Object.prototype.hasOwnProperty.call(REJECTION_REASON_LABELS, code);

// Code -> label. Empty stays empty (the UI then shows no "reason" line). A value that isn't a known code
// (an older free-text reason) is shown as written rather than hidden.
export function rejectionReasonLabel(code) {
  if (!code) return "";
  return isRejectionReason(code) ? REJECTION_REASON_LABELS[code] : String(code);
}
