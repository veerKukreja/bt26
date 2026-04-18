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

const ELEMENT_LISTENER_SCRIPT = `(function () {
  if (window.__prismListenerInstalled) return;
  window.__prismListenerInstalled = true;
  try { console.log("[prism-listener] installed at", location.href); } catch (e) {}
  try { window.parent.postMessage({ type: "prism:listener-ready" }, "*"); } catch (e) {}
  function selectorFor(el) {
    if (!el || el === document.body) return "body";
    var parts = [];
    var node = el;
    while (node && node !== document.body && parts.length < 8) {
      var tag = node.tagName.toLowerCase();
      var p = node.parentElement;
      if (p) {
        var sibs = [];
        for (var i = 0; i < p.children.length; i++) {
          if (p.children[i].tagName === node.tagName) sibs.push(p.children[i]);
        }
        if (sibs.length > 1) tag += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(tag);
      node = p;
    }
    return parts.join(" > ");
  }
  function describe(el) {
    if (!el) return { selector: "", tag: "empty", text: "", outerHTMLExcerpt: "", rect: { top: 0, left: 0, width: 0, height: 0 } };
    var r = el.getBoundingClientRect();
    var text = ((el.innerText || el.textContent || "") + "").replace(/^\\s+|\\s+$/g, "").slice(0, 200);
    var html = el.outerHTML || "";
    if (html.length > 600) html = html.slice(0, 600) + "...";
    return {
      selector: selectorFor(el),
      tag: el.tagName || "",
      text: text,
      outerHTMLExcerpt: html,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    };
  }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type !== "prism:queryElement") return;
    var el = document.elementFromPoint(d.x | 0, d.y | 0) || document.body;
    var info = describe(el);
    try {
      window.parent.postMessage({ type: "prism:elementInfo", requestId: d.requestId, target: info }, "*");
    } catch (err) {}
  });
})();`;

const DEFAULT_INDEX_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Prism</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0"><div id="root"></div></body>
</html>
`;

function injectListener(html: string): string {
  if (!html) return injectListener(DEFAULT_INDEX_HTML);
  if (html.indexOf("__prismListenerInstalled") !== -1) return html;
  const tag = "<script>" + ELEMENT_LISTENER_SCRIPT + "</script>";
  const headClose = html.indexOf("</head>");
  if (headClose >= 0) return html.slice(0, headClose) + tag + html.slice(headClose);
  // No </head> — insert at the top.
  return tag + html;
}

export function Preview({ files, versionKey, onError, onReady }: PreviewProps) {
  const sandpackFiles: Record<string, { code: string }> = {};
  for (const [path, code] of Object.entries(files)) {
    sandpackFiles[path] = { code };
  }
  // Always ensure /public/index.html has our listener. If the snapshot
  // doesn't provide one, Sandpack would fall back to its own default HTML
  // (no listener → popover stays on "locating…" forever).
  const existingHtml = sandpackFiles["/public/index.html"]?.code;
  sandpackFiles["/public/index.html"] = {
    code: injectListener(existingHtml ?? DEFAULT_INDEX_HTML),
  };

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
