import LZString from "lz-string";
import type { FileMap } from "./types";
import { zip, strToU8 } from "fflate";
import {
  VITE_PACKAGE_JSON,
  VITE_CONFIG_TS,
  VITE_INDEX_HTML,
  VITE_TSCONFIG_JSON,
  VITE_MAIN_TSX,
} from "./export-templates";

const CSB_DEFINE = "https://codesandbox.io/api/v1/sandboxes/define";
const CSB_MAX_PARAM_LEN = 2_000_000;

export function buildCodeSandboxUrl(files: FileMap): { url: string; overflow: boolean } {
  const payload = {
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => {
        const bare = path.startsWith("/") ? path.slice(1) : path;
        return [bare, { content }];
      }),
    ),
  };
  const json = JSON.stringify(payload);
  if (json.length > CSB_MAX_PARAM_LEN) {
    return { url: "", overflow: true };
  }
  const compressed = LZString.compressToBase64(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (compressed.length > CSB_MAX_PARAM_LEN) {
    return { url: "", overflow: true };
  }
  return { url: `${CSB_DEFINE}?parameters=${compressed}`, overflow: false };
}

export function exportFilename(meta: { summary: string; id: string }, ext: "zip" | "html"): string {
  const idPrefix = meta.id.slice(0, 8);
  const slug = meta.summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const body = slug ? `${slug}-${idPrefix}` : idPrefix;
  return `prism-${body}.${ext}`;
}

function mapPath(sandpackPath: string): string {
  const bare = sandpackPath.startsWith("/") ? sandpackPath.slice(1) : sandpackPath;
  if (bare === "package.json") return "package.json";
  return `src/${bare}`;
}

function mergePackageJson(generatedContent: string | undefined): string {
  const template = JSON.parse(VITE_PACKAGE_JSON);
  if (!generatedContent) return JSON.stringify(template, null, 2) + "\n";
  try {
    const gen = JSON.parse(generatedContent);
    template.dependencies = { ...template.dependencies, ...(gen.dependencies ?? {}) };
  } catch {
    /* ignore malformed generated package.json */
  }
  return JSON.stringify(template, null, 2) + "\n";
}

export function buildZip(
  files: FileMap,
  meta: { summary: string; id: string },
): Promise<Blob> {
  const tree: Record<string, Uint8Array> = {
    "vite.config.ts": strToU8(VITE_CONFIG_TS),
    "index.html": strToU8(VITE_INDEX_HTML),
    "tsconfig.json": strToU8(VITE_TSCONFIG_JSON),
    "src/main.tsx": strToU8(VITE_MAIN_TSX),
    "package.json": strToU8(mergePackageJson(files["/package.json"])),
  };
  for (const [path, content] of Object.entries(files)) {
    if (path === "/package.json") continue;
    tree[mapPath(path)] = strToU8(content);
  }
  return new Promise((resolve, reject) => {
    zip(tree, { level: 6 }, (err, data) => {
      if (err) return reject(err);
      resolve(new Blob([data], { type: "application/zip" }));
    });
  });
}
