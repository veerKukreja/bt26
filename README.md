# Prism

> Every website you've ever used was built once. This one is being built right now — by the person looking at it.

Prism is a self-modifying website. You land on a URL. You type what you want the page to become. Claude rewrites the actual React source code live, and the page hot-swaps in front of you. Keep describing changes — the page keeps morphing. A timeline at the bottom lets you scrub through every prior version. Click Fork to branch into a new URL that someone else can land on and keep editing.

The whole screen is the product. No chat sidebar. No IDE chrome.

## How it works

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                                                                        │
 │                  Sandpack iframe running Claude's code                 │
 │                                                                        │
 │                                                                        │
 │                                                                        │
 │                         Prism     ← onboarding                         │
 │             tell this page what to become                              │
 │                                                                        │
 │                                                                        │
 │    ┌───────────────────────────────────────────────────┐   [fork]      │
 │    │ tell this page what to become…              [ ↑ ] │               │
 │    └───────────────────────────────────────────────────┘               │
 │    ●───●───●───●───●         v5/5   · "it's a tokyo coffee shop"       │
 └────────────────────────────────────────────────────────────────────────┘
```

- **Keyless access** — when `SERVER_ANTHROPIC_API_KEY` is configured on the host, users don't need their own key. Per-IP quotas (30/hr, 200/day) and a daily cost ceiling prevent abuse. Self-hosters can still fall back to user-supplied keys.
- **Multilingual UI (8 languages)** — English, Spanish, Haitian Creole, Mandarin, Arabic, Bengali, French, Russian. Auto-detected from browser; manually switchable. Arabic renders RTL.
- **Ephemeral mode** — one toggle turns off every persistence surface (Supabase, localStorage snapshots, usage tracker, references, write-up). Session state uses `sessionStorage` while on. Visible badge. See [docs/PRIVACY.md](docs/PRIVACY.md).
- **Voice input** — mic button uses Web Speech API, language-aware (e.g., `es-ES` when UI is Spanish). Auto-stops after ~1.5s silence.
- **Translate button** — pick a target language, the current page is regenerated with translated user-visible text and the same layout.
- **Printable flyer** — print button opens a print dialog with paper-size-aware CSS (`@page`, hides interactive elements, `break-inside: avoid` for contact blocks).
- **Brainstorm mode** — switch to Brainstorm, drop URL/image references, generate a structured PRD (problem → users → features → pages → risks). Each section is inline-editable and per-section regeneratable. Export as Markdown or GitHub issue.
- **OG images** — every `/s/<id>` unfurls with a live-ish card in social clients.
- **Streaming generation** — Claude's `write_files` tool returns the complete new source tree. Prompt caching on the system prompt + current VFS keeps per-turn latency low across a demo.
- **Sandboxed runtime** — Sandpack (CodeSandbox's in-browser bundler) compiles and runs generated React code in an iframe. Pre-bundled whitelist: `react`, `react-dom`, `framer-motion`, `lucide-react`.
- **Error recovery** — compile or runtime errors feed back to Claude for auto-retry (max 2). If retries exhaust, the preview silently reverts to the last known-good state. No white-screen-of-death during demos.
- **Versions** — every successful generation is a snapshot. Click the `v3/5` pill in the prompt bar to open the versions dropdown; click any row to scrub. `Cmd/Ctrl+Z` steps back one.
- **Fork URLs** — the Fork button (in the prompt bar) copies a shareable URL pointing at the current state.
- **Live favicon + tab title** — generated components can post `{type:"prism:meta", title, favicon}` to the parent. The browser tab itself morphs as the page evolves. Favicons are restricted to `data:` URIs (no external HTTP leaks).
- **Honest session usage** — a muted `x Wh · y mL` indicator shows real token usage converted via published inference-energy estimates. No "vs competitors" framing; click for methodology + disclaimer.
- **MCP integration** — `mcp/` ships an MCP server that exposes Prism to Claude Desktop / Claude Code / Cursor / Cline (see [`mcp/README.md`](mcp/README.md)). The `@mcp` prompt prefix in the app makes Prism *consume* configured MCP servers (Figma, filesystem, etc.) to gather context before building (see [`mcp.config.example.json`](mcp.config.example.json)).

## Stack

- **Next.js 16 (App Router)** + TypeScript — server route for the Anthropic proxy, dynamic `/s/[sessionId]` routes
- **`@anthropic-ai/sdk`** — streaming Messages API with tool use, extended-thinking-ready, prompt caching markers on the system prompt and the current-files payload
- **`@codesandbox/sandpack-react`** — in-browser React/TypeScript runtime
- **localStorage** — session + snapshot persistence (per browser). Supabase wiring is in `lib/snapshots.ts` and opts in automatically when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.
- **esbuild** — standalone-HTML bundler lives on the server (`/api/export/html`) and the ingest/brainstorm endpoints parse+call Claude for structured JSON.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `SERVER_ANTHROPIC_API_KEY` | Server-side Anthropic key for keyless access | unset (falls back to user key / `~/.anthropic-api-key`) |
| `SERVER_DAILY_COST_CEILING_USD` | Daily spend cap before `/api/generate` returns 503 | `50` |
| `ANTHROPIC_MODEL` | Override the Claude model | `claude-sonnet-4-5` |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Opt-in persistence | unset |

## Run locally

```bash
# 1. Drop your Anthropic key in either place
echo "sk-ant-..." > ~/.anthropic-api-key
# or:
cp .env.local.example .env.local && $EDITOR .env.local

# 2. Install + run
npm install
npm run dev

# 3. Open http://localhost:9998 (redirects to a fresh /s/<uuid>)
```

## Demo script

- **0:00** Blank canvas. Onboarding hint: *tell this page what to become.* Type *"landing page for a coffee shop in Tokyo."*
- **0:15** Page morphs. Type *"make it feel like 3am."* Dark neon takes over. Tab title + favicon change. Audience notices the browser tab.
- **1:10** **Planned failure:** *"add Stripe checkout."* Generation fails. Red toast: "rolled back." Auto-reverts. *"okay, let me be less greedy — add a fake order button that pretends to work."* Works.
- **1:40** Drag the timeline scrubber left. Page rewinds through every state like a movie.
- **2:10** *"Fork from here — make it a sushi bar in Brooklyn instead."* New URL in the address bar. Copy it. AirDrop to a judge's laptop. Theirs now.
- **2:40** Close on the pitch line above.

## Project layout

```
app/
  page.tsx                   # landing; creates session, redirects to /s/{id}
  s/[sessionId]/page.tsx     # main Prism UI
  api/generate/route.ts      # Claude streaming proxy (write_files tool, caching)
  api/snapshots/route.ts     # optional Supabase persistence
  api/fork/route.ts          # optional Supabase fork
components/
  Prism.tsx                  # orchestrator: state, retries, history
  Preview.tsx                # full-viewport Sandpack
  PromptBar.tsx              # floating glass input
  Timeline.tsx               # scrubber
  ForkButton.tsx             # fork + clipboard
lib/
  system-prompt.ts           # model contract (VFS conventions, dep whitelist)
  anthropic.ts               # SDK, streaming, tool schema
  default-app.ts             # blank-canvas starter
  snapshots.ts               # Supabase persistence (opt-in)
```
