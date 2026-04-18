import { NextRequest } from "next/server";
import * as esbuild from "esbuild";
import path from "path";
import type { FileMap } from "@/lib/types";
import {
  STANDALONE_HTML_TPL,
  DEFAULT_FAVICON_DATA_URI,
} from "@/lib/export-templates";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

const MAX_OUTPUT_BYTES = 5_000_000;

interface Body {
  files: FileMap;
  summary: string;
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
          const importerDir = args.importer.replace(/\/[^/]+$/, "");
          const joined = (importerDir ? `${importerDir}/` : "/") + args.path.replace(/^\.\//, "");
          const candidates = [joined, `${joined}.tsx`, `${joined}.ts`, `${joined}.jsx`, `${joined}.js`];
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

function emojiFavicon(ch: string): string {
  return "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><text y='50' font-size='52'>${ch}</text></svg>`,
    );
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const { files, summary } = body;
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
    const favicon = emoji ? emojiFavicon(emoji) : DEFAULT_FAVICON_DATA_URI;
    const html = STANDALONE_HTML_TPL
      .replace("{{TITLE}}", summary.slice(0, 100) || "Prism Export")
      .replace("{{FAVICON}}", favicon)
      .replace("{{BUNDLE_JS}}", js);
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
