import { NextRequest } from "next/server";
import * as esbuild from "esbuild";
import path from "path";
import type { FileMap } from "@/lib/types";
import {
  STANDALONE_HTML_TPL,
  DEFAULT_FAVICON_DATA_URI,
  emojiFaviconDataUri,
} from "@/lib/export-templates";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

const MAX_OUTPUT_BYTES = 5_000_000;
const MAX_INPUT_BYTES = 2_000_000;

interface Body {
  files: FileMap;
  summary: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
      : c === "<" ? "&lt;"
      : c === ">" ? "&gt;"
      : c === '"' ? "&quot;"
      : "&#39;",
  );
}

function neutralizeScriptTags(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

function isValidBody(v: unknown): v is Body {
  if (!v || typeof v !== "object") return false;
  const b = v as { files?: unknown; summary?: unknown };
  if (!b.files || typeof b.files !== "object") return false;
  if (typeof b.summary !== "string") return false;
  for (const [k, val] of Object.entries(b.files)) {
    if (typeof k !== "string" || typeof val !== "string") return false;
  }
  return true;
}

function inMemoryLoader(files: FileMap): esbuild.Plugin {
  return {
    name: "prism-vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path, namespace: "vfs" };
        }
        if (args.path.startsWith(".")) {
          const importerDir = args.importer.replace(/\/[^/]+$/, "") || "/";
          const resolved = path.posix.resolve(importerDir, args.path);
          const candidates = [resolved, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}.jsx`, `${resolved}.js`];
          for (const candidate of candidates) {
            if (files[candidate]) return { path: candidate, namespace: "vfs" };
          }
        }
        return null;
      });
      build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
        const source = files[args.path];
        if (!source) return null;
        const ext = args.path.split(".").pop();
        const loader: esbuild.Loader =
          ext === "tsx" ? "tsx" : ext === "ts" ? "ts" : ext === "jsx" ? "jsx" : "js";
        return { contents: source, loader, resolveDir: "/" };
      });
    },
  };
}

function extractEmoji(text: string): string | null {
  const match = text.match(/\p{Extended_Pictographic}/u);
  return match ? match[0] : null;
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_INPUT_BYTES) {
    return new Response(JSON.stringify({ error: "Input too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }
  const raw = await req.json();
  if (!isValidBody(raw)) {
    return new Response(JSON.stringify({ error: "Malformed request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { files, summary } = raw;
  const entry = files["/index.tsx"] ?? files["/index.ts"];
  if (!entry) {
    return new Response(JSON.stringify({ error: "Missing /index.tsx" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await esbuild.build({
      entryPoints: ["/index.tsx"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "PrismApp",
      jsx: "automatic",
      target: "es2020",
      plugins: [inMemoryLoader(files)],
      logLevel: "silent",
      nodePaths: [path.resolve(process.cwd(), "node_modules")],
    });
    const js = result.outputFiles?.[0]?.text ?? "";
    if (js.length > MAX_OUTPUT_BYTES) {
      return new Response(JSON.stringify({ error: "Export too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
    const emoji = extractEmoji(summary);
    const favicon = emoji ? emojiFaviconDataUri(emoji) : DEFAULT_FAVICON_DATA_URI;
    const safeTitle = escapeHtml(summary.slice(0, 100) || "Prism Export");
    const safeJs = neutralizeScriptTags(js);
    const html = STANDALONE_HTML_TPL
      .replace("{{TITLE}}", safeTitle)
      .replace("{{FAVICON}}", favicon)
      .replace("{{BUNDLE_JS}}", safeJs);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="prism-export.html"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message.split("\n")[0] }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
