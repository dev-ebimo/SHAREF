// Escapes user-controlled text before it is interpolated into an HTML email.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// For values used in an email SUBJECT: no CR/LF (header injection), bounded length.
export function singleLine(value, max = 150) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}
