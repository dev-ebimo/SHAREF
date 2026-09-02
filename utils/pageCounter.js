const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const path = require("path");

const WORDS_PER_PAGE = 500;

// pdf-parse (a thin, largely-unmaintained wrapper around an older pinned
// pdfjs-dist) is known to under-report `numpages` for PDFs whose page tree
// isn't laid out the way it expects — this shows up in practice with some
// Word/Google Docs exports. As a cross-check, independently count `/Type
// /Page` object dictionaries directly in the raw PDF bytes (a standard,
// dependency-free fallback technique) and trust whichever signal is higher.
// latin1 preserves a 1:1 byte mapping so the regex scan can't corrupt or
// misread the binary stream data sitting between the actual page objects.
function countPdfPageObjectsRaw(fileBuffer) {
  const raw = fileBuffer.toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page(?!s)\b/g);
  return matches ? matches.length : 0;
}

async function countPages(fileBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === ".pdf") {
      // The raw-byte scan runs unconditionally, BEFORE we even attempt
      // pdf-parse. If pdf-parse throws outright (as opposed to just
      // under-counting), this is the only signal that still gets computed —
      // it must not live inside the same try/catch as the pdf-parse call,
      // or an exception there skips it entirely and we silently fall back
      // to a flat "1", which is what was happening.
      const rawScanCount = countPdfPageObjectsRaw(fileBuffer);

      let parsedCount = 0;
      try {
        const data = await pdfParse(fileBuffer);
        parsedCount = data.numpages || 0;
      } catch (pdfParseErr) {
        console.error(
          `pdf-parse threw for "${originalName}", falling back to raw page-object scan (found ${rawScanCount}):`,
          pdfParseErr.stack || pdfParseErr.message
        );
      }

      const finalCount = Math.max(parsedCount, rawScanCount, 1);

      if (parsedCount && rawScanCount && parsedCount !== rawScanCount) {
        console.warn(
          `Page count mismatch for "${originalName}": pdf-parse reported ${parsedCount}, ` +
          `raw object scan found ${rawScanCount}. Using ${finalCount}.`
        );
      }
      return finalCount;
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
    console.error(`Page count detection failed for "${originalName}", defaulting to 1:`, err.stack || err.message);
    return 1;
  }
}

module.exports = countPages;