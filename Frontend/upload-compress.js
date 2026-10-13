// ==========================================================================
// upload-compress.js — browser-side compression of a student's upload.
//
//   SharefCompress.compress(file, { onProgress(fraction, pass), signal }) -> Promise<result>
//
// result = {
//   file,          // the File to upload: the compressed one, or the ORIGINAL if nothing was gained
//   originalSize,  // bytes before
//   size,          // bytes of `file`
//   compressed,    // true only if `file` is a smaller, verified version
//   reason,        // null when compressed, otherwise why not: 'unsupported-type' | 'too-small' | 'too-large' |
//                  // 'unsupported-browser' | 'no-eligible-images' | 'not-smaller' | 'timeout' | 'failed' | 'aborted'
//   savedPct,      // whole percent saved (0 when not compressed)
//   preset,        // 'medium' | 'floor' when compressed (floor = the extra-reduction pass), else null
//   stats          // { images, recompressed, ... } when the worker ran
// }
//
// The promise never rejects: on ANY problem the caller simply gets the original file back, so compression can
// never make an upload fail that would otherwise have worked.
//
// How it works: the heavy lifting runs in compress-worker.js (a Web Worker, so the page stays responsive even on a
// low-end phone). Only the images inside PDF / DOCX / PPTX files are re-encoded; text, layout and page counts are
// untouched. Quality is MEDIUM (images capped at 2000px on the long edge, JPEG quality 0.75) and is never lower than
// the floor (1800px / 0.70), which is used only when medium still wouldn't fit under the 8 MB storage limit. Any image
// that wouldn't get at least 10% smaller is left exactly as it was.
//
// Nothing here is trusted by the server. The server never takes the original size or any hash from this file for
// a decision; it verifies the stored file itself.
// ==========================================================================
(function (root) {
  "use strict";

  // IMAGE QUALITY. "Medium" is the default and 1800px / 0.70 is the FLOOR: it is never going to be lower than that.
  // A second, lower pass runs ONLY when the medium result still doesn't fit under the storage limit (8 MB).
  // To be gentler, raise these numbers; to save more space, lower them (but keep the floor at or above medium).
  var SETTINGS = {              // pass 1: medium
    maxEdge: 2000,              // px, longest side (A4 at ~170 dpi; full-HD slides are never downscaled)
    quality: 0.75,              // JPEG quality 0..1
    minImageBytes: 30 * 1024,   // images smaller than this aren't worth touching
    minImageSavings: 0.1        // an image is only replaced if it becomes at least 10% smaller
  };
  var FLOOR = {                 // pass 2 (only if pass 1 doesn't fit): the lowest quality we will ever use
    maxEdge: 1800,
    quality: 0.7,
    minImageBytes: 30 * 1024,
    minImageSavings: 0.1
  };

  var LIMITS = {
    minFileBytes: 1024 * 1024,         // below 1 MB there is nothing worth the effort
    maxInputBytes: 40 * 1024 * 1024,   // memory guard for phones: bigger files are refused up front
    targetBytes: 8 * 1024 * 1024,      // the storage limit; a second pass runs only if pass 1 is still above this
    timeoutMs: 180000,                 // give up (and upload the original) after 3 minutes in total
    minTotalSavings: 0.1               // use the result only if the whole FILE became at least 10% smaller
  };

  // Where things are loaded from. Pinned versions; tests point these at local copies.
  var URLS = {
    worker: "compress-worker.js",
    jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    pdflib: "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"
  };

  var COMPRESSIBLE = ["pdf", "docx", "pptx"];
  var MIME = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  function isCompressible(fileName) { return COMPRESSIBLE.indexOf(extOf(fileName)) !== -1; }

  // Needs a worker that can decode and encode images off the main thread.
  function isSupported() {
    return typeof root.Worker === "function" && typeof root.Blob === "function" &&
      typeof root.OffscreenCanvas === "function" && typeof root.createImageBitmap === "function" &&
      typeof root.OffscreenCanvas.prototype.convertToBlob === "function";
  }

  function hasValidHeader(ext, bytes) {
    if (ext === "pdf") return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;                                    // PK\3\4
  }

  function compress(file, opts) {
    opts = opts || {};
    var originalSize = file.size;
    var ext = extOf(file.name);

    function unchanged(reason, extra) {
      var r = { file: file, originalSize: originalSize, size: originalSize, compressed: false, reason: reason, savedPct: 0, stats: null, preset: null };
      if (extra) for (var k in extra) r[k] = extra[k];
      return r;
    }

    if (COMPRESSIBLE.indexOf(ext) === -1) return Promise.resolve(unchanged("unsupported-type"));
    if (file.size < LIMITS.minFileBytes) return Promise.resolve(unchanged("too-small"));
    if (file.size > LIMITS.maxInputBytes) return Promise.resolve(unchanged("too-large"));
    if (!isSupported()) return Promise.resolve(unchanged("unsupported-browser"));

    return new Promise(function (resolve) {
      var worker = null, timer = null, settled = false;
      var signal = opts.signal;

      function killWorker() {
        if (worker) { try { worker.terminate(); } catch (e) { /* already gone */ } worker = null; }
      }
      function finish(result) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        killWorker();
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(result);
      }
      function onAbort() { finish(unchanged("aborted", { aborted: true })); }

      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort);
      }
      timer = setTimeout(function () { finish(unchanged("timeout")); }, LIMITS.timeoutMs);

      // One worker run with the given quality settings. Always resolves with the worker's final message
      // ({type:'done'|'error'}) or {type:'nosupport'}; the original File is never consumed (we transfer a copy).
      function runPass(settings, passNo) {
        return file.arrayBuffer().then(function (buffer) {
          return new Promise(function (res) {
            if (settled) { res({ type: "aborted" }); return; }
            try { worker = new root.Worker(URLS.worker); } catch (e) { res({ type: "nosupport" }); return; }
            var w = worker;
            w.onmessage = function (ev) {
              var m = ev.data || {};
              if (m.type === "progress") {
                if (typeof opts.onProgress === "function") opts.onProgress(m.total ? m.done / m.total : 0, passNo);
                return;
              }
              if (m.type === "done" || m.type === "error") { try { w.terminate(); } catch (e) { /* done */ } if (worker === w) worker = null; res(m); }
            };
            w.onerror = function () { try { w.terminate(); } catch (e) { /* done */ } if (worker === w) worker = null; res({ type: "error", message: "worker error" }); };
            w.postMessage({ type: "compress", ext: ext, buffer: buffer, settings: settings, libUrls: { jszip: URLS.jszip, pdflib: URLS.pdflib } }, [buffer]);
          });
        });
      }

      // Turn a worker message into either {buffer,size,stats} (usable) or {reason} (not usable).
      function evaluate(m) {
        if (m.type === "nosupport") return { reason: "unsupported-browser" };
        if (m.type === "error") return { reason: "failed", error: m.message };
        if (m.type !== "done") return { reason: "failed" };
        if (!m.buffer) return { reason: "no-eligible-images", stats: m.stats || null };
        var size = m.buffer.byteLength;
        if (!hasValidHeader(ext, new Uint8Array(m.buffer, 0, 8))) return { reason: "failed", error: "bad header" };
        if (size > originalSize * (1 - LIMITS.minTotalSavings)) return { reason: "not-smaller", stats: m.stats || null };
        return { buffer: m.buffer, size: size, stats: m.stats || null };
      }

      var target = typeof opts.targetBytes === "number" ? opts.targetBytes : LIMITS.targetBytes;

      runPass(SETTINGS, 1).then(function (m1) {
        if (settled) return null;
        var r1 = evaluate(m1);
        var usable1 = !!r1.buffer;
        // A lower pass is worth trying only if the medium pass left the file above the limit (or barely helped while
        // the original was above it). It restarts from the ORIGINAL file, never from already-recompressed images.
        var needsMore = usable1 ? r1.size > target : (r1.reason === "not-smaller" && originalSize > target);
        if (!needsMore) return r1;
        return runPass(FLOOR, 2).then(function (m2) {
          if (settled) return r1;
          var r2 = evaluate(m2);
          if (r2.buffer && (!usable1 || r2.size < r1.size)) { r2.preset = "floor"; return r2; }
          return r1;
        });
      }).then(function (r) {
        if (settled || !r) return;
        if (!r.buffer) { finish(unchanged(r.reason || "failed", { stats: r.stats || null, error: r.error })); return; }
        var out = new root.File([r.buffer], file.name, { type: file.type || MIME[ext], lastModified: file.lastModified });
        finish({
          file: out, originalSize: originalSize, size: r.size, compressed: true, reason: null,
          savedPct: Math.round(100 * (1 - r.size / originalSize)), stats: r.stats || null, preset: r.preset || "medium"
        });
      }).catch(function () { finish(unchanged("failed")); });
    });
  }

  root.SharefCompress = { compress: compress, isSupported: isSupported, isCompressible: isCompressible, settings: SETTINGS, floor: FLOOR, limits: LIMITS, urls: URLS };
})(typeof window !== "undefined" ? window : self);
