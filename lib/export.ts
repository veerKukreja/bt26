import LZString from "lz-string";
import type { FileMap } from "./types";

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
