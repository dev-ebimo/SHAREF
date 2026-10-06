// Lightweight verification of a file that already lives on Cloudinary,
// WITHOUT downloading it (the Worker has 10 ms of CPU): one ranged request
// returns the first bytes (for a content-type check) and the total size.

const MAGIC = {
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  zip: [[0x50, 0x4b, 0x03, 0x04]], // PK..
  docx: [[0x50, 0x4b, 0x03, 0x04]],
  pptx: [[0x50, 0x4b, 0x03, 0x04]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
};

// ext is lowercase without the dot, e.g. "pdf".
export function matchesMagic(ext, head) {
  const signatures = MAGIC[ext];
  if (!signatures || !head) return false;
  return signatures.some((sig) => head.length >= sig.length && sig.every((b, i) => head[i] === b));
}

// Returns { size, head }. Throws if the file isn't reachable / size unknown.
// Works whether or not the CDN honours Range: if it answers 200 with the full
// body we only read the first chunk and cancel the rest.
export async function inspectRemoteFile(url) {
  const res = await fetch(url, { headers: { Range: "bytes=0-7" } });
  if (res.status !== 200 && res.status !== 206) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`File not reachable (status ${res.status})`);
  }

  let size;
  if (res.status === 206) {
    const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") || "");
    size = m ? Number(m[1]) : NaN;
  } else {
    size = Number(res.headers.get("content-length"));
  }
  if (!Number.isFinite(size) || size < 0) {
    await res.body?.cancel().catch(() => {});
    throw new Error("Could not determine file size");
  }

  const head = new Uint8Array(8);
  let got = 0;
  if (res.body) {
    const reader = res.body.getReader();
    while (got < 8) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, 8 - got);
      head.set(value.subarray(0, take), got);
      got += take;
    }
    await reader.cancel().catch(() => {});
  }
  return { size, head: head.subarray(0, got) };
}
