# Prism Export — Design

**Status:** Approved for implementation
**Date:** 2026-04-18
**Scope:** Export any snapshot as a runnable artifact — zip, standalone HTML, or CodeSandbox URL

## Goal

Make any snapshot in a Prism session portable. The user should be able to take the page they just conjured and turn it into something they can keep building on (zip), share as a self-contained artifact (standalone HTML), or open in a hosted editor (CodeSandbox).

Export is a read-only consumer of the existing snapshot list. It does not change generation, persistence, or the Sandpack runtime.

## Non-goals

- Exporting a whole session history as a single artifact (no `versions/v1/`, `versions/v2/` bundle). The scope is one-snapshot-per-export.
- Deploying directly to Vercel / GitHub / Netlify from a button. Out of scope for v1; the zip and CSB link are the paths for that.
- Editing the export format per-user (no settings panel, no customization of scaffold).
- Custom domain / static hosting. User is responsible for where the HTML/zip goes next.

## User flow

One entry point: an **Export** icon button in the top-right, immediately left of the existing **Fork** button. Click opens a dropdown with three items:

1. **Download .zip** — Vite React-TS scaffold with snapshot files in `src/`. Streams a zip.
2. **Download .html** — single self-contained HTML file, server-bundled via esbuild. Works offline.
3. **Copy CodeSandbox link** — constructs a CodeSandbox `define` URL client-side, copies to clipboard, shows "copied" toast.

All three act on the **currently-displayed snapshot** (`currentFiles` in `Prism.tsx`).

A second entry point exists on every timeline dot: hover reveals a **`HoverCard`** containing the snapshot's version label, summary, and three export icons (zip / html / csb). Clicking any icon performs that export for **that snapshot**, without requiring the user to scrub to it first.

### Dropdown behavior

- Dismiss: click-outside, `Esc`, or selecting an item.
- While a background operation is in flight (html bundling, zip building), the clicked item shows an inline spinner and the menu stays open.
- On completion: download triggers automatically, menu closes.
- Errors surface as a red toast at the bottom (consistent with existing generation-error UX in `Prism.tsx`).

## Architecture

**Three surfaces. One shared export engine.**

### Client-side (zip + CodeSandbox link)

No server round-trip. Built in the browser.

- `fflate` (~8 KB gz, zero runtime deps) for zip construction.
- `lz-string` for CodeSandbox URL encoding — CSB's `/api/v1/sandboxes/define` endpoint accepts an LZ-string-compressed, URL-safe-base64 JSON payload via a `parameters` query arg.

### Server-side (standalone HTML)

- New route: `app/api/export/html/route.ts` (`runtime = "nodejs"`, `maxDuration = 15`).
- Accepts JSON `{ files: FileMap, summary: string }`.
- Transpiles and bundles the snapshot's code using `esbuild` with an in-memory loader plugin that resolves `./App`, `./index`, and other relative imports from the `FileMap`. Non-relative imports (`react`, `react-dom`, `framer-motion`, `lucide-react`) resolve from the project's `node_modules`.
- Inlines the bundled IIFE into `public/export-templates/standalone.html.tpl`, substituting `{{TITLE}}` (from `summary`), `{{BUNDLE_JS}}`, and `{{FAVICON}}` (first emoji in summary if present, else a default).
- Returns `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="prism-<shortid>.html"`.
- Output size cap: 5 MB; over-cap bundles return `{ error: "Export too large" }` with 413.

### Shared engine (`lib/export.ts`)

One module, three public functions. UI components do not know implementation details.

```ts
buildZip(files: FileMap, meta: { summary: string; createdAt: string }): Promise<Blob>
buildCodeSandboxUrl(files: FileMap): { url: string; overflow: boolean }
requestHtmlBundle(files: FileMap, summary: string): Promise<Blob>
```

Plus small helpers: `triggerDownload(blob, filename)`, `copyToClipboard(text)`.

## New components

All client components. Style matches existing glass aesthetic (`backdrop-filter: blur(12px)`, `rgba(20,20,20,0.85)` background, 1px `rgba(255,255,255,0.08)` border, 8px radius).

### `components/ExportButton.tsx`

Top-right icon button + dropdown menu. Mirrors `components/ForkButton.tsx` for visual consistency. Holds its own open/closed state and per-item in-flight state.

### `components/HoverCard.tsx`

Reusable primitive for hover-anchored floating cards. Props: `anchorRef`, `placement: "top" | "bottom"`, `openDelay`, `closeDelay`, `children`. Manages viewport clamping so cards don't overflow edges. Extracted generically because future element-level editing (sequencing item 3 on roadmap) will also need hover popovers — single reusable primitive, no rewrite later.

### `components/SnapshotHoverCard.tsx`

Composes `HoverCard` around a timeline dot. Contents:

- Version label (`v3 · 2m ago`) — monospace, small, 50% opacity.
- Summary or prompt fallback — one-line ellipsis, 70% opacity.
- Three icon buttons — zip / html / csb. Each is a one-click export; no nested dropdown.

### Modified: `components/Timeline.tsx`

Remove the native `title=` on line 73 and render a `SnapshotHoverCard` anchored to each dot instead.

### Modified: `components/Prism.tsx`

Add `<ExportButton>` next to the existing `<ForkButton>`. Pass the current `currentFiles` + the active snapshot's summary. No state-model changes.

## Dependencies

Three new. All small, stable, widely-used.

| Dep | Approx size | Where | Why |
|---|---|---|---|
| `fflate` | 8 KB gz | client | zip construction |
| `lz-string` | 4 KB gz | client | CSB URL encoding |
| `esbuild` | ~10 MB node | server only | HTML bundling |

Promote `esbuild` to an explicit `dependency` in `package.json` even though Next 16 ships with a transitive copy. Relying on a transitive dep in a user-facing route handler is fragile — any Next upgrade that drops the transitive leaves the feature broken in production.

## Data flow

### Zip

```
UI click → ExportButton / SnapshotHoverCard
  → lib/export.ts :: buildZip(files, meta)
    → path map: /App.tsx → src/App.tsx, /index.tsx → src/main.tsx, /package.json → merged into template package.json
    → load Vite scaffold template strings (inlined at build time from public/export-templates/vite/)
    → fflate.zipSync(mergedTree) → Uint8Array → Blob
  → triggerDownload(blob, `prism-<summary-slug>.zip`)
```

### CodeSandbox link

```
UI click → buildCodeSandboxUrl(files)
  → wrap into CSB payload shape: { files: { "App.tsx": { content }, "index.tsx": { content }, "package.json": { content } } }
  → lzString.compressToBase64 → URL-safe encode (/ → _, + → -, = stripped)
  → if encoded length > 2_000_000: return { url: "", overflow: true }
  → else: return { url: "https://codesandbox.io/api/v1/sandboxes/define?parameters=<payload>", overflow: false }
UI handles overflow=true by silently falling back to buildZip + download, toast: "Too large for CodeSandbox — downloaded .zip instead."
```

### HTML

```
UI click → requestHtmlBundle(files, summary)
  → POST /api/export/html { files, summary }
  → server:
    1. esbuild.build({
         stdin: { contents: files['/index.tsx'], loader: 'tsx', resolveDir: '/' },
         bundle: true, format: 'iife', globalName: 'PrismApp',
         jsx: 'automatic', jsxImportSource: 'react',
         plugins: [inMemoryLoader(files)]
       })
    2. Read public/export-templates/standalone.html.tpl
    3. Substitute {{TITLE}}, {{BUNDLE_JS}}, {{FAVICON}}
    4. If output.byteLength > 5_000_000: return 413 { error: "Export too large" }
    5. Return as application/octet-stream with Content-Disposition attachment
  → client receives Blob → triggerDownload(blob, `prism-<summary-slug>.html`)
```

## Error handling

| Failure | Surface | Retry |
|---|---|---|
| Client zip build error (rare — fflate is deterministic) | red toast: "Export failed" | No |
| CSB payload overflow | silent fallback to zip + toast: "Too large for CodeSandbox — downloaded .zip instead." | N/A (auto-handled) |
| HTML bundle: esbuild syntax/compile error | red toast with first line of error, e.g. "Export failed: Unexpected token at App.tsx:12" | No — signals real bug in generated code |
| HTML bundle: size cap exceeded (413) | red toast: "Export too large — try a smaller snapshot" | No |
| Network failure on HTML request | toast: "Couldn't reach export server — try again." | User-driven (click again) |
| Clipboard write denied (CSB copy) | toast: "Couldn't copy — here's the URL" + url shown inline | User-driven |

All toasts auto-dismiss after 4 seconds, matching existing `Prism.tsx` error toast behavior.

## Verification

No test framework in the repo today; verification is **minimal unit + manual**.

### Unit (`lib/export.test.ts`, run via `node --test`)

- `buildZip`: returned zip contains all expected paths; `package.json` deps merged correctly; `/App.tsx` lands at `src/App.tsx`.
- `buildCodeSandboxUrl`: URL starts with `https://codesandbox.io/api/v1/sandboxes/define?parameters=`; round-trips (decompress + parse) to an object whose `files` keys match the input.
- CSB overflow: a >2 MB input returns `{ url: "", overflow: true }`.

No new npm script added unless the user wants `npm test` — the skill allows ad-hoc `node --test lib/export.test.ts`.

### Manual (checklist for the implementation PR)

1. Generate any snapshot → click Export → `Download .zip` → extract → `npm install && npm run dev` → page loads on `localhost:5173` looking identical to the Sandpack preview.
2. Same → `Download .html` → drag the file onto a fresh Chrome window with DevTools → Network → Offline → page renders.
3. Same → `Copy CodeSandbox link` → paste into browser → sandbox loads with the same code, compiles green.
4. Hover a non-current timeline dot → card appears → click each of the three export icons → same three outcomes, for *that* snapshot.
5. Generate a deliberately large snapshot → trigger CSB overflow → confirm silent fallback to zip + "too large" toast.
6. Stop the dev server mid-HTML-export → confirm "Couldn't reach export server" toast, no infinite spinner.

## File changes

### New files

- `app/api/export/html/route.ts` — server HTML bundler
- `lib/export.ts` — shared export engine (zip, CSB URL, HTML request)
- `lib/export.test.ts` — unit tests for pure functions
- `components/ExportButton.tsx` — top-right button + dropdown
- `components/HoverCard.tsx` — reusable hover primitive
- `components/SnapshotHoverCard.tsx` — composes HoverCard for timeline dots
- `public/export-templates/standalone.html.tpl` — HTML template with `{{TITLE}}`, `{{BUNDLE_JS}}`, `{{FAVICON}}` slots
- `public/export-templates/vite/package.json`, `vite.config.ts`, `index.html`, `tsconfig.json`, `src/main.tsx` (shim re-exporting from generated `/index.tsx`) — Vite scaffold template files. The scaffold `index.html` must contain `<div id="root"></div>` and `<script type="module" src="/src/main.tsx"></script>` so the generated entry runs unmodified.

### Modified files

- `components/Timeline.tsx` — replace `title=` on timeline dots with `SnapshotHoverCard`
- `components/Prism.tsx` — render `<ExportButton>` alongside `<ForkButton>`; no state changes
- `package.json` — add `fflate`, `lz-string`; confirm `esbuild` is resolvable (promote to direct dep if needed)

### Untouched

- `lib/anthropic.ts`, `lib/system-prompt.ts`, `lib/snapshots.ts`, `lib/supabase.ts`, `lib/types.ts`
- `app/api/generate/route.ts`, `app/api/snapshots/route.ts`, `app/api/fork/route.ts`
- `app/page.tsx`, `app/s/[sessionId]/page.tsx`, `app/layout.tsx`
- All session/snapshot state management

## Open implementation questions (decide during build)

- **Vite scaffold versions.** Lock React 19.2 and Vite 5.x in the scaffold `package.json`, matching what Prism runs.
- **`lucide-react` tree-shaking in the HTML bundle.** Default esbuild config will tree-shake; confirm the output bundle doesn't include the full icon set. If it does, configure `external` or use per-icon imports only.
- **CodeSandbox file paths.** CSB uses bare filenames (`App.tsx`) in the `define` payload; our VFS uses `/App.tsx`. Strip leading `/` during payload construction.

## Conventions

- **Filename slugging.** Zip/HTML download filenames derive from the snapshot's `summary`: lowercase, replace non-alphanumeric runs with single `-`, trim leading/trailing `-`, truncate to 40 chars, and append an 8-char prefix of the snapshot `id`. Example: `prism-tokyo-coffee-shop-8f3a9e12.zip`. If `summary` is empty, use `prism-<id-prefix>`.
- **Favicon default.** If `summary` contains no emoji, the standalone HTML falls back to the Prism square-prism glyph (inline SVG data URI in the template — pick a single character like `◆` or use the existing favicon asset).
- **Interaction model is desktop-only.** Hover-driven UX (`SnapshotHoverCard`) is not designed for touch. On touch, the primary `ExportButton` still works; the per-snapshot path is not essential for mobile demos. Document this in `SnapshotHoverCard.tsx` header comment.

These are best resolved with the bundler running, not in spec. The implementation plan should surface them as checkpoints, not block design approval.
