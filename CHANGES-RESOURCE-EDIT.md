# Admin: edit an uploaded resource's metadata

Admins can now correct what a student typed at upload time (title, type, course,
department, level, semester, session, description) on **Pending, Approved and
Rejected** resources, without rejecting and re-uploading. Approved resources can
also have their reviewed **page count** corrected.

## ⚠ Deploy the backend too
The editor calls a NEW endpoint. If you only upload the Frontend, the dialog will
open but saving will fail. Redeploy the Worker (`npm run deploy`). No database
migration is needed: it only updates existing columns.

## Backend (src/)
- `PATCH /api/admin/resources/:id` (admin only) — `controllers/adminResourceController.js`
  (`updateResourceMetadata`), route in `routes/adminResourceRoutes.js`.
- Validation reuses the upload rules (`validators/resourceValidators.js`,
  `updateResourceMetadataSchema`) so an edit can never store a value an upload
  would have refused. Every field is optional; send only what changed.
- Strict whitelist: ONLY the 9 metadata columns can change. Status, uploader, file,
  preview, downloads, rewards and review attribution (reviewed_by / reviewed_at /
  rejection_reason) can never be changed through this endpoint.
- `pages` is accepted only for approved resources (it is set by the reviewer at
  approval; it is a placeholder while pending). Whole request fails if it is sent
  for a pending/rejected item: nothing is half-saved.
- Only changed fields are written; `updated_at` is bumped. A no-op returns
  `changed: false`. If another admin changes the item's status mid-edit, you get a
  409 instead of a stale write.
- `GET /api/admin/resources/:id` now also returns `status` and `pages`.
- Test: `test/resource-edit.test.js` (42 checks). Run: `node test/resource-edit.test.js`

## Frontend
- New shared editor used by all three pages: `resource-editor.js` + `resource-editor.css`
  (centred dialog on desktop, bottom sheet on phones with a sticky Save bar).
- **Pending** (`admin-moderation`): "Edit" on every queue card, and "Edit details" inside
  the Preview modal (the preview header updates live after a save).
- **Approved / Rejected**: a pencil icon on every row (one tap from the list), plus
  "Edit Details" in the Details modal (the modal refreshes with the new values, or closes
  if the edit moved the item out of the current filter).
- The dialog: pre-fills from the server, marks changed fields "• edited", disables Save
  until something changes, validates before sending, shows server errors on the right
  field, asks before discarding unsaved changes, and never auto-focuses on touch screens.
- Fixed while here: the moderation keyboard shortcuts (A = approve, R = reject) no longer
  fire while you type in a form field or press Ctrl/Cmd+R (they would have approved a
  document while you typed an "a" into the title). The preview subtitle also no longer
  shows "&amp;" for titles containing "&".

## Not included (say if you want them)
- The uploader is NOT notified when an admin edits their resource's details.
- No edit history/audit log is kept (only `updated_at` changes).
- Editing a resource does not re-run reward/bounty logic; rewards already paid are unaffected.
