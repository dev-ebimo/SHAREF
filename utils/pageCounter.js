const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const path = require("path");

const WORDS_PER_PAGE = 500;

async function countPages(fileBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === ".pdf") {
      const data = await pdfParse(fileBuffer);
      return data.numpages || 1;
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
    console.error("Page count detection failed, defaulting to 1:", err.message);
    return 1;
  }
}

module.exports = countPages;