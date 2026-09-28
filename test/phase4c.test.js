import fs from "node:fs";
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log("OK  -", label);
    passed++;
  } else {
    console.log("FAIL-", label, extra);
    failed++;
  }
}

function freshEnv() {
  const DB = createMockD1(schemaSql);
  return {
    env: {
      DB,
      JWT_SECRET: "test-secret",
      CLOUDINARY_CLOUD_NAME: "sharef-cloud",
      CLOUDINARY_API_KEY: "fake-key",
      CLOUDINARY_API_SECRET: "fake-secret",
    },
    DB,
  };
}

async function tokenFor(env, id, role = "student") {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}

function seedUser(DB, { id, role = "student" }) {
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, role, is_verified, preferences) VALUES (?, ?, ?, ?, ?, 1, '{}')`)
    .run(id, `User ${id}`, `${id}@example.com`, "hash", role);
}

// Real hand-built single-page PDF with real extractable text "Hello World" —
// same one validated directly against unpdf/pageCounter earlier.
function buildRealPdfBytes() {
  const objects = {};
  objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objects[2] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  objects[3] =
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 144] /Contents 5 0 R >>\nendobj\n";
  objects[4] = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  const streamContent = "BT /F1 24 Tf 100 100 Td (Hello World) Tj ET";
  objects[5] = `5 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += objects[i];
  }
  const xrefStart = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

const realFetch = globalThis.fetch;
let cloudinaryUploadCalls = [];
function installCloudinaryMock({ fail = false } = {}) {
  cloudinaryUploadCalls = [];
  globalThis.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.cloudinary.com")) {
      cloudinaryUploadCalls.push({ url, opts });
      if (fail) {
        return new Response(JSON.stringify({ error: { message: "File size too large. Got 99999999. Maximum is 10485760." } }), {
          status: 400,
        });
      }
      return new Response(
        JSON.stringify({ secure_url: "https://res.cloudinary.com/sharef-cloud/raw/upload/v1/sharef_resources/abc123.pdf", public_id: "sharef_resources/abc123" }),
        { status: 200 }
      );
    }
    return realFetch(url, opts);
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

function buildUploadForm(fileBytes, fileName, fields = {}) {
  const form = new FormData();
  const file = new File([fileBytes], fileName, { type: "application/octet-stream" });
  form.append("file", file);
  const defaults = {
    title: "CSC301 Notes",
    type: "Lecture Note",
    department: "Computer Science",
    course: "CSC301",
    level: "300",
    semester: "First",
    session: "2024/2025",
    description: "Week 3 notes",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) {
    if (v !== undefined) form.append(k, v);
  }
  return form;
}

async function run() {
  // =========================================================================
  // Happy path — real PDF, mocked Cloudinary
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    installCloudinaryMock();

    const form = buildUploadForm(buildRealPdfBytes(), "notes.pdf");
    const res = await app.fetch(
      new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }),
      env
    );
    const body = await res.json();
    check("upload: 201 status", res.status === 201, JSON.stringify(body));
    check("upload: resource id returned", typeof body.resource?.id === "string");
    check("upload: pages counted correctly (1)", body.resource.pages === 1, body.resource.pages);
    check("upload: status is pending", body.resource.status === "pending");
    check("upload: Cloudinary was actually called once", cloudinaryUploadCalls.length === 1);

    const row = DB._raw.prepare("SELECT * FROM resources WHERE id = ?").get(body.resource.id);
    check("upload: resource row exists in D1", !!row);
    check("upload: file_url stored from Cloudinary response", row.file_url.includes("res.cloudinary.com"));
    check("upload: preview_type is pending (deferred to first view, not computed eagerly)", row.preview_type === "pending");
    check("upload: no preview snippet computed yet at upload time", row.preview_snippet === "");
    check("upload: status stored as pending", row.status === "pending");
    check("upload: uploader_id set correctly", row.uploader_id === "u1");

    const notif = DB._raw.prepare("SELECT * FROM notifications WHERE resource_id = ?").get(body.resource.id);
    check("upload: admin notification created (recipient NULL)", !!notif && notif.recipient_id === null && notif.type === "new_upload");

    restoreFetch();
  }

  // =========================================================================
  // No file provided
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    const form = new FormData();
    form.append("title", "No file here");

    const res = await app.fetch(
      new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }),
      env
    );
    check("upload: no file -> 400", res.status === 400);
  }

  // =========================================================================
  // Disallowed extension
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    const form = buildUploadForm(Buffer.from("just some bytes"), "malware.exe");

    const res = await app.fetch(
      new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }),
      env
    );
    const body = await res.json();
    check("upload: disallowed extension -> 400", res.status === 400, JSON.stringify(body));
    check("upload: disallowed extension message", body.message.includes("Unsupported file type"));
  }

  // =========================================================================
  // File too large (app's own 8MB cap)
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    const bigBytes = Buffer.alloc(9 * 1024 * 1024); // 9MB > 8MB cap
    const form = buildUploadForm(bigBytes, "huge.pdf");

    const res = await app.fetch(
      new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }),
      env
    );
    const body = await res.json();
    check("upload: over 8MB -> 400", res.status === 400, JSON.stringify(body));
    check("upload: size message matches original", body.message === "File too large. Max size is 8MB.");
  }

  // =========================================================================
  // Missing required fields -> zod validation errors, same shape as everywhere else
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    const form = buildUploadForm(buildRealPdfBytes(), "notes.pdf", { title: "", type: "NotARealType" });

    const res = await app.fetch(
      new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }),
      env
    );
    const body = await res.json();
    check("upload: validation -> 400", res.status === 400, JSON.stringify(body));
    check("upload: validation errors array", Array.isArray(body.errors));
    check("upload: flags empty title", body.errors.some((e) => e.field === "title"));
    check("upload: flags invalid type enum", body.errors.some((e) => e.field === "type"));
  }

  // =========================================================================
  // Cloudinary's own size-limit error surfaces as 413 with the friendly message
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    installCloudinaryMock({ fail: true });
    const form = buildUploadForm(buildRealPdfBytes(), "notes.pdf");

    const res = await app.fetch(
      new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }),
      env
    );
    const body = await res.json();
    check("upload: Cloudinary size error -> 413", res.status === 413, JSON.stringify(body));
    check("upload: friendly message shown", body.message.includes("too large for our current storage plan"));

    const rows = DB._raw.prepare("SELECT COUNT(*) as c FROM resources").get();
    check("upload: no resource row created on Cloudinary failure", rows.c === 0);

    restoreFetch();
  }

  // =========================================================================
  // PPTX and DOCX uploads use their real extraction paths too, not just PDF
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    installCloudinaryMock();

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    const slideXml = (text) =>
      `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    zip.addFile("ppt/slides/slide1.xml", Buffer.from(slideXml("Intro slide")));
    zip.addFile("ppt/slides/slide2.xml", Buffer.from(slideXml("Second slide")));
    const pptxBytes = zip.toBuffer();

    const form = buildUploadForm(pptxBytes, "deck.pptx", { type: "Revision Sheet" });
    const res = await app.fetch(
      new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }),
      env
    );
    const body = await res.json();
    check("upload: pptx -> 201", res.status === 201, JSON.stringify(body));
    check("upload: pptx page count = slide count (2)", body.resource.pages === 2);

    restoreFetch();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
