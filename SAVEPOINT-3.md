# Save point 3 — direct uploads + review-time page counting

This zip contains ONLY files added or changed in save point 3. Unzip over your repo root
(same relative paths), then do the three things below.

## 1. Delete these files (a zip can't carry deletions)
- `src/utils/pageCounter.js`
- `src/utils/previewSnippet.js`

## 2. Deploy order
1. `npm install` — drops `adm-zip`, `mammoth`, `unpdf` (no longer used anywhere) and adds
   `jszip` as a *dev* dependency (only used by `test/doc-analyzer.test.js`).
   Worker bundle: 4.5 MB / 948 KB gzipped  ->  1.05 MB / 185 KB gzipped.
2. `npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/003_direct_uploads.sql`
   (creates `upload_intents`; settles already-approved resources whose preview was still
   "pending" to "no preview" — they can no longer be computed on demand. Safe to re-run.)
3. `npm run deploy` (Worker), then deploy the `Frontend` folder to Vercel.
   Run the migration BEFORE the code.

Optional — nightly cleanup of abandoned uploads. Add to `wrangler.toml`:

    [triggers]
    crons = ["0 3 * * *"]

Without it nothing breaks: abandoned uploads are also cleaned up lazily whenever that same
user asks for a new upload permit. The cron just catches users who never come back.

## 3. Test on your side (things I could not verify without your Cloudinary account)
1. Upload a small PDF as a student. It should reach "submitted for review".
2. In the Cloudinary dashboard, confirm the file landed at `sharef_resources/<uuid>.pdf`
   (resource type: raw).
3. As admin, open it in the review queue (or the notification quick-review): the page
   count should be detected and prefilled, text shown. Edit the count if you like, approve.
4. As a student, open the approved resource's preview and download it.
If step 1 fails with "We couldn't find your uploaded file", my assumption about the raw-file
URL (`.../raw/upload/<public_id>` without a version) needs adjusting — tell me the response
and it's a one-line fix in `utils/cloudinaryUpload.js`.

## What changed
- Upload: `POST /resources/upload` (multipart, parsed in the Worker) is gone. Replaced by
  `POST /resources/upload/permit` (validates metadata, issues a signed permit for ONE
  server-chosen public_id) and `POST /resources/upload/complete` (one ranged request to
  Cloudinary checks size + file signature, then creates the resource). Completing twice, or
  at the same instant from two tabs, can never create two resources.
- Safeguards: max 3 unfinished permits per user, 20 permits/hour/user, 30-minute expiry,
  expired permits are purged together with their Cloudinary file, content is checked by magic
  bytes (a ZIP renamed `.pdf` is rejected and deleted).
- Page count + preview text: now computed in the reviewing admin's browser
  (`Frontend/doc-analyzer.js`, using pdf.js and JSZip from cdnjs). Approving requires a
  confirmed page count (1-1000); the server only range-checks it. The student preview is a
  plain column read.
- Removed: all Worker-side document parsing, the full-text extraction for admin preview, the
  lazy preview cache, the PDF page-count heuristic from save point 2.

## Behaviour notes
- Until review, a pending resource has `pages = 1` as a placeholder. Students never see it.
- A resource restored from "rejected" to "pending" is re-counted when re-approved.
- If the browser can't read a file (encrypted PDF, offline CDN, >25 MB), the admin types the
  page count manually; the approve button never blocks on a failed analysis.
- With "confirm before approval" turned OFF in admin settings, approving from the queue waits
  for the analysis and approves automatically if it succeeded; if not, it opens the modal.
- pdf.js / JSZip load from cdnjs.cloudflare.com on first review; admins need internet access
  to that host for automatic counting (manual entry still works without it).
