# Consistency pass

Fixes for the inconsistencies found in the code review, in priority order, plus a consistent-data layer so that how a
user or admin *types* department, course, matric number, session, level, semester or type can no longer decide whether
they find (or are found by) the right resources.

Verified with `npm test`: **27 files, 1,330 checks**, including 101 new integration checks (`test/consistency.test.js`),
44 + 18 new unit checks for the normalisation rules, and the 1,156 pre-existing checks (a handful updated, see the end).

---

## Deploying this (existing database)

1. `npm run db:migrate:007:remote` - new columns + best-effort key back-fill. **Run before deploying the new code.**
2. `npm run deploy`.
3. Run the one-off normaliser (details in `GO-LIVE.md` §4b): `POST /api/admin/maintenance/normalize-academic-data`,
   `{"table":"resources"}` then `{"table":"users"}`, repeating with the returned `next` until `"done": true`.
4. Hard-refresh the frontend (new `academic.js`).

Step 3 matters: until it has run, rows keep whatever spelling they were typed in. They already *match* (by key), but
dropdowns may briefly show a variant, and an alias such as `CS` -> Computer Science only applies to rows it has visited.

---

## The fixes, highest priority first

### 1. Wrong current password logged the user out
`changeMyPassword` returned **401**; the frontend's `authFetch` treats every 401 as "session expired" and logs out.
Now **400** with a field error. *(userSettingsController)*

### 2. Bounty (request) type and level were never enforced
A "300 Level Past Questions" request could be claimed with any type or level for that course: the two sides use
different wording (`Past Questions` / `300 Level` vs `Past Question` / `300`) and only the course was compared.
One matcher, `bountyMatches()` in `incentiveConfig.js`, is now used at the permit, in the moderation-queue preview, at
payout time (a later admin edit can't create a false match) and in the student's "up to ₦X" chip. The upload page
pre-fills type and level from the request and warns *before* submit when the form won't match.

### 3. Profile save ignored the validated body
`updateMyProfile` read the raw JSON, so the email was never normalised: a student saving `John.Doe@Gmail.com` could no
longer log in (login looks up the normalised form). It now uses the validated body. The response also returns what was
*stored*, and Settings/Profile display that instead of what was typed. Also: matric duplicates are caught regardless of
case, and a unique-constraint race returns 409 instead of 500 (also on register).

### 4. Students saw raw rejection codes
`poor_quality`, `wrong_dept` were shown in the email, My Uploads and Notifications. One module,
`utils/rejectionReasons.js`, now holds codes and labels; students get labels. A rejection **requires** a valid reason
(400 otherwise). The notifications quick-reject now has a reason picker; the "log a reason later in Rejected Resources"
message was a dead end (no such UI or endpoint exists) and is gone.

### 5. A notification failure could undo an approval
Failures after the status flip (bad preferences JSON, failed insert) threw out of the approve handler: the admin saw a
500 for an already-approved resource and the reward was skipped. Notification is now isolated and best-effort.

### 6. Unbounded `limit` / `page`
`?limit=100000` loaded whole tables (and signed a download token per row); in SQLite a negative limit means *no limit*.
`utils/pagination.js` clamps everything (default/max per endpoint) and is used by the moderation queue, the admin
approved/rejected/users/transactions lists, recent and trending.

### 7. Admin date filters used UTC days
They disagreed with the Lagos-day counters (a 00:30 approval showed under the previous day) and an invalid date was a
500. Now Lagos days; an impossible date is a 400.

### 8. Deleted accounts dropped out of money totals
Transactions keep their history with a NULL user, but the summary `JOIN`ed users, so revenue under-reported after every
deletion (and disagreed with the Incentives summary). Now a `LEFT JOIN` with its own `deleted` bucket included in the
totals; the list shows "Deleted account".

### 9. Permanent delete didn't reverse rewards ("Remove" did)
It now reverses first and aborts (deleting nothing) if the reversal itself fails.

### 10. "Inactive" meant "didn't log in this week"
Sessions last 7 days, so a daily user looked inactive. `users.last_active_at` is now recorded by `protect.js` (at most
once an hour per student, one tiny UPDATE) and "inactive / active this week" use the later of login and activity.

### 11. Announcements had no validation
Zod schema (JSON, lengths, level list, max 40 departments - D1 allows 100 bound parameters). Audience is matched by
department **key**, and limited to **verified, non-suspended** students (an unverified address may belong to someone
else). The audience picker now lists the *students'* departments, so a department with students but no resources can be
targeted.

### 12. Re-downloads inflated popularity
A repeat download is still logged (My Downloads dates) but no longer bumps the public `downloads` counter; trending
counts distinct students.

### 13. Failed uploads locked students out
Three failed attempts held all three slots for 30 minutes. The browser now releases the permit on failure
(`POST /api/resources/upload/cancel`), and slots older than 10 minutes are reclaimed automatically.

### 14. Upload file types
The server, analyzer and tests support JPG/PNG but the picker didn't offer them: aligned the picker to the server. The
check is now on the extension (previously a matching MIME type alone could let a wrongly-named file through).

### Hygiene
Single `formatFileSize`; `LIKE` wildcards escaped everywhere; `npm test`; old patches/notes moved to `docs/archive/`;
stale README sections rewritten.

---

## Consistent data (your requirement)

Where it was broken: signup collects no department; the **Settings** page and the **Upload** form take free text; every
filter compared with `=`; pages built dropdowns from raw distinct strings and, when the profile department wasn't among
them, *added* a new option and selected it - an empty page. Fix, in three layers (`src/utils/academic.js`):

| Layer | What happens |
|---|---|
| **Write** | Canonical form stored: `Computer Science`, `CSC 305`, `CSC/2019/001`, `2024/2025`, `300`, `First`, `Past Question`. Accepts `300 Level`, `1st`, `2024-25`, `csc305`, `past questions`, `Dept. of Computer Science`, `&`/`and`, extra spaces, ALL CAPS. First spelling wins and later ones reuse it. |
| **Match** | All filters/search/"For you"/trending/announcements/admin lists compare `department_key` / `course_key`. Search is spacing-tolerant (`csc305` finds `CSC 305`). Query parameters are normalised too. |
| **Entry** | Type-ahead of spellings already in use on Settings, Profile and Upload (`GET /api/meta/options`); new ones can still be typed. |

On the frontend, `Frontend/academic.js` gives all records of a key one spelling, resolves the profile's department
through the key (so "computer science" lands on "Computer Science"), and makes search tolerant.

**Your example, as a test:** three students typed `Computer Science`, `computer science` and
`Dept. of  Computer   Sciences` (plus `CS`), an uploader typed `  computer   SCIENCE ` - all four see the resource under
"For you", and an engineering student does not.

---

## Decisions you may want to revisit

- **Rejecting now requires a reason**, and **announcements skip unverified/suspended students** (behaviour changes).
- **Repeat downloads** no longer raise `downloads` (intentional; say if you wanted the old meaning).
- **`DEPARTMENT_ALIASES`** is small (`CS`, `comp sci`, `maths`, `mass comm`...). Extend as you see real data.
- **A matric collision** found by the normaliser is reported, not overwritten.
- **Left alone on purpose:** PBKDF2 iterations (default 10,000; Workers allows up to 100,000 - raise
  `PBKDF2_ITERATIONS` only after checking CPU time on your plan), announcement emails still send inline (the ~50
  subrequest ceiling in the README), `API_BASE` is still hard-coded, and `level` is still `"300"` on some endpoints and
  `"300 Level"` on others (each page already matches its endpoint; unifying it would be a breaking API change).
- Admin user profile "Total spent" still includes the reward-funded part of purchases, while the transactions summary
  shows cash only. Different screens, arguably different meanings - not changed.

## How this was verified, and its limits

- The sandbox had no network, so `hono` and `@hono/zod-validator` were replaced by a small stand-in **outside the repo**,
  and `zod` by an available **3.x** copy (your project pins **4.x**). The baseline - your original tests - passed
  1,156/1,156 under that stand-in before any change, which is why I trust it, but **please run `npm install && npm test`
  once on your machine** to confirm under the real packages.
- Frontend: every file passes a syntax check and the shared helper has its own unit tests, but **no browser run was
  possible** here. Please click through Settings -> save, Upload (including a "Wanted" request), Resources and Lecture
  Notes as a student whose department is spelled differently, and the quick-reject modal as an admin.
- Existing tests changed because they asserted the old behaviour: wrong-password 401 -> 400; reject needs a reason;
  re-download counter; course stored as `CSC 301`; two fixtures that paired a "Past Questions" request with a Lecture
  Note upload (the hole itself); and the test DB gets a seeding-only trigger for the new key columns.
