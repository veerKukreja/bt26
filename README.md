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

- **Streaming generation** — Claude's `write_files` tool returns the complete new source tree. Prompt caching on the system prompt + current VFS keeps per-turn latency low across a demo.
- **Sandboxed runtime** — Sandpack (CodeSandbox's in-browser bundler) compiles and runs generated React code in an iframe. Pre-bundled whitelist: `react`, `react-dom`, `framer-motion`, `lucide-react`.
- **Error recovery** — compile or runtime errors feed back to Claude for auto-retry (max 2). If retries exhaust, the preview silently reverts to the last known-good state. No white-screen-of-death during demos.
- **Timeline scrub** — every successful generation is a snapshot. Drag the scrubber at the bottom edge to rewind. `Cmd/Ctrl+Z` steps back one.
- **Fork URLs** — the Fork button in the top-right copies a shareable URL pointing at the current state. Anyone who opens that URL gets their own session forked from that point.
- **Live favicon + tab title** — generated components can post `{type:"prism:meta", title, favicon}` to the parent. The browser tab itself morphs as the page evolves. (Check the tab strip — it's how you know the magic is real.)

## Stack

- **Next.js 16 (App Router)** + TypeScript — server route for the Anthropic proxy, dynamic `/s/[sessionId]` routes
- **`@anthropic-ai/sdk`** — streaming Messages API with tool use, extended-thinking-ready, prompt caching markers on the system prompt and the current-files payload
- **`@codesandbox/sandpack-react`** — in-browser React/TypeScript runtime
- **localStorage** — session + snapshot persistence (per browser). Supabase wiring is in `lib/snapshots.ts` and opts in automatically when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.

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
