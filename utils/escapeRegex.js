// Escapes all special regular expression characters in a string to prevent
// ReDoS (Regular Expression Denial of Service) and regex syntax injection attacks.
function escapeRegex(text) {
  if (typeof text !== "string") return "";
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = escapeRegex;
