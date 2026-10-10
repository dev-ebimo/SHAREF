/* ==========================================================================
   doc-analyzer.js — counts pages and extracts preview text IN THE BROWSER.

   Why this exists: the backend runs on Cloudflare Workers' free plan (10 ms
   CPU per request), far too little to parse PDFs/Office files. So the admin's
   browser — which has to open the file to review it anyway — does the work:

     analyze(fileUrl, fileName) -> {
       ok,        // false = couldn't read it; admin must type the page count
       pages,     // integer >= 1 (null when ok is false)
       fullText,  // text for the review panel ("" for scans/zip/images)
       snippet,   // the fraction-of-page-1 text students will see ("" = none)
       message    // human-readable note when something is missing
     }

   The admin confirms/edits the page count before approving; the server only
   range-checks what it receives.

   Libraries (pdf.js, JSZip) are lazy-loaded from cdnjs on first use, so pages
   that never analyze a file pay nothing.
   ========================================================================== */
(function (root) {
  "use strict";

  var CDN = {
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  };

  var WORDS_PER_PAGE = 500; // same conversion the pricing has always used for DOCX
  var MAX_PAGES = 1000; // matches the server's upper bound
  var MAX_SNIPPET_CHARS = 1000;
  var MAX_ANALYZE_BYTES = 25 * 1024 * 1024; // refuse to chew on anything absurd
  var MAX_XML_BYTES = 60 * 1024 * 1024; // zip-bomb guard for a single OOXML part
  var MAX_PDF_TEXT_PAGES = 60; // review panel text; the page COUNT covers every page

  /* ------------------------------ pure helpers ------------------------------ */

  function clampPages(n) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(MAX_PAGES, n);
  }

  function wordsToPages(wordCount) {
    return clampPages(Math.ceil(wordCount / WORDS_PER_PAGE));
  }

  function normalizeSpaces(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function countWords(text) {
    var t = normalizeSpaces(text);
    return t ? t.split(" ").length : 0;
  }

  // Only a fraction of "page 1" is ever shown to students: roughly the first
  // half of the first ~500 words (a page's worth), hard-capped on length.
  function snippetFromText(text) {
    var words = normalizeSpaces(text).split(" ").filter(Boolean);
    if (!words.length) return "";
    var pageWords = words.slice(0, WORDS_PER_PAGE);
    var half = pageWords.slice(0, Math.max(1, Math.ceil(pageWords.length / 2)));
    var out = half.join(" ");
    if (out.length > MAX_SNIPPET_CHARS) out = out.slice(0, MAX_SNIPPET_CHARS).trim() + "…";
    return out;
  }

  function decodeEntities(s) {
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  // word/document.xml -> plain text. Reads only real text runs (<w:t>), so
  // field codes and other XML noise don't inflate the word count.
  function docxXmlToText(xml) {
    var out = [];
    var re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\s*\/>|<w:br\s*\/>/g;
    var m;
    while ((m = re.exec(xml)) !== null) {
      if (m[1] !== undefined) out.push(decodeEntities(m[1]));
      else out.push(" ");
    }
    return out.join("");
  }

  // ppt/slides/slideN.xml -> plain text of that slide (<a:t> runs only).
  function pptxSlideXmlToText(xml) {
    var out = [];
    var re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<\/a:p>/g;
    var m;
    while ((m = re.exec(xml)) !== null) {
      out.push(m[1] !== undefined ? decodeEntities(m[1]) : " ");
    }
    return normalizeSpaces(out.join(""));
  }

  function extOf(fileName) {
    var i = String(fileName || "").lastIndexOf(".");
    return i === -1 ? "" : String(fileName).slice(i + 1).toLowerCase();
  }

  function failure(message) {
    return { ok: false, pages: null, fullText: "", snippet: "", message: message };
  }

  /* ------------------------------ per-format analysis ------------------------------ */

  async function readZipText(zip, name) {
    var entry = zip.file(name);
    if (!entry) return null;
    var declared = entry._data && entry._data.uncompressedSize;
    if (declared && declared > MAX_XML_BYTES) throw new Error("zip part too large");
    return entry.async("string");
  }

  async function analyzeDocx(buffer, libs) {
    var zip = await libs.JSZip.loadAsync(buffer);
    var xml = await readZipText(zip, "word/document.xml");
    if (xml === null) return failure("This doesn't look like a valid Word document — enter the page count manually.");
    var text = normalizeSpaces(docxXmlToText(xml));
    var words = countWords(text);
    return {
      ok: true,
      pages: wordsToPages(words),
      fullText: text,
      snippet: snippetFromText(text),
      message: words ? "" : "No readable text found in this document.",
    };
  }

  async function analyzePptx(buffer, libs) {
    var zip = await libs.JSZip.loadAsync(buffer);
    var slideNames = Object.keys(zip.files)
      .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
      .sort(function (a, b) { return parseInt(a.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.match(/(\d+)\.xml$/)[1], 10); });
    if (!slideNames.length) return failure("No slides found in this presentation — enter the page count manually.");

    var slideTexts = [];
    for (var i = 0; i < slideNames.length; i++) {
      slideTexts.push(pptxSlideXmlToText((await readZipText(zip, slideNames[i])) || ""));
    }
    var firstWithText = slideTexts.filter(Boolean)[0] || "";
    // For slides the "page 1" preview is the first slide's text.
    var snippet = firstWithText;
    if (snippet) {
      var half = snippet.slice(0, Math.max(1, Math.ceil(snippet.length / 2)));
      snippet = half.length > MAX_SNIPPET_CHARS ? half.slice(0, MAX_SNIPPET_CHARS).trim() + "…" : half;
    }
    return {
      ok: true,
      pages: clampPages(slideNames.length),
      fullText: slideTexts.filter(Boolean).join("\n\n"),
      snippet: snippet,
      message: firstWithText ? "" : "No readable text found in these slides.",
    };
  }

  async function analyzePdf(buffer, libs) {
    var pdfjsLib = libs.pdfjsLib;
    var pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    } catch (err) {
      if (err && err.name === "PasswordException") {
        return failure("This PDF is password-protected — enter the page count manually.");
      }
      return failure("Couldn't read this PDF — enter the page count manually.");
    }

    try {
      var total = pdf.numPages;
      var textPages = Math.min(total, MAX_PDF_TEXT_PAGES);
      var parts = [];
      var firstPageText = "";
      for (var p = 1; p <= textPages; p++) {
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        var pageText = normalizeSpaces(content.items.map(function (it) { return it.str; }).join(" "));
        if (p === 1) firstPageText = pageText;
        if (pageText) parts.push(pageText);
      }
      var fullText = parts.join("\n\n");
      if (total > textPages) fullText += "\n\n[Text shown for the first " + textPages + " of " + total + " pages — download the file to read the rest.]";

      return {
        ok: true,
        pages: clampPages(total),
        fullText: fullText,
        snippet: snippetFromText(firstPageText),
        message: parts.length ? "" : "This PDF has no selectable text (likely scanned images), so students won't get a text preview.",
      };
    } finally {
      try { pdf.destroy(); } catch (e) { /* ignore */ }
    }
  }

  // Pure + injectable (libs = { JSZip, pdfjsLib }) so it can be unit-tested.
  async function analyzeBuffer(buffer, fileName, libs) {
    var ext = extOf(fileName);
    try {
      if (ext === "pdf") return await analyzePdf(buffer, libs);
      if (ext === "docx") return await analyzeDocx(buffer, libs);
      if (ext === "pptx") return await analyzePptx(buffer, libs);
      // zip / jpg / jpeg / png: nothing to read; one "page", no text preview.
      return { ok: true, pages: 1, fullText: "", snippet: "", message: "No text preview is available for this file type." };
    } catch (err) {
      return failure("Couldn't read this file automatically — enter the page count manually.");
    }
  }

  /* ------------------------------ browser glue ------------------------------ */

  var scriptPromises = {};
  function loadScript(url) {
    if (!scriptPromises[url]) {
      scriptPromises[url] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.onload = resolve;
        s.onerror = function () { delete scriptPromises[url]; reject(new Error("Could not load " + url)); };
        document.head.appendChild(s);
      });
    }
    return scriptPromises[url];
  }

  async function loadLibsFor(ext) {
    var libs = {};
    if (ext === "pdf") {
      await loadScript(CDN.pdf);
      libs.pdfjsLib = root.pdfjsLib;
      libs.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    } else if (ext === "docx" || ext === "pptx") {
      await loadScript(CDN.jszip);
      libs.JSZip = root.JSZip;
    }
    return libs;
  }

  // SHA-256 of the file as lowercase hex, or null if the browser can't do it. The server
  // uses it to spot the same file being uploaded twice. It is advisory, so ANY problem here
  // must stay invisible and never get in the way of reviewing the document.
  async function sha256Hex(buffer) {
    try {
      if (!root.crypto || !root.crypto.subtle) return null;
      var digest = await root.crypto.subtle.digest("SHA-256", buffer);
      return Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    } catch (e) {
      return null;
    }
  }

  async function analyze(fileUrl, fileName) {
    var ext = extOf(fileName);
    var fileHash = null;
    try {
      var res = await fetch(fileUrl);
      if (!res.ok) return failure("Couldn't download the file for analysis — enter the page count manually.");
      var declared = Number(res.headers.get("content-length"));
      if (declared && declared > MAX_ANALYZE_BYTES) return failure("This file is too large to analyze automatically — enter the page count manually.");
      var buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_ANALYZE_BYTES) return failure("This file is too large to analyze automatically — enter the page count manually.");
      fileHash = await sha256Hex(buffer);
      var libs = await loadLibsFor(ext);
      var result = await analyzeBuffer(buffer, fileName, libs);
      result.fileHash = fileHash;
      return result;
    } catch (err) {
      // The file was downloaded (so the hash is still useful) even if parsing it failed.
      var failed = failure("Couldn't analyze this file automatically — enter the page count manually.");
      failed.fileHash = fileHash;
      return failed;
    }
  }

  var api = {
    analyze: analyze,
    // exposed for unit tests
    _internals: {
      analyzeBuffer: analyzeBuffer,
      docxXmlToText: docxXmlToText,
      pptxSlideXmlToText: pptxSlideXmlToText,
      snippetFromText: snippetFromText,
      wordsToPages: wordsToPages,
      clampPages: clampPages,
      decodeEntities: decodeEntities,
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DocAnalyzer = api;
})(typeof window !== "undefined" ? window : globalThis);
