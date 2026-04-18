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
