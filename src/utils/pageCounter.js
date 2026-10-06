import AdmZip from "adm-zip";
import mammoth from "mammoth";

const WORDS_PER_PAGE = 500;
const PDF_BYTES_PER_PAGE_FLOOR = 200 * 1024;
const MAX_PDF_PAGES = 1000;

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
// This was already pdf-parse-free before the Workers migration (that
// package threw on every call in the original deployment — a known,
// still-open issue where pdf-parse tries to read a bundled test fixture
// that gets pruned from node_modules on some hosts), so this function
// needed no changes to run on Workers.
function countPdfPageObjects(fileBuffer) {
  const raw = fileBuffer.toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page(?!s)\b/g);
  let pages = matches ? matches.length : 0;

  // The page-tree root declares its total in `/Count N` — take the larger of
  // the two signals, so stripping/hiding individual page objects doesn't
  // lower the number.
  const countRe = /\/Type\s*\/Pages\b[^>]{0,300}?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]{0,300}?\/Type\s*\/Pages\b/g;
  let m;
  while ((m = countRe.exec(raw)) !== null) {
    pages = Math.max(pages, Number(m[1] || m[2]) || 0);
  }

  // PDF 1.5+ can pack page objects inside compressed object streams
  // (/ObjStm), where the regexes above can't see them — which used to price a
  // 60-page document at the 1-page minimum (and lets an uploader hide pages
  // on purpose). Inflating those streams is too CPU-heavy for the Workers
  // free plan (10 ms), so use a conservative size-based FLOOR instead: no
  // more than ~200 KB per page is assumed. It can only raise the count.
  if (/\/Type\s*\/ObjStm/.test(raw)) {
    pages = Math.max(pages, Math.ceil(fileBuffer.length / PDF_BYTES_PER_PAGE_FLOOR));
  }

  // Sanity ceiling: a forged /Count must not produce an absurd price.
  return Math.min(MAX_PDF_PAGES, pages);
}

function extname(fileName) {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i).toLowerCase();
}

export async function countPages(fileBuffer, originalName) {
  const ext = extname(originalName);

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
