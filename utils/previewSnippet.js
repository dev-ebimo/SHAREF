const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const path = require("path");

// Matches utils/pageCounter.js's WORDS_PER_PAGE — "page 1" for a DOCX is
// approximated as its first 500 words, since DOCX has no real page
// boundaries until it's actually paginated by a renderer.
const WORDS_PER_PAGE = 500;
// Hard character cap, applied after the word-based half-page cut, purely as
// a safety net against a single absurdly long "word" (e.g. no whitespace).
const MAX_SNIPPET_CHARS = 1000;

// Student-facing preview: half of page 1 only, for DOCX/PPTX. PDFs are
// handled separately via Cloudinary's image transformation (see
// utils/cloudinaryPreview.js) and never reach this function.
async function getPreviewSnippet(fileBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      const firstPageWords = result.value.trim().split(/\s+/).filter(Boolean).slice(0, WORDS_PER_PAGE);
      const halfPageWords = firstPageWords.slice(0, Math.ceil(firstPageWords.length / 2));
      return { available: true, snippet: capChars(halfPageWords.join(" ")) };
    }

    if (ext === ".pptx") {
      const slideText = extractSlideText(fileBuffer, 1);
      if (!slideText) {
        return { available: false, message: "A text preview isn't available for this file type." };
      }
      const halfLength = Math.ceil(slideText.length / 2);
      return { available: true, snippet: capChars(slideText.slice(0, halfLength)) };
    }

    return { available: false, message: "A text preview isn't available for this file type." };
  } catch (err) {
    console.error("Preview extraction failed:", err.message);
    return { available: false, message: "Preview could not be generated for this document." };
  }
}

// Admin-facing preview: the complete extracted text, no truncation.
// fileBuffer here is fetched fresh from Cloudinary on demand (nothing is
// stored locally after upload), so this only runs when an admin actually
// opens the preview — not on every moderation-queue load.
async function getFullText(fileBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return { available: true, fullText: result.value.replace(/\s+/g, " ").trim() };
    }

    if (ext === ".pptx") {
      const zip = new AdmZip(fileBuffer);
      const slideEntries = sortedSlideEntries(zip);
      const combined = slideEntries
        .map((entry) => stripXmlTags(entry.getData().toString("utf8")).replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n\n");
      return { available: !!combined, fullText: combined };
    }

    return { available: false, message: "A text preview isn't available for this file type." };
  } catch (err) {
    console.error("Full-text extraction failed:", err.message);
    return { available: false, message: "Preview could not be generated for this document." };
  }
}

function extractSlideText(fileBuffer, slideNumber) {
  const zip = new AdmZip(fileBuffer);
  const slideEntries = sortedSlideEntries(zip);
  const entry = slideEntries[slideNumber - 1];
  if (!entry) return "";
  return stripXmlTags(entry.getData().toString("utf8")).replace(/\s+/g, " ").trim();
}

function sortedSlideEntries(zip) {
  return zip
    .getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/slide(\d+)\.xml/)[1], 10);
      const numB = parseInt(b.entryName.match(/slide(\d+)\.xml/)[1], 10);
      return numA - numB;
    });
}

function capChars(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_SNIPPET_CHARS) return cleaned;
  return cleaned.slice(0, MAX_SNIPPET_CHARS).trim() + "…";
}

function stripXmlTags(xml) {
  return xml.replace(/<[^>]*>/g, " ");
}

module.exports = getPreviewSnippet;
module.exports.getFullText = getFullText;
