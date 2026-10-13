// ==========================================================================
// compress-worker.js — shrinks an upload's IMAGES, off the main thread.
//
// Started by upload-compress.js (never loaded directly by a page). It receives
//   { type: 'compress', ext, buffer, settings, libUrls }
// and answers with progress messages and finally either
//   { type: 'done', buffer, stats }   buffer = the smaller file, or null when nothing worth changing was found
//   { type: 'error', message }
//
// What it does, per format:
//   .docx / .pptx  Re-encodes the JPEG pictures in word|ppt/media/ at a sensible size/quality and writes the
//                  package back. Every XML part, relationship and non-JPEG file is carried over untouched
//                  (byte for byte), so text, layout, slide count and page count cannot change.
//   .pdf           Re-encodes embedded JPEG images (DCTDecode) in place. Page content streams, fonts and text are
//                  not touched, so text stays selectable/searchable and the page count cannot change.
//
// What it deliberately does NOT do (it leaves these alone rather than risk damaging them):
//   - PNG / other image formats, CMYK or indexed-colour images, images with masks or /Decode arrays
//   - encrypted PDFs (pdf-lib refuses them; the caller then uploads the original)
//   - images whose EXIF rotation can't be handled safely
//   - an image is only replaced if the new one is clearly smaller (see settings.minImageSavings)
//
// Before returning, the output is re-opened and checked (valid structure, same page count / same entries).
// Any failure anywhere results in an error message and the caller uploads the ORIGINAL file instead.
// ==========================================================================
"use strict";

// ---------- JPEG header parsing (size, colour components, EXIF orientation) ----------
function readExifOrientation(b, tiff, end) {
  var le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!le && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return 0;
  function u16(o) { return le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]); }
  function u32(o) {
    return (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;
  }
  if (tiff + 8 > end || u16(tiff + 2) !== 42) return 0;
  var ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 0;
  var n = u16(ifd);
  for (var k = 0; k < n; k++) {
    var e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) { var v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}

// Returns { w, h, comps, orientation } or null if this isn't a JPEG we understand.
function parseJpeg(b) {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  var i = 2, orientation = 1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    var marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // reached image data without finding a frame header
    var len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    var seg = i + 4;
    if (marker === 0xe1 && b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66 && b[seg + 4] === 0 && b[seg + 5] === 0) {
      orientation = readExifOrientation(b, seg + 6, i + 2 + len) || orientation;
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (b[seg + 1] << 8) | b[seg + 2], w: (b[seg + 3] << 8) | b[seg + 4], comps: b[seg + 5], orientation: orientation };
    }
    i += 2 + len;
  }
  return null;
}

// ---------- decode + re-encode one JPEG through the browser's own image pipeline ----------
// forPdf: PDF viewers ignore EXIF orientation, Office apps honour it, so they need different handling.
async function decodeJpeg(bytes, info, forPdf) {
  var blob = new Blob([bytes], { type: "image/jpeg" });
  if (info.orientation === 1) return createImageBitmap(blob);
  if (forPdf) return null;            // a rotated JPEG inside a PDF: leave it exactly as it is
  var bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (e) { return null; }
  // For 90-degree rotations the browser must have swapped width and height. If it didn't (or we can't tell
  // because the image is square), skip the image rather than guess.
  if (info.orientation >= 5) {
    if (info.w === info.h || !(bmp.width === info.h && bmp.height === info.w)) { bmp.close(); return null; }
  }
  return bmp;
}

// Returns { bytes, w, h } when a clearly smaller image was produced, else null.
async function reencodeJpeg(bytes, settings, forPdf, tally) {
  if (bytes.length < settings.minImageBytes) { tally.tooSmall++; return null; }
  var info = parseJpeg(bytes);
  if (!info || info.comps === 4 || !(info.w > 0) || !(info.h > 0)) { tally.unsupported++; return null; } // not a JPEG we can safely handle / CMYK
  var bmp = await decodeJpeg(bytes, info, forPdf);
  if (!bmp) { tally.unsupported++; return null; }
  var k = Math.min(1, settings.maxEdge / Math.max(bmp.width, bmp.height));
  var w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  var canvas = new OffscreenCanvas(w, h);
  var ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  var blob = await canvas.convertToBlob({ type: "image/jpeg", quality: settings.quality });
  var out = new Uint8Array(await blob.arrayBuffer());
  if (out.length > bytes.length * (1 - settings.minImageSavings)) { tally.notSmaller++; return null; }
  return { bytes: out, w: w, h: h };
}

function newTally() { return { images: 0, recompressed: 0, tooSmall: 0, unsupported: 0, notSmaller: 0 }; }

// ---------- .docx / .pptx ----------
async function compressOoxml(m, progress) {
  var zip = await JSZip.loadAsync(m.buffer, { createFolders: false, checkCRC32: true });
  var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
  if (names.indexOf("[Content_Types].xml") === -1) throw new Error("Not an Office package");
  var targets = names.filter(function (n) { return /(^|\/)media\/[^/]+\.jpe?g$/i.test(n); });
  var tally = newTally();
  tally.images = targets.length;
  for (var i = 0; i < targets.length; i++) {
    progress(i, targets.length);
    var orig = await zip.file(targets[i]).async("uint8array");
    var r = await reencodeJpeg(orig, m.settings, false, tally);
    if (r) {
      // createFolders:false keeps the package's entry list identical (JSZip would otherwise add folder entries).
      zip.file(targets[i], r.bytes, { compression: "STORE", createFolders: false, binary: true });
      tally.recompressed++;
    }
  }
  progress(targets.length, targets.length);
  if (tally.recompressed === 0) return { buffer: null, stats: tally };

  var out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });

  // Verify before trusting: valid zip (CRC-checked), same entries in the same order, Office package intact.
  var check = await JSZip.loadAsync(out, { createFolders: false, checkCRC32: true });
  var after = Object.keys(check.files).filter(function (n) { return !check.files[n].dir; });
  if (after.length !== names.length || after.some(function (n, idx) { return n !== names[idx]; })) throw new Error("Package structure changed");
  return { buffer: out, stats: tally };
}

// ---------- .pdf ----------
function nameOf(obj) { return obj && typeof obj.toString === "function" ? obj.toString() : ""; }

function isPlainDct(doc, dict, PDFLib) {
  var f = dict.get(PDFLib.PDFName.of("Filter"));
  if (!f) return false;
  f = doc.context.lookup(f);
  if (f instanceof PDFLib.PDFArray) {
    if (f.size() !== 1) return false;
    f = doc.context.lookup(f.get(0));
  }
  return nameOf(f) === "/DCTDecode";
}

// 8-bit gray or RGB only (Device* or an ICC profile with 1 or 3 components). Anything else is left alone.
function isSupportedColorSpace(doc, dict, PDFLib) {
  var cs = dict.get(PDFLib.PDFName.of("ColorSpace"));
  if (!cs) return false;
  cs = doc.context.lookup(cs);
  var n = nameOf(cs);
  if (n === "/DeviceRGB" || n === "/DeviceGray") return true;
  if (cs instanceof PDFLib.PDFArray && cs.size() === 2 && nameOf(doc.context.lookup(cs.get(0))) === "/ICCBased") {
    var profile = doc.context.lookup(cs.get(1));
    var comps = profile && profile.dict ? doc.context.lookup(profile.dict.get(PDFLib.PDFName.of("N"))) : null;
    var count = comps && typeof comps.asNumber === "function" ? comps.asNumber() : 0;
    return count === 1 || count === 3;
  }
  return false;
}

async function compressPdf(m, progress) {
  var PDFLib = self.PDFLib;
  var PDFName = PDFLib.PDFName, PDFRawStream = PDFLib.PDFRawStream;
  // No ignoreEncryption: an encrypted PDF throws here, and the caller uploads the original untouched.
  var doc = await PDFLib.PDFDocument.load(m.buffer, { updateMetadata: false });
  var pagesBefore = doc.getPageCount();

  var candidates = [];
  var tally = newTally();
  doc.context.enumerateIndirectObjects().forEach(function (pair) {
    var ref = pair[0], obj = pair[1];
    if (!(obj instanceof PDFRawStream)) return;
    var d = obj.dict;
    var sub = d.get(PDFName.of("Subtype"));
    if (!sub || nameOf(sub) !== "/Image") return;
    tally.images++;
    var bpc = d.get(PDFName.of("BitsPerComponent"));
    var ok = isPlainDct(doc, d, PDFLib) && isSupportedColorSpace(doc, d, PDFLib) &&
      bpc && typeof bpc.asNumber === "function" && bpc.asNumber() === 8 &&
      !d.get(PDFName.of("Decode")) && !d.get(PDFName.of("Mask")) && !d.get(PDFName.of("DecodeParms")) &&
      !d.get(PDFName.of("SMaskInData")) && nameOf(d.get(PDFName.of("ImageMask"))) !== "true";
    if (ok) candidates.push([ref, obj]); else tally.unsupported++;
  });

  for (var i = 0; i < candidates.length; i++) {
    progress(i, candidates.length);
    var ref = candidates[i][0], obj = candidates[i][1];
    var r = await reencodeJpeg(obj.contents, m.settings, true, tally);
    if (!r) continue;
    var dict = doc.context.obj({ Type: "XObject", Subtype: "Image", Width: r.w, Height: r.h, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" });
    var smask = obj.dict.get(PDFName.of("SMask")); if (smask) dict.set(PDFName.of("SMask"), smask); // keep transparency
    var interp = obj.dict.get(PDFName.of("Interpolate")); if (interp) dict.set(PDFName.of("Interpolate"), interp);
    doc.context.assign(ref, PDFRawStream.of(dict, r.bytes));
    tally.recompressed++;
  }
  progress(candidates.length, candidates.length);
  if (tally.recompressed === 0) return { buffer: null, stats: tally };

  var out = await doc.save({ useObjectStreams: true });

  // Verify before trusting: a PDF header, parses again, and has exactly the same number of pages.
  if (!(out[0] === 0x25 && out[1] === 0x50 && out[2] === 0x44 && out[3] === 0x46 && out[4] === 0x2d)) throw new Error("Output is not a PDF");
  var reopened = await PDFLib.PDFDocument.load(out, { updateMetadata: false });
  if (reopened.getPageCount() !== pagesBefore) throw new Error("Page count changed");
  return { buffer: out, stats: tally };
}

// ---------- message handling ----------
self.onmessage = async function (e) {
  var m = e.data;
  if (!m || m.type !== "compress") return;
  var lastPost = 0;
  function progress(done, total) {
    var now = Date.now();
    if (done !== total && now - lastPost < 80) return; // don't flood the main thread
    lastPost = now;
    self.postMessage({ type: "progress", done: done, total: total });
  }
  try {
    var result;
    if (m.ext === "pdf") {
      importScripts(m.libUrls.pdflib);
      result = await compressPdf(m, progress);
    } else if (m.ext === "docx" || m.ext === "pptx") {
      importScripts(m.libUrls.jszip);
      result = await compressOoxml(m, progress);
    } else {
      throw new Error("Unsupported type");
    }
    if (result.buffer) {
      var buf = result.buffer.buffer.slice(result.buffer.byteOffset, result.buffer.byteOffset + result.buffer.byteLength);
      self.postMessage({ type: "done", buffer: buf, stats: result.stats }, [buf]);
    } else {
      self.postMessage({ type: "done", buffer: null, stats: result.stats });
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};
