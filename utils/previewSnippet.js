const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const path = require("path");

// pdf-parse was completely rewritten at v2: the old function-style API
// (`pdf(buffer).then(...)`) and the debug-mode bug that motivated a deep
// require("pdf-parse/lib/pdf-parse.js") workaround are both gone — that
// subpath doesn't even exist anymore (v2's package.json restricts its
// "exports" map to the public API), so the old workaround throws
// ERR_PACKAGE_PATH_NOT_EXPORTED instead. The current API is class-based:
// `const { PDFParse } = require("pdf-parse")`.
//
// This require is wrapped in try/catch deliberately. A plain top-level
// `require(...)` failure here previously crashed the ENTIRE server on
// boot — not just PDF preview — since this file is pulled in by
// resourceController.js and moderationController.js, which app.js needs
// to even start. If pdf-parse ever fails to load again (a future major
// version bump, a missing native dependency, whatever), PDF preview
// should just degrade to "not available", the same as it does for a
// scanned PDF with no text layer — the rest of the site has to keep
// running either way.
let PDFParse = null;
try {
  ({ PDFParse } = require("pdf-parse"));
} catch (err) {
  console.error(
    "pdf-parse failed to load — PDF text preview/extraction will be unavailable:",
    err.message
  );
}

// Matches utils/pageCounter.js's WORDS_PER_PAGE — "page 1" for a DOCX is
// approximated as its first 500 words, since DOCX has no real page
// boundaries until it's actually paginated by a renderer.
const WORDS_PER_PAGE = 500;
// Hard character cap, applied after the word-based half-page cut, purely as
// a safety net against a single absurdly long "word" (e.g. no whitespace).
const MAX_SNIPPET_CHARS = 1000;

const NO_PREVIEW_MESSAGE = "A text preview isn't available for this file type.";

// Runs a PDFParse extraction and always tears the parser down afterwards
// (it holds pdf.js worker resources) whether extraction succeeded or not.
// `pageNumbers`, when given, limits extraction to those 1-indexed pages —
// used for the student "page 1 only" preview so we're not parsing an
// entire document just to throw most of it away.
async function extractPdfText(fileBuffer, pageNumbers) {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const result = await parser.getText(pageNumbers ? { partial: pageNumbers } : undefined);
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

// Student-facing preview: half of page 1 only, for DOCX/PPTX/PDF. Anything
// else (e.g. ZIP) falls through to the "not available" branch below, since
// there's no text extractor for it.
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
        return { available: false, message: NO_PREVIEW_MESSAGE };
      }
      const halfLength = Math.ceil(slideText.length / 2);
      return { available: true, snippet: capChars(slideText.slice(0, halfLength)) };
    }

    if (ext === ".pdf") {
      if (!PDFParse) return { available: false, message: NO_PREVIEW_MESSAGE };

      // Real page boundaries, unlike the word-count approximation DOCX
      // needs — [1] extracts only page 1's text rather than parsing the
      // whole document just to discard most of it.
      const text = await extractPdfText(fileBuffer, [1]);
      const page1Words = text.trim().split(/\s+/).filter(Boolean);
      if (page1Words.length === 0) {
        // Most likely a scanned/image-only PDF with no extractable text layer.
        return { available: false, message: NO_PREVIEW_MESSAGE };
      }
      const halfPageWords = page1Words.slice(0, Math.ceil(page1Words.length / 2));
      return { available: true, snippet: capChars(halfPageWords.join(" ")) };
    }

    return { available: false, message: NO_PREVIEW_MESSAGE };
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

    if (ext === ".pdf") {
      if (!PDFParse) return { available: false, message: NO_PREVIEW_MESSAGE };

      // No page restriction here — admin review gets the whole document,
      // same as DOCX/PPTX above.
      const text = await extractPdfText(fileBuffer);
      const fullText = text.replace(/\s+/g, " ").trim();
      if (!fullText) {
        return { available: false, message: NO_PREVIEW_MESSAGE };
      }
      return { available: true, fullText };
    }

    return { available: false, message: NO_PREVIEW_MESSAGE };
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
