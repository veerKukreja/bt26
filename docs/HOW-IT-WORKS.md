# How Prism Works (as of `ai-revert-experiment` @ 91e4321)

A self-modifying website. You type what you want; Claude rewrites the running React source tree; Sandpack hot-swaps the iframe in front of you.

This document describes **the code as it currently runs**, end-to-end. Written after an extended debugging session where we rewired the AI layer multiple times — read this to catch up instead of re-deriving it.

---

## 1. The 30-second mental model

```
Browser
┌────────────────────────────────────────────────────────────────┐
│  /                        redirect → /s/<uuid>                 │
│                                                                │
│  /s/<sessionId>                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  <Prism/> (client component, orchestrator)              │   │
│  │  ├─ <PromptBar/>  ← input + status + history popover    │   │
│  │  └─ <Preview/>    ← Sandpack iframe running user's app  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  User types a prompt.                                          │
│  generate-client.ts POSTs directly to api.anthropic.com.       │
│  SSE deltas → onProgress → UI ticks.                           │
│  Final tool_use input → parsed → new FileMap.                  │
│  Preview remounts with new versionKey.                         │
└────────────────────────────────────────────────────────────────┘
```

Server-side is mostly pass-through. The AI call is now browser-direct because Next.js 16 dev's HTTP layer was starving SSE streams; fetch from the browser works fine.

---

## 2. What's where

### Routing (`app/`)

| Path | What it does |
|---|---|
| `app/page.tsx` | `/` — creates a new session ID (UUID or Supabase row) and redirects to `/s/<id>` |
| `app/s/[sessionId]/page.tsx` | Session page. Loads persisted snapshots (Supabase if configured, else defaults), server-renders, hands off to `<Prism/>` |
| `app/layout.tsx` | Root html + metadata |
| `app/og/[sessionId]/route.tsx` | Generates an OpenGraph image from the session's files (for link previews) |

### API routes (`app/api/*/route.ts`)

| Route | Still-hot? | Purpose |
|---|---|---|
| `/api/snapshots` | ✅ | POST appends a snapshot to a Supabase session (if Supabase is configured) |
| `/api/fork` | ✅ | Forks the current session at a snapshot into a new session |
| `/api/generate` | ⚠️ **dormant** | Original server-side Anthropic route. Code is intact but the client no longer calls it. Kept for reference and optional server-side fallback |
| `/api/brainstorm` | ✅ | Brainstorm mode's Anthropic call (still server-side; hasn't hit the fetch-stall issue — see "known issues") |
| `/api/ingest` | ✅ | Scrape a URL into a `FeatureInventory` for reference |

### Client orchestration (`components/Prism.tsx`, 1136 lines)

The god-component. Holds all session state:
- `snapshots: Snapshot[]` — history (loaded from Supabase or localStorage)
- `currentIndex: number` — which snapshot is shown
- `pendingFiles: FileMap | null` — buffered during generation, not yet committed
- `status: Status` — "idle" | "generating" | "fixing" | "rolledback" | "error"
- `sessionUsage: SessionUsage` — cumulative tokens across all runs
- `actions: ActionEntry[]` — history of runs (duration, tokens, prompt, summary)
- `references: FeatureInventory[]` — brainstorm reference material
- `writeup: WriteUp | null` — brainstorm output consumed as spec on first build
- `mode: "build" | "brainstorm"` — which UI is active
- `lang: SupportedLang` — i18n
- `ephemeral: boolean` — session is memory-only (no Supabase writes)

Key methods:
- `runGeneration()` — kicks off a Claude call via `streamGenerate()`, tracks progress, commits snapshot on success
- `stopGeneration()` — aborts via `AbortController`
- `handleSandpackError()` — auto-retries up to `MAX_RETRIES` (2) with error context, then rolls back to `lastGoodFilesRef`
- `handleSandpackReady()` — commits `pendingFiles` → snapshots, persists to Supabase if configured
- `commitSnapshot()` — writes to React state + (optionally) Supabase
- `handleFork()` — creates a new session from current state

### AI client (`lib/generate-client.ts`, 244 lines) — **THE important file**

This is the browser-side Anthropic client. **Browser → `api.anthropic.com` directly.** No Next.js server involved. Why we landed here: Next 16 dev's `fetch` (both Turbopack and webpack) was buffering/starving streaming responses server-side, causing ~45s hangs. Running fetch from the browser bypasses that entirely.

Flow:
1. `resolveApiKey()` reads `process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY` (inlined into the bundle at build time from `.env.local`)
2. Builds request body: system prompt, cache-controlled user content blocks (writeup, currentFiles, instruction), `write_files` tool, forced `tool_choice`, `stream: true`
3. POSTs to `https://api.anthropic.com/v1/messages` with `anthropic-dangerous-direct-browser-access: true` header
4. Reads `res.body` as a ReadableStream, decodes with TextDecoder, splits on `\n\n`, parses SSE event/data lines
5. Per Anthropic event type:
   - `message_start` / `message_delta` → accumulate usage
   - `content_block_start` → fire `onToolStart()`
   - `content_block_delta` with `input_json_delta` → append `partial_json` to `accumulatedJson`, fire `onProgress(chars, tail)`
6. After stream ends: `JSON.parse(accumulatedJson)` → files array → `onDone(files, summary)`

Constants:
- `MODEL = "claude-haiku-4-5"` (hardcoded)
- `max_tokens: 32000` (bumped from 8k after hitting malformed-JSON errors on large generations)

**Security warning**: the API key is in the browser JS bundle. This is a personal-dev setup. Don't deploy this live.

### Status bar helpers (`lib/generate-status.ts`)

Pure functions that turn raw stream state into human-readable phase strings:
- `extractLatestPath(tail)` — regex the last `"path": "..."` out of the streaming JSON tail (so the pill can say `writing App.tsx`)
- `derivePhase({ chars, tail, elapsedMs, ... })` — picks phase text based on state (MCP label → current file → "drafting plan" → rotating ambient phrases)
- `formatElapsed(ms)` — `42s` / `2m 15s`
- `estimateTokens(chars)` — `chars/4`

### PromptBar (`components/PromptBar.tsx`, 1479 lines)

The input pill at the bottom + all its popovers. Manages:
- Textarea with autoresize + Shift+Enter
- Status pill (click opens history popover)
- Translate menu (calls `submitTranslate()`)
- Fork button
- Export menu (ZIP / HTML / CodeSandbox)
- Versions popover (timeline scrubber)
- Speech recognition
- Toast + tooltips
- History popover: current-prompt card (with cancel button, turns amber if stalled) + per-action history entries from `actions[]`

Heartbeat ticker (650ms interval) drives re-renders while busy so elapsed time + ambient phase rotation keeps ticking even when no new SSE events arrive.

### Preview (`components/Preview.tsx`)

Wraps Sandpack. Listens for the iframe's `done` event to fire `onReady()` and `show-error` to fire `onError()`. Injects an element-listener script for the ElementEditor feature (click an element to ask Claude to tweak just that part).

### System prompt (`lib/system-prompt.ts`)

The instruction to Claude. Emphasizes: full multi-page websites over single-view demos, hash-based routing, localStorage persistence, semantic HTML, realistic content, working interactivity. Spans ~90 lines.

---

## 3. The generation pipeline end-to-end

1. **User types a prompt**, hits Enter in `PromptBar`.
2. `PromptBar.onSubmit(prompt)` → `Prism.submit(prompt)`.
3. `submit` sets up an `AbortController`, calls `runGeneration(prompt, currentFiles, null, 0)`.
4. `runGeneration` sets `status = "generating"` with `startedAt` timestamp, then calls `streamGenerate(args, callbacks)` from `lib/generate-client.ts`.
5. `streamGenerate`:
   - Grabs `NEXT_PUBLIC_ANTHROPIC_API_KEY` from the inlined env
   - Builds messages (system prompt, writeup if any, current files, user instruction)
   - POSTs to `api.anthropic.com`
   - Reads SSE chunks, fires callbacks per event
6. Back in `Prism.runGeneration`:
   - `onProgress(chars, tail)` → updates `status.chars`, `status.currentFile` (parsed from tail via `extractLatestPath`), `status.filesDone`
   - `onUsage(usage)` → accumulates into `sessionUsage`
   - `onDone(files, summary)` → stores files in `pendingFiles`, bumps `versionKey` to remount Sandpack with new files
7. `Preview` remounts with new `files` + `versionKey`.
8. Sandpack bundles + runs the new code. On `done` event → `handleSandpackReady()` → commits snapshot, persists to Supabase if configured, sets `status = "idle"`.
9. On Sandpack error:
   - `retryCount < 2` → calls `runGeneration(previousPrompt, lastGoodFiles, errorMessage, ++retryCount)` — Claude gets the error as context, tries to fix
   - `retryCount >= 2` → rolls back to `lastGoodFilesRef`, status briefly shows "rolledback"

An `ActionEntry` is written to `actions[]` after every run (success or fail) for the history popover.

---

## 4. Persistence model

Two modes, controlled by `ephemeral` state:

### Normal mode
- **Snapshots** → Supabase (if `NEXT_PUBLIC_SUPABASE_URL` + key are set) + `localStorage["prism:session:<id>"]`
- **Session usage** → `localStorage["prism:env:<id>"]`
- **Actions log** → `localStorage["prism:actions:<id>"]`
- **References / writeup / mode** → localStorage keyed per session
- **Language** → `localStorage["prism:lang"]` (global)

### Ephemeral mode
- Same, but uses `sessionStorage` (dies with tab close). Supabase writes are suppressed via `setEphemeral(true)`. Reads still hit Supabase so existing persisted sessions remain loadable.

### Forking
Takes the current `currentFiles` + current prompt, creates a new session with those as the starting snapshot. New UUID → new route → everything fresh.

---

## 5. Brainstorm mode

Alternate UI accessed via mode switcher. Lives in `BrainstormPane.tsx` + `ReferencesPanel.tsx` + `WriteupPanel.tsx`:
- Add URLs as references (scraped via `/api/ingest` into `FeatureInventory`)
- Generate a full `WriteUp` spec from the references via `/api/brainstorm` (still server-side, uses Anthropic SDK)
- On the next generation in build mode, the writeup is passed along and Claude uses it as the spec

This path *does* still use the Next server. It hasn't hit the fetch-stall issue — likely because those calls are one-shot, not long-lived streams, or because we haven't exercised them enough to notice. Could be migrated to browser-direct later using the same pattern as `generate-client.ts`.

---

## 6. MCP (Model Context Protocol) — currently dormant

The codebase has Phase A (Prism as MCP server, `mcp/bin.ts`) and Phase B (Prism consumes MCP servers, `lib/mcp-clients.ts`). Activated by prefixing a prompt with `@mcp `. Not currently used because the AI generation is now browser-direct, which can't reach Node's filesystem / MCP client pool. The server route `/api/generate` still has the wiring if you ever want to use MCP — you'd need to route back through the server for those requests.

---

## 7. Known issues / gotchas

### Why browser-direct AI calls?
Next 16 dev's patched `fetch` + its HTTP streaming layer starves Anthropic's SSE response after ~11 deltas. We tried: streaming SDK, non-streaming SDK, undici direct, undici via producer/consumer queue, Node native `https.request`, worker threads, non-SSE JSON response. Each fought a different layer. The decisive fix was **running fetch in the browser** — Next can't patch what it never sees. Remaining issues with streaming inside Next appear to be Turbopack-era regressions; may be fixed in future Next versions.

### API key exposure
`NEXT_PUBLIC_*` env vars are inlined into the client bundle at build time. Anyone loading the site can read your Anthropic key from devtools. `.env.local` is gitignored so it won't commit, but the built JS **will** contain the key. Personal-dev only.

### `max_tokens: 32000`
Originally 8k. Full app generations routinely exceed 8k tokens of tool-call JSON, so the SDK was returning truncated output → `JSON.parse` failed → user saw "malformed JSON". Bumped to 32k. Haiku 4.5 supports more; bump further if you hit it again.

### Sandpack kickstart
`Prism.tsx` has a deliberate "scrub cycle" on initial mount (scrub to version 0, then back to target) to work around a Sandpack edge case where single `versionKey` bumps don't force a remount reliably. See the comment block at the `useEffect` for the `kickstartedRef`.

### Hydration ordering
`useLayoutEffect` is used for the main hydration pass (`setHydrated(true)`) so `Preview` mounts exactly once with the right files. A plain `useEffect` lets the browser paint the server-rendered default first, causing a flash of the bouncing-dot placeholder.

---

## 8. Setup for a new device

```bash
git clone https://github.com/veerKukreja/bt26
cd bt26
git checkout ai-revert-experiment

# Write your Anthropic key
echo "NEXT_PUBLIC_ANTHROPIC_API_KEY=sk-ant-..." > .env.local

# Optional: Supabase persistence (otherwise localStorage only)
# echo "NEXT_PUBLIC_SUPABASE_URL=..." >> .env.local
# echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=..." >> .env.local

npm install
npm run dev
# open http://localhost:9998
```

The first generation will reveal whether the key is valid — any error message shows up in the status pill's error state.

---

## 9. File-by-file cheat sheet

```
app/
  page.tsx                   / → redirect
  layout.tsx                 root html + metadata
  s/[sessionId]/page.tsx     session page, loads snapshots, renders <Prism/>
  og/[sessionId]/route.tsx   OG image generator
  api/
    generate/route.ts        dormant — old server-side Anthropic route
    brainstorm/route.ts      server-side Anthropic call for writeup generation
    ingest/route.ts          URL → FeatureInventory scraper
    fork/route.ts            fork a snapshot into a new session
    snapshots/route.ts       append snapshot (Supabase)
    export/html/route.ts     bundle files → standalone HTML

components/
  Prism.tsx                  orchestrator (1136 lines)
  PromptBar.tsx              input + status + popovers (1479 lines)
  Preview.tsx                Sandpack wrapper
  BrainstormPane.tsx         brainstorm layout
  ReferencesPanel.tsx        reference management
  WriteupPanel.tsx           writeup generation/edit
  FileExplorer.tsx           list/open files in a panel
  ElementEditor.tsx          click-an-element-to-edit overlay
  Tooltip.tsx                custom grouped-hover tooltips
  HoverCard.tsx              reusable hover primitive
  ProjectStructure.tsx       tree viewer

lib/
  generate-client.ts         *** browser-direct Anthropic streaming (the heart of it)
  generate-status.ts         phase text + formatters for the status pill
  system-prompt.ts           SYSTEM_PROMPT + buildCurrentFilesMessage()
  types.ts                   FileMap, Snapshot, Session, ActionEntry, WriteUp, etc.
  default-app.ts             DEFAULT_APP seed files
  snapshots.ts               Supabase snapshot/session CRUD + ephemeral switch
  supabase.ts                supabase client factory
  anthropic.ts               server-side SDK setup (still used by brainstorm/ingest)
  env-usage.ts               token counting
  export.ts                  buildZip, buildCodeSandboxUrl
  export-templates.ts        HTML export scaffolding
  print.ts                   print-to-PDF helpers
  snapshots.test.ts, etc.    tests
  i18n.ts, language.ts       multilingual support
  brainstorm-client.ts       client for /api/brainstorm
  brainstorm-prompt.ts       brainstorm system prompts
  mcp-clients.ts             MCP client pool (dormant)

lib/prism-core/
  generate.ts                server-side streamGenerate (unused via main path)
  gather.ts                  MCP context-gathering pass
  index.ts                   re-exports

mcp/
  bin.ts, server.ts          Prism-as-MCP-server entry
  tools.ts                   MCP tool definitions
  storage.ts                 filesystem session store for MCP

scripts/                     smoke tests (Anthropic, Gemini, undici, worker)
docs/                        specs + this writeup
```

---

## 10. What to change where

**To change the AI model** → `MODEL` constant in `lib/generate-client.ts`.

**To change `max_tokens`** → same file.

**To tweak the system prompt** → `lib/system-prompt.ts`.

**To change the seed files** (new session blank state) → `lib/default-app.ts`.

**To add a new UI affordance in the prompt bar** → `components/PromptBar.tsx`.

**To change how snapshots are persisted** → `lib/snapshots.ts` + the useEffects in `components/Prism.tsx` that call `writeJson` with the `LS_KEY` family of keys.

**To enable server-side AI calls again** (if Next's streaming gets fixed) → revert `lib/generate-client.ts` to the version at `59a7ddb` (simple `fetch("/api/generate")` with SSE parsing). The server route is intact.
