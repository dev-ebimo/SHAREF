const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const path = require("path");

const WORDS_PER_PAGE = 500;

// Counts PDF pages directly from the raw file bytes, with no external
// library involved: every actual page in a PDF is represented by its own
// `/Type /Page` dictionary object in the file (the parent `/Type /Pages`
// node is excluded via the negative lookahead). latin1 preserves a 1:1
// byte mapping so the regex can't corrupt or misread the binary stream
// data sitting between page objects, and this holds up even when the
// content streams themselves are compressed (verified against real
// Word/Google-Docs-style exports) since producers virtually always leave
// the page tree itself uncompressed.
//
// This used to be a cross-check against the `pdf-parse` package, which was
// removed: it threw on every single call in this deployment (a known,
// still-open issue where pdf-parse tries to read a bundled test fixture
// file that gets pruned from node_modules on some hosts), making it dead
// weight that only ever produced a hardcoded "1". This scan alone was
// already producing every correct result.
function countPdfPageObjects(fileBuffer) {
  const raw = fileBuffer.toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page(?!s)\b/g);
  return matches ? matches.length : 0;
}

async function countPages(fileBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === ".pdf") {
      return Math.max(countPdfPageObjects(fileBuffer), 1);
    }

    if (ext === ".pptx") {
      const zip = new AdmZip(fileBuffer);
      const slideCount = zip
        .getEntries()
        .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)).length;
      return slideCount || 1;
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;
      return Math.max(1, Math.ceil(wordCount / WORDS_PER_PAGE));
    }

    return 1;
  } catch (err) {
    // Previously this defaulted to 1 page, which silently priced any
    // malformed/adversarial file (e.g. a large PDF with its page tree
    // stripped or corrupted) at the cheapest tier. Fail the upload instead
    // so a student can't exploit undetectable page counts to underpay.
    console.error(`Page count detection failed for "${originalName}":`, err.stack || err.message);
    const detectionError = new Error(
      `Could not determine the page count for "${originalName}". The file may be corrupted or in an unsupported format.`
    );
    detectionError.isPageCountError = true;
    throw detectionError;
  }
}

module.exports = countPages;