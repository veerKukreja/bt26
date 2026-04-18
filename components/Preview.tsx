"use client";

import {
  SandpackProvider,
  SandpackPreview,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { useEffect, useRef } from "react";
import type { FileMap } from "@/lib/types";

interface PreviewProps {
  files: FileMap;
  versionKey: string;
  onError: (message: string) => void;
  onReady: () => void;
}

function ErrorBridge({
  onError,
  onReady,
}: {
  onError: (m: string) => void;
  onReady: () => void;
}) {
  const { sandpack } = useSandpack();
  const readyRef = useRef(false);
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const attach = () => {
      const ids = Object.keys(sandpack.clients);
      for (const id of ids) {
        const client = sandpack.clients[id];
        if (!client) continue;
        const u = client.listen((msg: { type: string; action?: string; payload?: unknown }) => {
          if (msg.type === "action" && msg.action === "show-error") {
            const payload = msg.payload as { message?: string; title?: string };
            onError(payload?.message ?? payload?.title ?? "Unknown error");
          } else if (msg.type === "done") {
            if (!readyRef.current) {
              readyRef.current = true;
              onReady();
            }
          }
        });
        unsubs.push(u);
      }
    };
    attach();
    const interval = setInterval(() => {
      if (unsubs.length === 0) attach();
    }, 200);
    return () => {
      clearInterval(interval);
      unsubs.forEach((u) => u());
    };
  }, [sandpack, onError, onReady]);
  return null;
}

const PRISM_EDITOR_INDEX_TSX = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Render first — never block the page on the editor install.
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}

// PRISM_EDITOR_INSTALL — outer UI consumes the messages from here.
try {
  (function prismEditor() {
    if (typeof window === "undefined") return;
    var anyW = window;
    if (anyW.__prismEditorInstalled) return;
    anyW.__prismEditorInstalled = true;
    try { console.log("[prism-editor] installed"); } catch (e) {}
    try { window.parent.postMessage({ type: "prism:editor-ready" }, "*"); } catch (e) {}

    function selectorFor(el) {
      if (!el || el === document.body) return "body";
      var parts = [];
      var node = el;
      while (node && node !== document.body && parts.length < 8) {
        var tag = node.tagName.toLowerCase();
        var parent = node.parentElement;
        if (parent) {
          var sibs = [];
          for (var i = 0; i < parent.children.length; i++) {
            if (parent.children[i].tagName === node.tagName) sibs.push(parent.children[i]);
          }
          if (sibs.length > 1) tag += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
        }
        parts.unshift(tag);
        node = parent;
      }
      return parts.join(" > ");
    }
    function describe(el) {
      var rect = el.getBoundingClientRect();
      var text = ((el.innerText || el.textContent || "") + "").replace(/^\\s+|\\s+$/g, "").slice(0, 200);
      var html = el.outerHTML || "";
      if (html.length > 600) html = html.slice(0, 600) + "...";
      return {
        selector: selectorFor(el),
        tag: el.tagName,
        text: text,
        outerHTMLExcerpt: html,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      };
    }
    window.addEventListener("click", function (e) {
      if (!(e.target instanceof HTMLElement)) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({
        type: "prism:editor",
        event: "click",
        x: e.clientX,
        y: e.clientY,
        target: describe(e.target),
      }, "*");
    }, true);
    window.addEventListener("contextmenu", function (e) {
      if (!(e.target instanceof HTMLElement)) return;
      e.preventDefault();
      window.parent.postMessage({
        type: "prism:editor",
        event: "contextmenu",
        x: e.clientX,
        y: e.clientY,
        target: describe(e.target),
      }, "*");
    }, true);
  })();
} catch (e) {
  try { console.error("[prism-editor] install failed:", e); } catch (_) {}
}
`;

const PRISM_PACKAGE_JSON = JSON.stringify(
  {
    name: "prism-app",
    main: "/index.tsx",
    dependencies: {
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "framer-motion": "^12.0.0",
      "lucide-react": "^0.468.0",
    },
  },
  null,
  2,
);

export function Preview({ files, versionKey, onError, onReady }: PreviewProps) {
  const sandpackFiles: Record<string, { code: string }> = {};
  for (const [path, code] of Object.entries(files)) {
    sandpackFiles[path] = { code };
  }
  // Always inject the editor installer at /index.tsx, regardless of what the
  // generator produced. Guarantees shift-click / right-click work on every
  // snapshot, past or future, and Sandpack never falls back to its bare
  // default /index.tsx.
  sandpackFiles["/index.tsx"] = { code: PRISM_EDITOR_INDEX_TSX };
  // Ensure Sandpack's bundler uses /index.tsx as entry (some generations
  // produce a package.json without main, and the bundler falls back to
  // /src/index.tsx which our installer is NOT in).
  sandpackFiles["/package.json"] = { code: PRISM_PACKAGE_JSON };

  return (
    <SandpackProvider
      key={versionKey}
      template="react-ts"
      files={sandpackFiles}
      customSetup={{
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "framer-motion": "^12.0.0",
          "lucide-react": "^0.468.0",
        },
      }}
      options={{
        recompileMode: "immediate",
        classes: {
          "sp-wrapper": "prism-sp-wrapper",
          "sp-preview-container": "prism-sp-container",
          "sp-preview-iframe": "prism-sp-iframe",
        },
      }}
      style={{ height: "100%", width: "100%" } as React.CSSProperties}
    >
      <div style={{ position: "absolute", inset: 0 }}>
        <SandpackPreview
          showOpenInCodeSandbox={false}
          showRefreshButton={false}
          showRestartButton={false}
          showNavigator={false}
          showSandpackErrorOverlay={false}
          style={{ height: "100%", width: "100%", border: "none" }}
        />
        <ErrorBridge onError={onError} onReady={onReady} />
      </div>
    </SandpackProvider>
  );
}
