import { test } from "node:test";
import assert from "node:assert/strict";
import LZString from "lz-string";
import { buildCodeSandboxUrl } from "./export";

test("buildCodeSandboxUrl returns a CSB define URL", () => {
  const files = {
    "/App.tsx": "export default function App(){return <div>hi</div>}",
    "/index.tsx": "import {createRoot} from 'react-dom/client';",
    "/package.json": JSON.stringify({ dependencies: { react: "19.2.4" } }),
  };
  const { url, overflow } = buildCodeSandboxUrl(files);
  assert.equal(overflow, false);
  assert.ok(url.startsWith("https://codesandbox.io/api/v1/sandboxes/define?parameters="));
});

test("buildCodeSandboxUrl payload round-trips to original files", () => {
  const files = {
    "/App.tsx": "export default function App(){return <div>hi</div>}",
  };
  const { url } = buildCodeSandboxUrl(files);
  const params = new URL(url).searchParams.get("parameters");
  assert.ok(params);
  const decoded = LZString.decompressFromBase64(params!.replace(/-/g, "+").replace(/_/g, "/"));
  const parsed = JSON.parse(decoded!);
  assert.ok(parsed.files["App.tsx"]);
  assert.equal(parsed.files["App.tsx"].content, files["/App.tsx"]);
});

test("buildCodeSandboxUrl signals overflow above 2MB encoded size", () => {
  const huge = "x".repeat(3_000_000);
  const { url, overflow } = buildCodeSandboxUrl({ "/App.tsx": huge });
  assert.equal(overflow, true);
  assert.equal(url, "");
});

import { exportFilename } from "./export";

test("exportFilename slugs summary, appends id prefix, honors extension", () => {
  const name = exportFilename({
    summary: "Tokyo Coffee Shop!!",
    id: "8f3a9e12-1234-abcd",
  }, "zip");
  assert.equal(name, "prism-tokyo-coffee-shop-8f3a9e12.zip");
});

test("exportFilename truncates long summaries to 40 chars", () => {
  const long = "a".repeat(80);
  const name = exportFilename({ summary: long, id: "abc12345-xyz" }, "html");
  // 40 + '-' + 8-char id = 49 + '.html'
  assert.ok(/^prism-a{40}-abc12345\.html$/.test(name), `got ${name}`);
});

test("exportFilename falls back to id when summary is empty", () => {
  const name = exportFilename({ summary: "", id: "abc12345-xyz" }, "zip");
  assert.equal(name, "prism-abc12345.zip");
});

import { unzipSync, strFromU8 } from "fflate";
import { buildZip } from "./export";

test("buildZip maps Sandpack paths to Vite src/ paths", async () => {
  const files = {
    "/App.tsx": "export default () => null;",
    "/index.tsx": "console.log('entry');",
    "/package.json": JSON.stringify({ dependencies: { "framer-motion": "^11" } }),
  };
  const blob = await buildZip(files, { summary: "test", id: "abc12345" });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const entries = unzipSync(buf);

  assert.ok(entries["src/App.tsx"]);
  assert.ok(entries["src/index.tsx"]);
  assert.ok(entries["package.json"]);
  assert.ok(entries["vite.config.ts"]);
  assert.ok(entries["index.html"]);
  assert.ok(entries["tsconfig.json"]);
  assert.ok(entries["src/main.tsx"]);

  assert.equal(strFromU8(entries["src/App.tsx"]), files["/App.tsx"]);
});

test("buildZip merges generated package.json deps into template deps", async () => {
  const files = {
    "/App.tsx": "export default () => null;",
    "/index.tsx": "",
    "/package.json": JSON.stringify({ dependencies: { "lucide-react": "^0.400.0" } }),
  };
  const blob = await buildZip(files, { summary: "test", id: "abc12345" });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const entries = unzipSync(buf);
  const pkg = JSON.parse(strFromU8(entries["package.json"]));

  assert.ok(pkg.dependencies.react, "react from template");
  assert.ok(pkg.dependencies["lucide-react"], "merged from generated");
});
