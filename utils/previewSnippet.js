const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const path = require("path");

const SNIPPET_LENGTH = 500;

async function getPreviewSnippet(fileBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === ".pdf") {
      const data = await pdfParse(fileBuffer);
      return { available: true, snippet: cleanAndTrim(data.text) };
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return { available: true, snippet: cleanAndTrim(result.value) };
    }

    if (ext === ".pptx") {
      const zip = new AdmZip(fileBuffer);
      const slideEntries = zip
        .getEntries()
        .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
        .sort((a, b) => {
          const numA = parseInt(a.entryName.match(/slide(\d+)\.xml/)[1], 10);
          const numB = parseInt(b.entryName.match(/slide(\d+)\.xml/)[1], 10);
          return numA - numB;
        });

      let combinedText = "";
      for (const entry of slideEntries) {
        const xml = entry.getData().toString("utf8");
        const cleanedSlideText = stripXmlTags(xml).replace(/\s+/g, " ").trim();
        if (cleanedSlideText) combinedText += cleanedSlideText + " ";
        if (combinedText.length >= SNIPPET_LENGTH) break;
      }

      return { available: true, snippet: cleanAndTrim(combinedText) };
    }

    return { available: false, message: "A text preview isn't available for this file type." };
  } catch (err) {
    console.error("Preview extraction failed:", err.message);
    return { available: false, message: "Preview could not be generated for this document." };
  }
}

function cleanAndTrim(rawText) {
  const cleaned = rawText.replace(/\s+/g, " ").trim();
  if (cleaned.length <= SNIPPET_LENGTH) return cleaned;
  return cleaned.slice(0, SNIPPET_LENGTH).trim() + "…";
}

function stripXmlTags(xml) {
  return xml.replace(/<[^>]*>/g, " ");
}

module.exports = getPreviewSnippet;