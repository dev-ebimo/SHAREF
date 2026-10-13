# Browser-side compression + compression-proof duplicate detection

When a student uploads a PDF, DOCX or PPTX, the images inside are shrunk **in their browser**
before the file goes to Cloudinary. Only ONE file is stored per upload (the compressed one).
A second, compression-proof fingerprint keeps duplicate detection working without storing the original.

## ⚠ Deploy in this order
1. **Run the migration FIRST** (adds 3 nullable columns + 1 index; safe on live data):
   `npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/006_content_fingerprint.sql`
   (local dev DB: use `--local` instead of `--remote`)
2. **Deploy the Worker:** `npm run deploy`
3. **Upload the Frontend.** New files: `upload-compress.js`, `compress-worker.js`. Changed: `upload.html/js/css`,
   `doc-analyzer.js`, `admin-moderation.js`, `admin-notification.js`.
Do not deploy the new backend before the migration: uploads would fail until the columns exist.

## What the student sees
- PDF / DOCX / PPTX may now be picked up to **40 MB** (ZIP stays 8 MB). The submit button waits while the file is
  optimized ("Optimizing… 40%"), then shows e.g. "Optimized: 17 MB → 5.8 MB (66% smaller)".
- The **8 MB limit now applies to the optimized file** (that is what Cloudinary stores; Cloudinary's free plan caps files at 10 MB).
  If it is still over 8 MB, the student gets a clear message and can pick another file.
- If anything goes wrong (old browser, timeout, odd file) the ORIGINAL is uploaded unchanged. Compression can never
  make an upload fail that would otherwise have worked.

## Image quality ("medium or better")
Edit the numbers at the top of `Frontend/upload-compress.js`:
| | longest side | JPEG quality | used |
|---|---|---|---|
| **Medium (default)** | 2000 px | 0.75 | always first |
| **Floor** | 1800 px | 0.70 | ONLY if medium still doesn't fit under 8 MB; never lower than this |
Images that wouldn't get at least 10% smaller are left exactly as they were; so are PNGs, CMYK/indexed images, images
with masks, rotated JPEGs inside PDFs, encrypted PDFs. Text, XML, layout and page counts are never touched.
To save more space lower the numbers (keep the floor >= medium); to be gentler raise them.

## Duplicate detection WITHOUT keeping the original
Design rule: **nothing the uploader supplies is ever trusted for duplicate detection** (a value computed in the
student's browser can simply be faked). Both fingerprints are computed by the **reviewing admin's browser from the
file that is actually stored**, at approval time:
- `file_hash` (exists today): SHA-256 of the stored bytes.
- `content_fp` (new): survives compression because it ignores the parts compression changes.
  `ooxml1:<sha256>` for DOCX/PPTX (every part except embedded media) and `pdftext1:<sha256>` for PDFs (normalised text + page count).
  Documents with under 200 characters of text (scans, image-only files) get NO content fingerprint on purpose, so two
  different image-only documents can never be mistaken for one another.
The reward engine calls a file a duplicate if EITHER fingerprint matches an already-APPROVED resource. The server
validates the fingerprint format strictly (`^(ooxml1|pdftext1):[a-f0-9]{64}$`).
`original_size_bytes` (size before compression) is stored for reporting only and is never used for any decision.

### Honest limits of duplicate detection
- It catches re-uploads of an UNMODIFIED document. Editing the document (one word, one byte) defeats it, exactly as
  with the old exact-hash check.
- **Scanned / image-only PDFs and ZIPs** have no content fingerprint, so they fall back to the exact file hash. Since
  different browsers compress images differently, a re-upload of the same scan from another browser engine may not
  match. (Same-browser re-uploads still do.) A perceptual image hash would close this gap; say if you want it.
- Resources approved BEFORE this change have no `content_fp`, so a compressed re-upload of an old resource won't match
  it unless the bytes are identical. New approvals are covered. (A one-off backfill is possible if you want one.)
- Bumping pdf.js or changing the analyzer's text extraction could change `pdftext1` values; the version prefix exists so
  you can introduce `pdftext2` rather than invalidating old ones.

## Dependencies / compatibility
- Loads JSZip 3.10.1 and pdf-lib 1.17.1 from cdnjs (pinned versions; same host your page already uses for pdf.js/JSZip).
- Needs Web Workers + OffscreenCanvas (Chrome/Edge/Firefox current, Safari 16.4+). Anything older silently uses the
  old behaviour (8 MB limit, original file).

## Tests
- `test/content-fingerprint.test.js` (41 checks), `test/doc-analyzer.test.js` (62 checks, 31 new for fingerprints).
- Browser-level (not included, run in a headless browser against the real backend): 30 end-to-end checks covering
  upload -> optimize -> permit -> store -> admin approve -> duplicate recognised.
