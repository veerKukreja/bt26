#!/usr/bin/env node
// Verification harness for /api/ingest — runs without a dev server.
// Uses jiti to transpile the TS route and resolves the @/* alias.

import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import zlib from "node:zlib";

// Build a valid WxH solid-color PNG so Claude Vision accepts it.
function buildSolidPng(width, height, rgb = [220, 30, 60]) {
  const crc32Table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crc32Table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type = truecolor RGB
  // compression=0, filter=0, interlace=0
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => rgb).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const jiti = createJiti(import.meta.url, {
  alias: { "@": repoRoot },
  interopDefault: true,
});

const routeMod = await jiti.import(path.join(__dirname, "route.ts"));
const POST = routeMod.POST;

function mockReq(body) {
  const json = JSON.stringify(body);
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(json)),
    },
    body: json,
  });
}

async function expect(label, fn) {
  process.stdout.write(`• ${label} ... `);
  try {
    await fn();
    console.log("PASS");
  } catch (e) {
    console.log("FAIL");
    console.error(e);
    process.exitCode = 1;
  }
}

const ONLINE = process.argv.includes("--online");

await expect("rejects missing kind with 400", async () => {
  const res = await POST(mockReq({ hello: "world" }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Malformed request/);
});

await expect("rejects invalid url with 400", async () => {
  const res = await POST(mockReq({ kind: "url", url: "not-a-url" }));
  assert.equal(res.status, 400);
});

await expect("rejects non-http protocol with 400", async () => {
  const res = await POST(mockReq({ kind: "url", url: "file:///etc/passwd" }));
  assert.equal(res.status, 400);
});

await expect("rejects empty images array with 400", async () => {
  const res = await POST(mockReq({ kind: "images", images: [] }));
  assert.equal(res.status, 400);
});

await expect("rejects non-data-uri image with 400", async () => {
  const res = await POST(mockReq({ kind: "images", images: ["hello"] }));
  assert.equal(res.status, 400);
});

await expect("rejects malformed JSON with 400", async () => {
  const req = new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json {{{",
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
});

await expect("rejects oversized body with 413", async () => {
  const req = new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(3_000_000),
    },
    body: JSON.stringify({ kind: "url", url: "https://example.com" }),
  });
  const res = await POST(req);
  assert.equal(res.status, 413);
});

await expect("returns 502 on upstream fetch fail", async () => {
  const res = await POST(mockReq({ kind: "url", url: "http://127.0.0.1:1/nope" }));
  assert.equal(res.status, 502);
});

if (ONLINE) {
  console.log("\n--- Online acceptance tests (real Anthropic + network) ---");

  await expect("url ingest: example.com returns valid FeatureInventory", async () => {
    const start = Date.now();
    const res = await POST(mockReq({ kind: "url", url: "https://example.com" }));
    const elapsed = Date.now() - start;
    if (res.status !== 200) {
      const body = await res.text();
      throw new Error(`expected 200 got ${res.status}: ${body}`);
    }
    const inv = await res.json();
    assert.equal(typeof inv.summary, "string");
    assert.ok(inv.summary.length > 0, "summary is empty");
    assert.ok(Array.isArray(inv.features));
    assert.ok(Array.isArray(inv.userFlows));
    assert.ok(inv.designLanguage && typeof inv.designLanguage.typography === "string");
    assert.ok(Array.isArray(inv.designLanguage.palette));
    assert.ok(Array.isArray(inv.copyExamples));
    assert.ok(elapsed < 30_000, `took ${elapsed}ms`);
    console.log(`\n  elapsed=${elapsed}ms`);
    console.log(`  summary: ${inv.summary.slice(0, 160)}`);
    console.log(`  features: ${inv.features.length}, flows: ${inv.userFlows.length}`);
  });

  await expect("images ingest: synthesized PNG returns valid FeatureInventory", async () => {
    const png = buildSolidPng(240, 160, [30, 120, 220]);
    const dataUri = `data:image/png;base64,${png.toString("base64")}`;
    const start = Date.now();
    const res = await POST(mockReq({ kind: "images", images: [dataUri] }));
    const elapsed = Date.now() - start;
    if (res.status !== 200) {
      const body = await res.text();
      throw new Error(`expected 200 got ${res.status}: ${body}`);
    }
    const inv = await res.json();
    assert.equal(typeof inv.summary, "string");
    assert.ok(Array.isArray(inv.features));
    assert.ok(Array.isArray(inv.userFlows));
    assert.ok(inv.designLanguage && typeof inv.designLanguage.vibe === "string");
    assert.ok(Array.isArray(inv.copyExamples));
    assert.ok(elapsed < 30_000, `took ${elapsed}ms`);
    console.log(`\n  elapsed=${elapsed}ms`);
    console.log(`  summary: ${inv.summary.slice(0, 160)}`);
  });
}

console.log("\nDone.");
