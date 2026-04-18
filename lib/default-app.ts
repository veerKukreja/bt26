import type { FileMap } from "./types";

export const DEFAULT_APP: FileMap = {
  "/App.tsx": `import { useEffect, useState } from "react";

export default function App() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), 50);
    return () => clearInterval(id);
  }, []);
  const s = 1 + Math.sin(t / 10) * 0.15;
  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#fafafa", color: "#111",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: "#111", transform: \`scale(\${s})\`,
        boxShadow: "0 0 40px rgba(0,0,0,0.1)",
      }} />
    </div>
  );
}
`,
  "/index.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// PRISM_EDITOR_INSTALL — DO NOT REMOVE OR RENAME.
// Outer Prism UI listens for these messages to power element-level
// editing. Safe to ignore when running the exported build elsewhere.
(function prismEditor() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __prismEditorInstalled?: boolean };
  if (w.__prismEditorInstalled) return;
  w.__prismEditorInstalled = true;

  function selectorFor(el: Element): string {
    if (!el || el === document.body) return "body";
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && parts.length < 8) {
      let tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
        if (sibs.length > 1) tag += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(tag);
      node = parent;
    }
    return parts.join(" > ");
  }

  function describe(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || el.textContent || "").trim().slice(0, 200);
    let html = el.outerHTML || "";
    if (html.length > 600) html = html.slice(0, 600) + "...";
    return {
      selector: selectorFor(el),
      tag: el.tagName,
      text,
      outerHTMLExcerpt: html,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
  }

  window.addEventListener("click", (e) => {
    if (!e.shiftKey) return;
    if (!(e.target instanceof HTMLElement)) return;
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: "prism:editor",
      event: "click",
      x: e.clientX, y: e.clientY,
      target: describe(e.target),
    }, "*");
  }, true);

  window.addEventListener("contextmenu", (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    e.preventDefault();
    window.parent.postMessage({
      type: "prism:editor",
      event: "contextmenu",
      x: e.clientX, y: e.clientY,
      target: describe(e.target),
    }, "*");
  }, true);
})();

const el = document.getElementById("root")!;
createRoot(el).render(<App />);
`,
  "/public/index.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Prism</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0"><div id="root"></div></body>
</html>
`,
  "/package.json": JSON.stringify(
    {
      name: "prism-app",
      main: "/index.tsx",
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
    },
    null,
    2,
  ),
};
