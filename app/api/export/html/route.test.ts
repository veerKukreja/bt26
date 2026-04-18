import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";

function mockReq(body: unknown): Request {
  return new Request("http://localhost/api/export/html", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST returns an HTML bundle containing generated code", async () => {
  const files = {
    "/index.tsx": `import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);`,
    "/App.tsx": `export default function App(){ return <div>HELLO_FROM_EXPORT</div> }`,
    "/package.json": JSON.stringify({ dependencies: { react: "19.2.4", "react-dom": "19.2.4" } }),
  };
  const res = await POST(mockReq({ files, summary: "test export" }) as never);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /octet-stream/);
  const body = await res.text();
  assert.match(body, /HELLO_FROM_EXPORT/);
  assert.match(body, /<div id="root">/);
});

test("POST returns 413 when bundle exceeds size cap", async () => {
  const huge = `export default function App(){ return <div>${"x".repeat(6_000_000)}</div> }`;
  const files = {
    "/index.tsx": `import App from "./App"; console.log(App)`,
    "/App.tsx": huge,
    "/package.json": JSON.stringify({ dependencies: { react: "19.2.4", "react-dom": "19.2.4" } }),
  };
  const res = await POST(mockReq({ files, summary: "huge" }) as never);
  assert.equal(res.status, 413);
});
