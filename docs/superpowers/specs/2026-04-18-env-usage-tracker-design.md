# Session Environmental Usage Tracker — Design

**Status:** Approved for implementation
**Date:** 2026-04-18
**Scope:** Track real token usage from the `/api/generate` streaming response, convert to energy (Wh) and water (mL) estimates, display inline in the prompt bar with a methodology popup.

## Goal

Give the user an honest, transparent view of the environmental footprint of their current session. Numbers reflect **this session only**, derived from **real usage data** returned by the Anthropic API, converted using **published inference-energy estimates** with the methodology disclosed on click.

The point is honesty: the user sees what the session actually cost (roughly), not a performative "vs competitors" pitch.

## Non-goals

- No "saved vs competitors" framing. No comparison claims. Ever.
- No cross-session cumulative total. Each `/s/<id>` has its own counter.
- No backend persistence of usage data. Client-only, `localStorage`.
- No live-ticking counter during streaming. Updates on generation complete.
- No gamification, streaks, goals, achievements. Just two numbers + methodology.

## User flow

1. User lands on a fresh session. Prompt bar looks the same as today — no tracker visible.
2. User submits a prompt. Generation completes normally.
3. Tracker appears inside the prompt bar, left of the input, in small muted monospace: `0.8 Wh · 1.2 mL`.
4. User submits more prompts. Numbers increment after each generation.
5. User clicks the numbers. A `HoverCard` opens above the prompt bar showing:
   - Token breakdown (input / output / cache-read)
   - The exact formula
   - Sources for the constants
   - A disclaimer: "rough approximation from published inference estimates; not audited."
6. User navigates to a different session. Numbers reset (they're per-session).

## Architecture

### Server-side changes

`app/api/generate/route.ts` already consumes the Anthropic streaming API. The stream emits:

- `message_start` — initial usage snapshot
- `message_delta` — with `usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }` as output grows
- `message_stop` — final

The `message_delta` event carries cumulative usage for the entire response. We capture the final one and emit a new SSE event `usage` with that payload, **before** the existing `done` event.

### Client-side changes

- `lib/generate-client.ts` — adds `onUsage(usage)` to the event consumer options; parses the new `usage` SSE event.
- `lib/env-usage.ts` (new) — pure functions for computing energy + water from token counts, plus accumulation helper.
- `components/Prism.tsx` — new state `sessionUsage: SessionUsage`, persisted to `localStorage` under `prism:env:<sessionId>`. Merges with `onUsage` callback on each generation.
- `components/PromptBar.tsx` — accepts a new prop `usage: SessionUsage | null`. Renders the inline tracker + methodology popup when non-null and non-zero.

### Types

```ts
// lib/types.ts — append
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
```

### Conversion formulas

In `lib/env-usage.ts`:

```
effectiveTokens = inputTokens + outputTokens + cacheCreationTokens + 0.1 * cacheReadTokens
energyWh        = effectiveTokens * 0.0003       // 0.3 Wh per 1k tokens
waterMl         = effectiveTokens * 0.0005       // 0.5 mL per 1k tokens
```

### Constants and sources

Published in the methodology popup so the user can verify:

- **0.3 Wh per 1k tokens** — conservative estimate for Sonnet-class inference. Rounded up from published Epoch-AI / Anthropic ballpark figures (typically 0.1–0.3 Wh depending on token type).
- **0.1× multiplier for cache-read tokens** — matches Anthropic's pricing ratio for cached input (10% of fresh input cost), which tracks compute cost.
- **0.5 mL water per 1k tokens** — derived from ~1.5–1.8 mL per Wh industry average for data-center cooling (lower bound, conservative). Covers direct + indirect water use.

The disclaimer makes these explicit: *"rough approximation from published inference estimates; not audited."*

## UI details

### PromptBar tracker element

Inside the existing `<form>`, before the `<input>`:

```tsx
<button
  type="button"
  onClick={() => setMethodologyOpen((o) => !o)}
  ref={trackerRef}
  style={{
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "0 12px 0 0",
    fontSize: 11,
    fontFamily: "ui-monospace, monospace",
    color: "rgba(255,255,255,0.45)",
    whiteSpace: "nowrap",
    letterSpacing: "0.04em",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    marginRight: 10,
  }}
  aria-label="Environmental usage (click for details)"
>
  {energyWh.toFixed(energyWh < 1 ? 2 : 1)} Wh · {waterMl.toFixed(waterMl < 1 ? 2 : 1)} mL
</button>
```

Hidden entirely when `effectiveTokens === 0`.

### Methodology popup (HoverCard)

Content:

```
Session usage so far
────────────────────
  input          X,XXX tokens
  output         X,XXX tokens
  cache-read     X,XXX tokens
  cache-create   X,XXX tokens

Energy  ≈ (input + output + cache-create + 0.1 × cache-read) × 0.3 Wh/1k
Water   ≈ effective tokens × 0.5 mL/1k

Rough approximation from published inference
estimates; not audited.
```

Use the existing `HoverCard` component (`components/HoverCard.tsx`), anchored to the tracker button, `placement="top"`, `open` controlled by component state. Click-outside dismissal handled same as `ExportButton`.

### Persistence

- Key: `prism:env:<sessionId>`
- Value: `JSON.stringify(SessionUsage)`
- Written on every `onUsage` callback (after each generation).
- Loaded on component mount (`useEffect` with `sessionId` dep).
- Reset behavior: not needed — each session has its own key.

## File changes

### New files

- `lib/env-usage.ts` — pure conversion + accumulation functions
- `lib/env-usage.test.ts` — unit tests

### Modified files

- `lib/types.ts` — add `SessionUsage` type
- `app/api/generate/route.ts` — capture + emit `usage` SSE event
- `lib/generate-client.ts` — parse `usage` event; add `onUsage` callback
- `components/Prism.tsx` — state, persistence, wire into PromptBar
- `components/PromptBar.tsx` — accept `usage` prop; render tracker + methodology popup

### Untouched

- `components/Timeline.tsx`, `ExportButton.tsx`, `SnapshotHoverCard.tsx`, `HoverCard.tsx`, `ForkButton.tsx`, `Preview.tsx`
- All export feature code (`lib/export.ts`, `app/api/export/*`, `public/export-templates/*`)
- Session/snapshot state, generation pipeline, retry/fork logic
- Supabase persistence

## Verification

### Unit tests (`lib/env-usage.test.ts`, via `node --import tsx --test`)

- `computeUsage`: given a known `SessionUsage`, returns correct Wh and mL (boundary at 1,000 tokens = 0.3 Wh / 0.5 mL; fractional values round correctly).
- `accumulateUsage`: merging two `SessionUsage` objects sums all four fields.
- Zero-usage case: `computeUsage` returns `{ energyWh: 0, waterMl: 0 }` for empty input, and tracker UI hides when both are 0.

### Manual

1. Fresh session, no generations. Confirm tracker is NOT visible in PromptBar.
2. Submit one prompt, wait for generation. Confirm tracker appears with a non-zero Wh and mL value.
3. Submit another prompt. Confirm numbers increase (and don't reset).
4. Click the tracker. Confirm popup shows the 4-line token breakdown + formula + disclaimer.
5. Reload the page on the same `/s/<id>`. Confirm numbers persist.
6. Navigate to a fresh session. Confirm tracker is hidden (new session has no tokens yet).
7. Force a generation that triggers a retry (e.g., generate something with a deliberate syntax error via prompt engineering). Confirm the retried generation's usage is also tracked.

## Open implementation questions (decide during build)

- **`message_delta` vs `message_start` for the usage snapshot.** The stream's final `message_delta` carries the complete usage. If for some reason it's not present, fall back to `message_start`'s initial estimate. Flag if this is unreliable during smoke testing.
- **Browser `number.toFixed` vs `Intl.NumberFormat`.** For small-number formatting (0.03 Wh vs 1.2 Wh vs 12 Wh), `toFixed(energyWh < 1 ? 2 : 1)` gives adequate precision. No i18n needed.
- **Timing of "appears after first generation".** If the first generation fails entirely (e.g. network error), no `usage` event fires — tracker stays hidden. That's correct behavior but document it.
