// Frontend/doc-analyzer.js — the page counting / preview extraction that now
// happens in the reviewing admin's browser. Tested here with real DOCX/PPTX
// archives (built with JSZip) and a stub of pdf.js.
import fs from "node:fs";
import vm from "node:vm";
import JSZip from "jszip";

let passed = 0, failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; } else { console.log("FAIL-", label, extra); failed++; }
}

// Load the browser script the way a <script> tag would, in a sandbox.
const src = fs.readFileSync(new URL("../Frontend/doc-analyzer.js", import.meta.url), "utf8");
const sandbox = { module: { exports: {} }, console, String, Number, Math, Object, Array, Uint8Array, JSON, parseInt, isFinite, Error, RegExp };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { analyzeBuffer, docxXmlToText, pptxSlideXmlToText, snippetFromText, wordsToPages, clampPages, decodeEntities } = sandbox.module.exports._internals;

const words = (n, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(" ");
const shortWords = (n) => "x ".repeat(n).trim(); // short tokens so the 1000-char cap isn't what limits the snippet

async function makeDocx(text, { extraXml = "" } = {}) {
  const zip = new JSZip();
  const paras = text.split("\n").map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document><w:body>${paras}${extraXml}</w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}
async function makePptx(slides) {
  const zip = new JSZip();
  slides.forEach((t, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`));
  return zip.generateAsync({ type: "uint8array" });
}
const libs = { JSZip };

(async () => {
  // ---------- pure helpers ----------
  check("clampPages: floors, bounds to 1..1000", clampPages(0) === 1 && clampPages(-5) === 1 && clampPages(NaN) === 1 && clampPages(7.9) === 7 && clampPages(5000) === 1000);
  check("wordsToPages: 500 words/page, minimum 1", wordsToPages(0) === 1 && wordsToPages(1) === 1 && wordsToPages(500) === 1 && wordsToPages(501) === 2 && wordsToPages(1250) === 3);
  check("decodeEntities handles named + numeric entities", decodeEntities("A &amp; B &lt;c&gt; &#65;&#x42; &quot;q&quot; &apos;") === "A & B <c> AB \"q\" '");
  check("docx xml: reads only <w:t> runs, paragraph ends become spaces", docxXmlToText('<w:p><w:r><w:instrText> PAGE </w:instrText><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p>').replace(/\s+/g, " ").trim() === "Hello World");
  check("docx xml: <w:tab/> doesn't get mistaken for text, no crash on empty", docxXmlToText("<w:p><w:r><w:tab/><w:t>a</w:t></w:r></w:p>").trim() === "a" && docxXmlToText("") === "");
  check("pptx xml: reads <a:t> runs", pptxSlideXmlToText("<a:p><a:r><a:t>Title</a:t></a:r></a:p><a:p><a:r><a:t>Body &amp; more</a:t></a:r></a:p>") === "Title Body & more");
  check("snippet: empty text -> empty snippet", snippetFromText("") === "" && snippetFromText("   \n ") === "");
  check("snippet: only HALF of the first 500 words (250), never more", snippetFromText(shortWords(1000)).split(" ").length === 250);
  const longTok = snippetFromText(words(1000));
  check("snippet: long text is cut at the char cap and starts at the beginning", longTok.startsWith("w1 w2 ") && longTok.length <= 1001 && !longTok.includes("w400"));
  check("snippet: one-word text still yields a snippet", snippetFromText("hello") === "hello");
  check("snippet: hard-capped near 1000 chars", snippetFromText("x".repeat(5000)).length <= 1001);

  // ---------- DOCX ----------
  {
    const r = await analyzeBuffer(await makeDocx(shortWords(1250)), "notes.docx", libs);
    check("docx: 1250 words -> 3 pages", r.ok && r.pages === 3, JSON.stringify({ ok: r.ok, pages: r.pages }));
    check("docx: snippet is a fraction of the first page (250 of the first 500 words)", r.snippet.split(" ").length === 250);
    check("docx: full text returned for the review panel", r.fullText.split(" ").length === 1250);
    const small = await analyzeBuffer(await makeDocx("Just a few words here"), "n.docx", libs);
    check("docx: tiny document -> 1 page", small.ok && small.pages === 1);
    const multi = await analyzeBuffer(await makeDocx("First paragraph\nSecond paragraph"), "n.docx", libs);
    check("docx: paragraphs are separated by spaces, not glued", multi.fullText === "First paragraph Second paragraph", multi.fullText);
    const empty = await analyzeBuffer(await makeDocx(""), "n.docx", libs);
    check("docx: no text -> ok, 1 page, no snippet, explanatory message", empty.ok && empty.pages === 1 && empty.snippet === "" && empty.message.length > 0);
    const esc = await analyzeBuffer(await makeDocx("Tom &amp; Jerry &lt;b&gt;"), "n.docx", libs);
    check("docx: XML entities decoded in the text", esc.fullText === "Tom & Jerry <b>", esc.fullText);
  }
  {
    const notDocx = new JSZip(); notDocx.file("hello.txt", "x");
    const r = await analyzeBuffer(await notDocx.generateAsync({ type: "uint8array" }), "fake.docx", libs);
    check("docx: zip without document.xml -> ok:false (manual entry)", r.ok === false && r.pages === null && r.message.length > 0);
    const garbage = await analyzeBuffer(new Uint8Array([1, 2, 3, 4]), "fake.docx", libs);
    check("docx: garbage bytes -> ok:false, never throws", garbage.ok === false);
  }

  // ---------- PPTX ----------
  {
    const r = await analyzeBuffer(await makePptx(["Intro slide", "Second", "Third", "Fourth"]), "deck.pptx", libs);
    check("pptx: pages = number of slides", r.ok && r.pages === 4);
    check("pptx: snippet is a fraction of the FIRST slide", r.snippet.length > 0 && r.snippet.length < "Intro slide".length && "Intro slide".startsWith(r.snippet));
    check("pptx: full text joins slides", r.fullText === "Intro slide\n\nSecond\n\nThird\n\nFourth");
    const order = await analyzeBuffer(await makePptx(Array.from({ length: 12 }, (_, i) => `S${i + 1}`)), "deck.pptx", libs);
    check("pptx: slides 10-12 ordered numerically after 9 (not lexically)", order.fullText.startsWith("S1\n\nS2\n\nS3") && order.fullText.endsWith("S10\n\nS11\n\nS12"));
    const none = await analyzeBuffer(await (new JSZip()).file("x.txt", "1").generateAsync({ type: "uint8array" }), "d.pptx", libs);
    check("pptx: no slides -> ok:false", none.ok === false);
  }

  // ---------- PDF (stub of pdf.js) ----------
  const fakePdfjs = (pageTexts, { failWith } = {}) => ({
    getDocument: () => ({
      promise: failWith
        ? Promise.reject(Object.assign(new Error("x"), { name: failWith }))
        : Promise.resolve({
            numPages: pageTexts.length,
            getPage: async (n) => ({ getTextContent: async () => ({ items: pageTexts[n - 1].split(" ").map((str) => ({ str })) }) }),
            destroy() {},
          }),
    }),
  });
  {
    const r = await analyzeBuffer(new Uint8Array(10), "a.pdf", { pdfjsLib: fakePdfjs([words(100, "a"), words(50, "b"), words(10, "c")]) });
    check("pdf: pages = pdf.js numPages", r.ok && r.pages === 3);
    check("pdf: snippet is a fraction of PAGE 1 only", r.snippet.split(" ").length === 50 && r.snippet.startsWith("a1 ") && !r.snippet.includes("b1"));
    check("pdf: full text includes later pages", r.fullText.includes("b1") && r.fullText.includes("c1"));
    const big = await analyzeBuffer(new Uint8Array(10), "a.pdf", { pdfjsLib: fakePdfjs(Array.from({ length: 80 }, (_, i) => `page${i + 1}`)) });
    check("pdf: page COUNT covers all 80 pages even though text is capped", big.pages === 80 && big.fullText.includes("page60") && !big.fullText.includes("page61 ") && /first 60 of 80/.test(big.fullText));
    const scanned = await analyzeBuffer(new Uint8Array(10), "scan.pdf", { pdfjsLib: fakePdfjs(["", "", ""]) });
    check("pdf: scanned (no text) -> pages known, no snippet, explanatory message", scanned.ok && scanned.pages === 3 && scanned.snippet === "" && /scanned/i.test(scanned.message));
    const locked = await analyzeBuffer(new Uint8Array(10), "l.pdf", { pdfjsLib: fakePdfjs([], { failWith: "PasswordException" }) });
    check("pdf: password-protected -> ok:false with a specific message", locked.ok === false && /password/i.test(locked.message));
    const broken = await analyzeBuffer(new Uint8Array(10), "b.pdf", { pdfjsLib: fakePdfjs([], { failWith: "InvalidPDFException" }) });
    check("pdf: corrupt -> ok:false", broken.ok === false);
    const huge = await analyzeBuffer(new Uint8Array(10), "h.pdf", { pdfjsLib: fakePdfjs(Array.from({ length: 1500 }, () => "x")) });
    check("pdf: page count clamped to the server's 1000 maximum", huge.pages === 1000);
  }

  // ---------- other types ----------
  for (const name of ["a.zip", "a.jpg", "a.jpeg", "a.png"]) {
    const r = await analyzeBuffer(new Uint8Array(10), name, {});
    check(`${name}: 1 page, no text preview, ok`, r.ok && r.pages === 1 && r.snippet === "" && r.message.length > 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error("TEST RUNNER CRASHED:", e); process.exit(1); });
