# Unified Hackathon Plan — Impact + Ideation Pipeline (Subagent-Parallel)

**Date:** 2026-04-18
**Revised:** 2026-04-18 — `feat/export` was merged into `main` plus 4 quality batches (security, a11y, correctness). This plan targets current `main`. The previously-mentioned `GenerateEvent` union has been deleted from `lib/types.ts` (commit `54ea128`); do not reference it.

**Scope:** Everything from the two prior plans, merged and restructured for maximum subagent parallelism.
**Supersedes:**
- `docs/superpowers/plans/2026-04-18-impact-hackathon-bundle.md`
- `docs/superpowers/plans/2026-04-18-ideation-pipeline.md`

**Source material:** `docs/IDEAS.md`, `docs/IDEAS-CONNECTIONS.md`.

## The optimization

Subagent parallelism breaks when two agents touch the same file. This plan reorganizes the underlying features into **14 subagent tasks grouped around file ownership** — each task owns its file outright, so every task in a phase can dispatch simultaneously without merge conflicts.

- **14 subagent tasks**.
- **4 phases** — wave by wave.
- **Wall-clock:** ~4 days instead of ~10 sequential.

```
PHASE 1  (8 parallel subagents — all new-file or single-owner, zero conflicts)
  ├─ P1  Ingest backend             → new  app/api/ingest/route.ts
  ├─ P2  Brainstorm backend         → new  app/api/brainstorm/route.ts + lib/brainstorm-prompt.ts + lib/brainstorm-client.ts
  ├─ P3  OG image route             → new  app/og/[sessionId]/route.ts
  ├─ P4  Language infrastructure    → new  lib/i18n.ts + lib/language.ts
  ├─ P5  Snapshots ephemeral        → edit lib/snapshots.ts (isolated)
  ├─ P6  Ideation UI shell          → new  components/BrainstormPane.tsx + ReferencesPanel.tsx + WriteupPanel.tsx
  ├─ P7  Generate route overhaul    → edit app/api/generate/route.ts (keyless + privacy + translate flag + writeup context; MUST preserve SSE contract)
  └─ P8  Print via export           → new  lib/print.ts (tiny wrapper over existing /api/export/html)

PHASE 2  (3 parallel subagents — hot-file integration, disjoint file ownership)
  ├─ P9   Orchestrator              → edit components/Prism.tsx (mode toggle + ephemeral + lang picker)
  ├─ P10  PromptBar consolidation   → edit components/PromptBar.tsx (voice + lang speech + writeup handoff + translate + print buttons)
  └─ P12  Layout                    → edit app/layout.tsx (OG meta + RTL dir attribute)

PHASE 3  (2 parallel subagents — backend-to-UI wiring, disjoint panels)
  ├─ P13  References panel wire     → edit components/ReferencesPanel.tsx (URL + image drop + compare) — uses HoverCard primitive
  └─ P14  Write-up panel wire       → edit components/WriteupPanel.tsx (intent + sections + regen + export) — models lib/writeup-export.ts on lib/export.ts pattern

PHASE 4  (1 subagent — end-to-end verification)
  └─ P15  Smoke test + screencast
```

## Codebase orientation (every subagent must read)

Prism is **Next.js 16 (App Router) + TypeScript + Anthropic SDK + Sandpack**. Dev server runs on port **9998** (`npm run dev` → `next dev -p 9998`).

**Key files (current `main`):**
- `app/api/generate/route.ts` — Claude proxy. **SSE-streaming.** Emits events: `tool_start` → `progress` (with `{chars, tail}`, repeated as the `write_files` tool JSON streams) → optional `text` → `usage` → `done` or `error`. Consumers depend on this contract.
- `app/api/export/html/route.ts` — esbuild-based standalone-HTML bundler (shipped Export feature).
- `app/api/snapshots/route.ts` — optional Supabase persistence (opt-in via `NEXT_PUBLIC_SUPABASE_URL`).
- `app/api/fork/route.ts` — optional Supabase fork.
- `app/page.tsx` — landing; redirects to `/s/{id}`.
- `app/s/[sessionId]/page.tsx` — main Prism UI.
- `components/Prism.tsx` — orchestrator. Uses `streamGenerate` from `lib/generate-client.ts`. Tracks usage in `prism:env:<id>` localStorage alongside `prism:session:<id>`. `persistEnabled` prop already exists — effectively an inverse of "ephemeral."
- `components/Preview.tsx` — full-viewport Sandpack.
- `components/PromptBar.tsx` — **mega-component (~600+ lines)**: prompt input + environmental usage tracker (HoverCard popover) + versions/snapshots dropdown + export dropdown (zip / HTML / CodeSandbox) + fork button + status indicator + toast. **Already instrumented for a11y** (role=menu, aria-haspopup, aria-live, aria-expanded, descriptive labels). Preserve those patterns in P10.
- `components/HoverCard.tsx` — reusable popover primitive. Use for tooltips, reference cards, menu panels.
- `lib/system-prompt.ts` — model contract (VFS conventions, dep whitelist).
- `lib/anthropic.ts` — SDK client + `WRITE_FILES_TOOL` schema.
- `lib/default-app.ts` — blank-canvas starter.
- `lib/snapshots.ts` — Supabase persistence (opt-in).
- `lib/types.ts` — shared types: `FileMap`, `Snapshot`, `Session`, `SessionUsage`. (The aspirational `GenerateEvent` union was removed in `54ea128` — don't add it back.)
- `lib/generate-client.ts` — SSE client wrapping `/api/generate` with a `GenerateCallbacks` interface (`onToolStart`, `onProgress`, `onText`, `onUsage`, `onDone`, `onError`). All UI calls to generate go through this — do not `fetch` the route directly. Parser is defensively typed (`54ea128`) — preserve that.
- `lib/env-usage.ts` — energy/water tracking per token. **Already implements Q10 from `docs/IDEAS.md` — do not duplicate.**
- `lib/export.ts` + `lib/export-templates.ts` — zip / standalone HTML / CodeSandbox exports. Print (P8) builds on this. `emojiFaviconDataUri` is exported from `export-templates.ts` (deduped in `54ea128`).
- `public/export-templates/` — Vite scaffold + standalone HTML template. HTML template escapes user content (security batch `80a9c03`).

**Deleted on current `main`:** `components/Timeline.tsx`, `components/ForkButton.tsx`. Their UI is inside `PromptBar.tsx`. Do not recreate them.

**IMPORTANT — non-standard Next.js.** Per `AGENTS.md`, this build has breaking changes. Before writing code that touches framework APIs (routing, route handlers, server actions, middleware, config), read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.

## Branch state

`feat/export` has been merged into `main`. All subagents branch from `main`.

**SSE contract is load-bearing.** Anything touching `/api/generate` (P7) or making UI calls to it (P10, others) must preserve the event order: `tool_start` → `progress` (repeated) → optional `text` → `usage` → `done` or `error`. Event names and payload shapes are consumed by `lib/generate-client.ts` and `components/PromptBar.tsx` — do not change them.

**Existing a11y posture is load-bearing.** Commit `943e046` added `role=menu`, `aria-haspopup`, `aria-live`, `aria-expanded`, `role=menuitem`, dynamic `aria-label`, Escape-restores-focus, and expanded click-outside to include panels. Any UI edit in P10 must preserve these.

**Security posture is load-bearing.** Commit `80a9c03` HTML-escapes export content, restricts favicons, and filters errors. Do not regress.

## Shared guardrails (every subagent)

- **Never** touch the Sandpack dep whitelist or the `write_files` tool contract unless your task explicitly requires it.
- **Never** add accounts, login, email capture, analytics, or third-party trackers.
- **Never** change the SSE event contract on `/api/generate`.
- **Never** regress the a11y patterns in `PromptBar.tsx`.
- **Keep comments sparse.** Use the PR description to explain decisions.
- **One branch per task.** Branch name: `hack/<task-id>-<short-name>` (e.g., `hack/p7-generate-route`).
- **File ownership is absolute.** If your task's scope lists files, you own them exclusively in this phase.
- **Test in a browser before claiming done.** Type-check and lint verify code; they don't verify behavior. Run `npm run dev`, walk through Acceptance Criteria, attach a screenshot or a 30s screencast to the PR.

## Impact story preserved (context for agents who want it)

The qualities from `docs/IDEAS.md`:
- **Keyless access + server quotas** (P7) unlocks every other impact claim.
- **Privacy by default** (P5, P7) — never regress with telemetry or "just this once" logging.
- **Multilingual + RTL** (P4, P9, P10, P12).
- **Accessibility** — preserve and extend existing a11y patterns.
- **Low-bandwidth** (P8, P12).
- **Carbon honesty** — already shipped via `lib/env-usage.ts`. Preserve.

---

# PHASE 1 — 8 parallel subagents

## P1 — Ingest backend

**Goal:** Server endpoint that accepts a URL or images and returns a structured `FeatureInventory` JSON.

**Owns:** `app/api/ingest/route.ts` (new).

**Scope:**
- `POST /api/ingest`, accepts `{ kind: "url", url: string }` OR `{ kind: "images", images: string[] }`.
- For URLs: server-side fetch; if a screenshot utility exists (check `lib/`), use it; otherwise pass URL text + Claude vision.
- Call Claude via `lib/anthropic.ts` with a task-specific system prompt requesting this JSON shape:
  ```ts
  type FeatureInventory = {
    summary: string;
    features: Array<{ name: string; description: string; priority: "table-stakes" | "differentiator" | "nice-to-have" }>;
    userFlows: Array<{ name: string; steps: string[] }>;
    designLanguage: { palette: string[]; typography: string; vibe: string };
    copyExamples: string[];
  };
  ```
- Export `FeatureInventory` from `lib/types.ts` (extend the shared types; do not redefine inline).
- Error handling: 400 invalid input, 502 upstream fetch fail, 500 Claude error.

**Acceptance:**
1. `curl` with a URL returns a valid `FeatureInventory` in <30s.
2. `curl` with base64 image(s) returns a valid inventory.
3. Invalid input → 400 with human-readable message.

---

## P2 — Brainstorm backend

**Goal:** Server endpoint that produces a structured `WriteUp` from intent (+ optional references), supports per-section regenerate.

**Owns:** `app/api/brainstorm/route.ts` (new) + `lib/brainstorm-prompt.ts` (new) + `lib/brainstorm-client.ts` (new).

**Scope:**
- `POST /api/brainstorm`, accepts:
  ```ts
  { intent: string; references?: FeatureInventory[]; mode: "full" | "section"; sectionKey?: string; previousWriteup?: WriteUp }
  ```
- Returns via SSE (match `/api/generate`'s pattern): `progress` events while streaming, `done` with full `WriteUp`, `error` on failure.
  ```ts
  type WriteUp = {
    title: string;
    problem: string;
    users: Array<{ persona: string; jobToBeDone: string }>;
    valueProp: string;
    features: { mustHave: string[]; shouldHave: string[]; couldHave: string[] };
    pages: Array<{ name: string; purpose: string; keyElements: string[] }>;
    copyDirection: string;
    visualDirection: string;
    risks: string[];
  };
  ```
- Export `WriteUp` from `lib/types.ts`.
- `mode: "full"` → stream full WriteUp. `mode: "section"` → stream only the named section.
- Prompt in `lib/brainstorm-prompt.ts`, under 2k tokens, cache-marked.
- `lib/brainstorm-client.ts` wraps the SSE fetch with a `BrainstormCallbacks` interface mirroring `GenerateCallbacks` (same defensive parsing as `54ea128`).

**Acceptance:**
1. Full mode streams a valid `WriteUp` in <30s with intermediate `progress` events.
2. References are incorporated when provided.
3. Section mode changes only the named section.
4. Invalid `sectionKey` → 400.
5. `lib/brainstorm-client.ts` exposes `onProgress`, `onDone`, `onError` callbacks consumed by P14.

---

## P3 — OG image route

**Goal:** Every Prism URL unfurls with a live-ish screenshot in social clients.

**Owns:** `app/og/[sessionId]/route.ts` (new). Does not edit `app/layout.tsx` — P12 wires meta tags.

**Scope:**
- `GET /og/[sessionId]` returns PNG.
- Prefer `@vercel/og` if it can render Sandpack output; otherwise render a styled card with session title + first prompt + latest prompt (document fallback in PR).
- Size 1200×630. Cache `max-age=3600`. Missing session → graceful fallback image, not 500.

**Acceptance:**
1. `curl -I /og/<id>` returns 200 with `content-type: image/png`, non-empty.
2. Image reflects session content.
3. Missing id returns a fallback, not 500.

---

## P4 — Language infrastructure

**Goal:** i18n scaffolding that all UI tasks will consume.

**Owns:** `lib/i18n.ts` (new) + `lib/language.ts` (new). Does not edit any components.

**Scope:**
- `lib/i18n.ts`: extract user-visible strings from `components/Prism.tsx`, `components/PromptBar.tsx` (the big one), and `app/page.tsx`. Seed 8 languages: English, Spanish, Haitian Creole, Mandarin, Arabic, Bengali, French, Russian. Machine-translated fine; mark `"mt"`. Export `t(key, lang)` + React context/provider.
- `lib/language.ts`: `detectLanguage()` from `navigator.language` with safelist; `isRTL(lang)` for Arabic/Hebrew/Farsi/Urdu; `speechLangCode(lang)` returning a BCP-47 tag for Web Speech API.

**Acceptance:**
1. `t("promptBar.placeholder", "es")` returns the Spanish string.
2. `isRTL("ar")` → true; `isRTL("en")` → false.
3. No component edits in this PR.

---

## P5 — Snapshots ephemeral support

**Goal:** `lib/snapshots.ts` accepts an ephemeral flag and becomes a no-op when ephemeral is on.

**Owns:** `lib/snapshots.ts` (edit).

**Scope:**
- Add an `ephemeral` boolean to persistence options.
- When `ephemeral === true`, writes are no-ops (no Supabase, no I/O).
- Reads still work for in-memory history in the current session.
- Add a doc comment describing the ephemeral contract.
- **Note:** main has two localStorage keys — `prism:session:<id>` and `prism:env:<id>`. The second is written from `components/Prism.tsx` (not `lib/snapshots.ts`) and is gated by P9. Mention this in your PR so P9 catches it.

**Acceptance:**
1. Ephemeral → no Supabase network request (DevTools check).
2. Non-ephemeral unchanged.

---

## P6 — Ideation UI shell

**Goal:** Three-panel brainstorm layout with empty sub-panels.

**Owns:** `components/BrainstormPane.tsx` + `components/ReferencesPanel.tsx` + `components/WriteupPanel.tsx` (all new). Does not edit `components/Prism.tsx` — P9 wires the toggle.

**Scope:**
- `BrainstormPane.tsx` renders two sub-panels: `ReferencesPanel` (left ~⅓), `WriteupPanel` (right ~⅔).
- Props: `references`, `writeup`, `onReferencesChange`, `onWriteupChange`.
- Placeholders in empty panels.
- Style matches Prism's glassmorphic aesthetic (check `PromptBar.tsx` conventions).

**Acceptance:**
1. Rendering with stub props produces the two-panel layout.
2. Placeholders show when props are empty.
3. No runtime errors with non-empty props.

---

## P7 — Generate route overhaul

**Goal:** Four concerns on `app/api/generate/route.ts` without breaking the SSE contract: keyless, privacy, translate variant, writeup context.

**Owns:** `app/api/generate/route.ts` (single owner).

**Critical constraint — SSE preservation:** The route streams `tool_start` → `progress` ({chars, tail}) → optional `text` → `usage` → `done`/`error`. `lib/generate-client.ts` and `PromptBar.tsx` consume these. Do not change event names, order, or payload shapes. New features add request-body fields or pre-stream behavior; they never alter the event stream.

**Scope:**
- **Keyless:** Add `SERVER_ANTHROPIC_API_KEY` env path. When set and request has no user key, use it. Keep existing `~/.anthropic-api-key` / `.env.local` fallback for self-hosters.
- **Quota (pre-stream):** Per-IP quota N/hour, M/day. In-memory LRU; document Redis is prod. On exceed, return **plain JSON 429** (not SSE).
- **Cost ceiling (pre-stream):** `SERVER_DAILY_COST_CEILING_USD`. On exceed, return **plain JSON 503**.
- **Abuse filter (pre-stream):** Reject prompts >10KB, reject injection probe phrases. Return 400.
- **Privacy logging:** Strip any `console.log`/`console.error` that includes user prompt text.
- **Translate variant:** Accept optional `{ translate: { toLanguage: string } }`. When present, system-prompt variant translates visible copy preserving structure/code/styling. Same SSE events.
- **Writeup context:** Accept optional `{ writeup: WriteUp }`. Inject into `messages[0].content` as a cache-marked text block ("The user has already planned this app. Build accordingly. Spec: <JSON>"). Same SSE events.
- Backwards compatibility: requests with neither new field unchanged.

**Do not touch:** `write_files` tool schema, Sandpack prebundle, retry logic (in `Prism.tsx`), or `lib/system-prompt.ts` (prefer constructing variant in-route).

**Acceptance:**
1. With `SERVER_ANTHROPIC_API_KEY` set and no user key, end-to-end generate works, SSE unchanged.
2. Quota → JSON 429 before stream opens.
3. Cost ceiling → JSON 503 before stream opens.
4. Server logs contain no user prompt text.
5. `translate.toLanguage = "es"` produces Spanish copy, layout intact.
6. `writeup` context produces output reflecting the spec (title + one must-have).
7. User-key path still works when server key unset.
8. `lib/generate-client.ts` needs no modifications.

---

## P8 — Print via export

**Goal:** Client helper that runs the current VFS through `/api/export/html` and opens the print dialog.

**Owns:** `lib/print.ts` (new). Does not build a parallel renderer.

**Scope:**
- `printCurrentSession(vfs: FileMap, options?: { paperSize?: "letter" | "a4" }): Promise<void>`.
- Calls `requestHtmlBundle(vfs)` from `lib/export.ts` for standalone HTML.
- Creates a hidden iframe, writes the HTML, injects `@media print` styles (hide interactive elements, `@page` size, 12pt body, `break-inside: avoid`).
- Calls iframe's `window.print()`, removes iframe after dialog.
- No separate print template — Export HTML is the base.

**Do not touch:** `lib/export.ts`, `app/api/export/html/route.ts`, or export templates.

**Acceptance:**
1. `printCurrentSession(vfs)` opens the print dialog with a clean render.
2. Letter and A4 margins render correctly.
3. No interactive UI in print preview.
4. Contact info / phone numbers don't clip across page breaks.

---

# PHASE 2 — 3 parallel subagents

All Phase 1 tasks merged before dispatch.

## P9 — Orchestrator

**Goal:** Wire mode toggle, ephemeral, language picker into `components/Prism.tsx`.

**Owns:** `components/Prism.tsx` (single owner).

**Depends on:** P4, P5, P6.

**Scope:**
- **`persistEnabled` handling:** either rename to `ephemeral` (inverted) or add a separate flag. Document the choice.
- State: `mode: "build" | "brainstorm"` (default `"build"`), `ephemeral`, `lang`, `references`, `writeup`.
- **Mode toggle** (segmented control, "Build" / "Brainstorm"). Brainstorm hides `Preview`, renders `<BrainstormPane />`.
- **Ephemeral toggle.** When on: pass `ephemeral: true` to `lib/snapshots.ts`, **and suppress writes to `prism:env:<id>` localStorage** (see `ENV_KEY(sessionId)`). Use `sessionStorage` for in-tab state. Show a visible "Ephemeral — nothing is being saved" badge.
- **Language picker** (top-right). On change, re-render via `t(key, lang)`. Persist to localStorage unless ephemeral.
- Replace hardcoded English strings with `t("…")`.
- Apply `dir="rtl"` at root when `isRTL(lang)` (coordinate with P12).

**Do not touch:** PromptBar, generate route, Preview.

**Acceptance:**
1. Mode toggle preserves state across toggles.
2. Mode persists non-ephemeral; resets ephemeral.
3. Both `prism:session:<id>` and `prism:env:<id>` are never written during ephemeral session.
4. `es-MX` → Spanish UI.
5. Arabic → RTL layout.

---

## P10 — PromptBar consolidation

**Goal:** Voice input + language-aware speech + writeup handoff + translate button + print button added to the existing mega-component. (Absorbs what was P11.)

**Owns:** `components/PromptBar.tsx` (single owner).

**Depends on:** P4, P7, P8.

**Heads-up:** PromptBar is already ~600+ lines with prompt input + env-usage tracker + versions dropdown + export dropdown + fork button + status indicator + toast. It's been through a11y and correctness passes. Read in full before editing. Every new control is a sibling of existing ones; do not refactor the existing structure. Preserve: `role=menu`, `aria-haspopup`, `aria-live`, `aria-expanded`, dynamic `aria-label`, Escape-to-restore-focus, click-outside including panels.

**Scope:**
- **Voice input:** Mic button left of send. `SpeechRecognition` / `webkitSpeechRecognition`; feature-detect and hide if unsupported. Pulsing indicator while recording. Live transcription into input field. Auto-stop on ~1.5s silence or second click. Uses `speechLangCode(lang)` from `lib/language.ts`.
- **Translate button:** Adjacent to Fork. HoverCard-based dropdown of languages (use existing `components/HoverCard.tsx`). On select, call `streamGenerate` with `{ translate: { toLanguage }, currentFiles }`. Preserve existing menu a11y patterns.
- **Print button:** Adjacent to Fork/Translate. Calls `printCurrentSession(vfs, { paperSize: "letter" })` from `lib/print.ts`. Optional HoverCard with Letter/A4 picker.
- **Writeup handoff:** Read `writeup` and `mode` from parent props. When `mode === "brainstorm"` and `writeup != null`, submit passes `{ writeup }` through `streamGenerate`. On success, callback to orchestrator flips mode back to `"build"`.

**Do not touch:** orchestrator, generate route internals (call via `streamGenerate`), env-usage tracker, export dropdown, fork behavior (add siblings only).

**Acceptance:**
1. Mic button renders in Chrome; hidden in Safari without `SpeechRecognition`.
2. Speaking fills the input.
3. Auto-stop within ~1.5s.
4. Brainstorm mode + writeup submit → generate with writeup; page reflects spec.
5. Translate → Haitian Creole produces a snapshot with Haitian Creole copy.
6. Print opens a clean print dialog.
7. All existing PromptBar features still work.
8. a11y patterns preserved on every new control.
9. After writeup-backed build, mode auto-switches to "build".

---

## P12 — Layout

**Goal:** Root HTML metadata: OG tags + RTL `dir` support.

**Owns:** `app/layout.tsx` (single owner).

**Depends on:** P3, P4.

**Scope:**
- `generateMetadata` for session routes: `og:image` → `/og/<sessionId>`; `twitter:card` → `summary_large_image`; `twitter:image` → same.
- Root `<html>` respects `lang` + `dir` (coordinate with P9 via context/cookie).

**Acceptance:**
1. View-source on `/s/<id>` shows valid OG tags.
2. Twitter/Facebook validators render the OG image.
3. Arabic → `<html dir="rtl">`.

---

# PHASE 3 — 2 parallel subagents

All Phase 1 + Phase 2 tasks merged before dispatch.

## P13 — References panel wire

**Goal:** `ReferencesPanel` does uploads, renders inventories, supports compare.

**Owns:** `components/ReferencesPanel.tsx`. May add `app/api/ingest/compare/route.ts`.

**Depends on:** P1, P6.

**Scope:**
- URL text input + Ingest button → `/api/ingest` with `{ kind: "url" }`.
- Drag-drop zone + file picker → `/api/ingest` with `{ kind: "images" }`.
- Append `FeatureInventory` to state via `onReferencesChange`.
- Render collapsed card (summary + feature count). **Use existing `components/HoverCard.tsx`** for expanded details.
- Expanded view: full feature list, flows, design language, copy examples.
- Delete button per card.
- **Compare (multi-upload):** with `references.length >= 2`, show Compare button. Call compare endpoint returning `{ intersection, union, gap }`. Render three lists above cards.

**Acceptance:**
1. URL ingest → card in <30s.
2. Three images → one combined card.
3. Delete removes card.
4. Compare with 2+ → three non-empty lists.
5. Errors → toast, not silent.

---

## P14 — Write-up panel wire

**Goal:** `WriteupPanel` generates/displays/edits/regenerates/exports write-ups.

**Owns:** `components/WriteupPanel.tsx` + `lib/writeup-export.ts` (new).

**Depends on:** P2, P6.

**Scope:**
- Intent textarea + Brainstorm button → `lib/brainstorm-client.ts` with `{ intent, references, mode: "full" }`. Render `progress` events as shimmer.
- Render `WriteUp` as editable sections. Small regenerate icon per section → section mode.
- Inline-editable text (blur to save via `onWriteupChange`).
- `lib/writeup-export.ts` — model on existing `lib/export.ts` pattern. Pure functions: `writeupToMarkdown(w)`, `writeupToGithubIssue(w)`.
- Two buttons on panel: Copy as Markdown, Copy as GitHub Issue. Reuse `copyToClipboard` from `lib/export.ts`. Show toast.
- Shimmer only affected section on regenerate.

**Acceptance:**
1. Intent → WriteUp in <30s with streaming shimmer.
2. Regenerate "users" updates only that section.
3. Inline edits persist across mode-toggle round trip.
4. Copy as Markdown → valid Markdown on clipboard.
5. Copy as GitHub Issue → valid GitHub-renderable Markdown.

---

# PHASE 4 — 1 subagent

## P15 — Smoke test + screencast

**Depends on:** Every prior task merged.

**Scope:**
- Walk the full end-to-end flow:
  1. Open Prism with no user API key (relies on P7 `SERVER_ANTHROPIC_API_KEY`).
  2. Switch browser language to Spanish; verify Spanish UI.
  3. Switch to Arabic; verify RTL.
  4. Back to English. Enable ephemeral.
  5. Brainstorm mode. Paste `https://stripe.com`. Drop 2 screenshots. Confirm inventory cards.
  6. Compare with 3 references. Verify three lists.
  7. Intent paragraph → WriteUp (verify shimmer). Regenerate users. Edit a line.
  8. Copy as Markdown. Paste into scratch — verify valid Markdown.
  9. Click Build. Verify page reflects WriteUp.
  10. Voice input follow-up. Verify update.
  11. Translate → Haitian Creole. Verify new snapshot.
  12. Click Print. Verify clean preview.
  13. Twitter card validator against session URL. Verify OG image.
  14. **Regression check:** fork, export dropdown (zip/HTML/CodeSandbox), env-usage HoverCard, versions dropdown, a11y (screen reader on menu items, Escape restores focus).
- Record 2-minute screencast.
- Attach screencast + pass/fail checklist to verification PR.
- File follow-up issues for any failures, land remaining passes.

**Acceptance:**
- All 14 steps pass in screencast.
- Verification PR merged.

---

# Done-ness

1. P1–P15 merged to `main`.
2. P15's screencast shows end-to-end + regression checks.
3. `docs/PRIVACY.md` reflects shipped behavior.
4. README updated with new defaults.

# Dispatching

See `docs/superpowers/plans/2026-04-18-dispatch-runbook.md`.

# Open questions

- **Env vars:** `SERVER_ANTHROPIC_API_KEY` and `SERVER_DAILY_COST_CEILING_USD` set on host?
- **Hosted target:** `raph.live` (current tunnel) or new deploy? Affects env var location.
- **Seed language list:** Default 8 languages; swap if partner org audience differs.
- **Screenshot utility:** check `lib/` + `package.json` before P1/P3 dispatch; document fallback otherwise.
- **Loading-indicator follow-up:** SSE infrastructure is present; out-of-scope for this plan, worth a follow-up.
