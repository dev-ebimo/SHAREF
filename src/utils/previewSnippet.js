import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { getDocumentProxy, extractText } from "unpdf";

// pdf-parse -> unpdf: pdf-parse is unmaintained and doesn't run on Workers
// (its pdfjs-dist dependency pulls in an optional native `canvas` module
// that breaks edge/serverless runtimes). unpdf ships its own serverless
// build of PDF.js specifically for Workers/Deno/edge environments, with
// zero native dependencies. Unlike the original, this needs no try/catch
// around the import — unpdf doesn't have the fixture-file-on-boot problem
// pdf-parse had, so there's no "PDF preview unavailable" degraded mode to
// fall into at load time.

// Matches utils/pageCounter.js's WORDS_PER_PAGE — "page 1" for a DOCX is
// approximated as its first 500 words, since DOCX has no real page
// boundaries until it's actually paginated by a renderer.
const WORDS_PER_PAGE = 500;
// Hard character cap, applied after the word-based half-page cut, purely as
// a safety net against a single absurdly long "word" (e.g. no whitespace).
const MAX_SNIPPET_CHARS = 1000;

const NO_PREVIEW_MESSAGE = "A text preview isn't available for this file type.";

// unpdf (via PDF.js) has to parse a PDF's entire internal structure to
// extract text from ANY page — including just page 1 — since there's no
// way to know where page 1 ends without first reading the document's
// cross-reference table. For a large or structurally complex PDF (many
// embedded fonts/images, scanned pages), that parsed in-memory
// representation can run to several times the raw file size. Workers
// enforces its own memory limit per isolate (128MB), so above this size,
// skip extraction entirely and degrade to "no preview" (the same outcome
// an unsupported type like .zip already gets) rather than risk hitting
// that ceiling mid-request. This only affects the optional inline preview
// — upload, payment, and download all still work regardless of file size.
// Note: this also still matters for any resource uploaded before the
// app's own upload cap (see the multipart size check in the upload route)
// was lowered — those larger files are already stored and can still hit
// this path when an admin opens their preview.
const MAX_PDF_EXTRACTION_BYTES = 8 * 1024 * 1024; // 8MB

function extname(fileName) {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i).toLowerCase();
}

// Returns per-page text as an array (unpdf's default when mergePages isn't
// passed) — pageNumber is 1-indexed, matching the original's page-number
// convention.
async function extractPdfPageText(fileBuffer, pageNumber) {
  const pdf = await getDocumentProxy(new Uint8Array(fileBuffer));
  const { text } = await extractText(pdf);
  return text[pageNumber - 1] || "";
}

async function extractPdfFullText(fileBuffer) {
  const pdf = await getDocumentProxy(new Uint8Array(fileBuffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text || "";
}

// Student-facing preview: half of page 1 only, for DOCX/PPTX/PDF. Anything
// else (e.g. ZIP) falls through to the "not available" branch below, since
// there's no text extractor for it.
export default async function getPreviewSnippet(fileBuffer, originalName) {
  const ext = extname(originalName);

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
      if (fileBuffer.length > MAX_PDF_EXTRACTION_BYTES) {
        return { available: false, message: NO_PREVIEW_MESSAGE };
      }

      // Real page boundaries, unlike the word-count approximation DOCX
      // needs — extracts only page 1's text.
      const text = await extractPdfPageText(fileBuffer, 1);
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
export async function getFullText(fileBuffer, originalName) {
  const ext = extname(originalName);

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
      if (fileBuffer.length > MAX_PDF_EXTRACTION_BYTES) {
        return { available: false, message: NO_PREVIEW_MESSAGE };
      }

      // No page restriction here — admin review gets the whole document,
      // same as DOCX/PPTX above.
      const text = await extractPdfFullText(fileBuffer);
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
