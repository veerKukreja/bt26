# Prism — Impact Through App Design

How Prism-the-app (not the pages people build with it) can be shaped to matter. Every default in the app today silently decides who Prism is for.

## The frame

Most "AI for good" projects are judged on what users make. The real impact signal lives upstream of that: **who is allowed to use the tool in the first place, and on what terms.** A self-modifying website that demands an Anthropic API key, breaks without JS, ships 2MB of tracking, and only speaks English has already decided it's not for the flood survivor, the Bengali mother, the tenant on a cracked Android, the activist routing through Tor, the blind user on a screen reader, the kid in a library computer lab.

Changing those defaults *is* the impact story. You don't need to invent new use cases — you need to remove the assumptions that keep current use cases gated.

## The rubric

- **Impact** — who does this unlock? `Niche` / `Broad` / `Systemic`.
- **Hackathon build** — focused hours on top of current Prism. `½ day` / `1 day` / `2 days` / `>2 days`.
- **Risk** — one sentence on how this goes wrong.

---

## Part 1 — Qualities (how Prism should behave by default)

### Q1. No API key required to use Prism

Today Prism demands the user supply their own Anthropic key. This gates 99% of humans out. A hosted Prism must run on a server-side key with per-IP / per-session quotas, hard monthly caps, and abuse detection — so a teacher, a flood volunteer, a kid in a library can just *open the URL and go*.

- **Impact:** Systemic. The single biggest barrier to every other impact claim.
- **Hackathon build:** 1 day.
- **Risk:** Cost runaway / abuse at scale. Mitigate with quota caps day one and a circuit breaker.

### Q2. Privacy by default, not opt-in

Prompts and generated pages must not be logged for analytics, used for training, shared with third parties, or persisted beyond the current session unless the user explicitly saves. This matters most for the people who need Prism most: someone researching abortion access, an organizer on a watchlist, an abused partner trying to leave, a trans teen, an undocumented neighbor.

- **Impact:** Systemic.
- **Hackathon build:** ½ day (audit current logging, strip prompt text, visible "nothing is stored" footer, disable Supabase writes unless explicitly opted in).
- **Risk:** Losing telemetry makes debugging harder. Solve with sampled synthetic traffic, not real prompts.

### Q3. Accessible by default — Prism's UI and the pages it generates

Two commitments:
1. **Prism's own UI** passes WCAG AA: keyboard nav, screen-reader-readable prompt bar and controls, reduced-motion honored, focus states visible, no color-only signaling.
2. **Generated output** biases toward accessible HTML by default (semantic tags, alt text, contrast, 16pt+ body, heading hierarchy). Baked into the system prompt.

- **Impact:** Broad–Systemic. 15–20% of the population has a disability; almost none can use the average "self-modifying website" demo today.
- **Hackathon build:** 1 day.
- **Risk:** Claiming and not delivering. Mitigate with an actual screen-reader audit in the demo, not a TODO.

### Q4. Multilingual by default

The prompt bar accepts any language. The UI ships in 10+ languages on day one (auto-detect + manual override). Every generated page has a one-click "fork as translation to [language]" button. English is not the default; the user's browser language is.

- **Impact:** Systemic. ~75% of the world doesn't speak English primarily.
- **Hackathon build:** 1 day.
- **Risk:** Partial localization (UI English but output translated, or vice versa) feels worse than either extreme.

### Q5. Low-bandwidth and offline-capable output

Generated pages must work on a 3-year-old Android on 2G:
- Default to system fonts, no large frameworks unless requested, lazy-loaded images.
- "Print this page" produces a clean paper flyer.
- "Save for offline" produces a self-contained single HTML file.

- **Impact:** Systemic. This is who the next billion internet users are.
- **Hackathon build:** 1 day.
- **Risk:** Low-bandwidth fights rich visual output; resolve with explicit "high-fidelity" vs "resilient" modes.

### Q6. Open source, self-hostable, no cloud vendor lock-in

Prism runs on a single VPS, a laptop, a Raspberry Pi in a community center. No Vercel-only features, no Supabase-required paths. An organizer in a place with flaky infrastructure or hostile politics can run their own.

- **Impact:** Systemic. This is how Prism survives takedowns, API price changes, and the 10-year enshittification arc.
- **Hackathon build:** ½ day to audit + document self-host steps; discipline going forward.
- **Risk:** Temptation to add cloud-specific shortcuts for speed. Resist.

### Q7. Tor-friendly and VPN-friendly

No IP-based gating. No "suspicious traffic" blocking that punishes users on Tor, shared NAT, or regions with heavy VPN usage. Cloudflare's default WAF rules will break this — it must be an explicit config choice.

- **Impact:** Broad. Journalists, activists, abuse survivors, users in authoritarian regimes.
- **Hackathon build:** ½ day.
- **Risk:** Some abuse opens up. Mitigate at the application layer (per-session quota), not network layer.

### Q8. No dark patterns, no surveillance, no upsell

No modal nags, "sign up to save," email capture, Google referrer tracking, FB pixels, push notifications, "are you sure you want to leave" prompts. The tool works. It does not extract.

- **Impact:** Cultural more than measurable, but it compounds.
- **Hackathon build:** ½ day to audit and strip. Then say no every time someone proposes adding one.
- **Risk:** Institutional drift over time.

### Q9. Data portability and a real delete button

One click exports every session, every snapshot, every prompt, as a zip. One click deletes them all. No retention grace period.

- **Impact:** Broad.
- **Hackathon build:** ½ day (reuses Export infrastructure).
- **Risk:** Low.

### Q10. Carbon and energy honesty

Default to the smallest Claude model that produces acceptable output. Expose the per-session energy cost. Don't greenwash — be truthful, including when Prism is expensive.

- **Impact:** Niche but culturally significant; meaningful for school/nonprofit audiences.
- **Hackathon build:** 1 day (model-tier routing + counter). **Already shipped** via `lib/env-usage.ts` — preserve it.
- **Risk:** Smaller models produce worse output. Needs a sensible routing heuristic.

---

## Part 2 — Features (concrete additions that embody the qualities)

### F1. Voice input (and optional voice output)

Web Speech API in the prompt bar. Press-to-talk. Transcribes live.

- **Impact:** Broad. Preliterate, ESL, blind, dyslexic, kids, elderly, RSI sufferers.
- **Hackathon build:** ½ day.
- **Risk:** Patchy browser support (esp. mobile Safari). Keyboard fallback.

### F2. Ephemeral / "panic" mode

Toggle that turns on an incognito session: no Supabase write, no localStorage write, no server-side prompt logging, auto-destruct on tab close, visible indicator.

- **Impact:** Systemic. This is the mode an abortion seeker, abuse survivor, whistleblower needs.
- **Hackathon build:** 1 day.
- **Risk:** False sense of security. Be specific about what it does and doesn't protect against (does not defeat screen recording, browser forensics, shared devices — say so plainly).

### F3. Metadata stripping on every share

When a user forks or exports, strip EXIF from images, strip analytics IDs, strip Prism-internal telemetry.

- **Impact:** Broad. Matters for survivors, organizers, anyone at risk of being doxxed.
- **Hackathon build:** ½ day.
- **Risk:** Low.

### F4. Fork-as-translation

One-click button adjacent to Fork: "translate to [language]." Preserves design, swaps all copy. Translated page shows lineage back to original.

- **Impact:** Systemic. One flood-info page becomes Spanish + Haitian Creole + Mandarin instantly.
- **Hackathon build:** 1 day.
- **Risk:** Translation quality varies; "human review needed" banner by default.

### F5. Printable flyer mode

Every Prism page renders as 8.5×11 PDF for wall-posting or hand-off.

- **Impact:** Broad. Meets people who don't live online at the medium they actually use.
- **Hackathon build:** ½ day.
- **Risk:** None worth mentioning.

### F6. Agent-trace transparency

"Show me what Claude did" panel: tool calls, retries, cache hits, reasoning (when ET is enabled). Educator/researcher-facing; trust signal.

- **Impact:** Medium but durable.
- **Hackathon build:** 1 day (streaming exposes most already).
- **Risk:** Can leak system prompt. Gate behind dev toggle.

### F7. "Fork count covers API cost" — pay-it-forward

Users who can pay donate API credits. Free-tier draws from the pool. Visible counter: "today's pool covered 2,473 sessions from people who couldn't pay."

- **Impact:** Broad. Turns economic gradient into solidarity.
- **Hackathon build:** 2 days (Stripe + pool accounting).
- **Risk:** Stripe scope. MVP can be Ko-fi + manual top-up.

### F8. Curated assistive dep packs

Expand Sandpack deps with `react-aria`, high-contrast theme library, readable-typography pack. Claude prefers them.

- **Impact:** Medium–High.
- **Hackathon build:** 1 day.
- **Risk:** Bundle size. Measure.

### F9. Local-model escape hatch

Adapter for local Ollama / llama.cpp. Quality drops but opens classrooms with no budget, privacy users, sanctioned regions.

- **Impact:** High for equity.
- **Hackathon build:** 2 days.
- **Risk:** Quality cliff. Market as "basic mode."

### F10. Self-hostable in one command

`docker run prism` stands up a full instance. No signup, no config.

- **Impact:** Broad. Directly supports Q6.
- **Hackathon build:** 1 day.
- **Risk:** Low.

---

## My recommendation — what to actually ship in the hackathon

Ship this bundle so judges walk away saying "Prism is the *kind* of tool more tools should be" rather than "cool demo":

1. **Q1 — keyless access** (1 day). Single most impactful change.
2. **Q2 — privacy by default** + **F2 — ephemeral mode** (1 day together).
3. **Q4 — multilingual** + **F4 — fork-as-translation** (1 day together). The demo moment.
4. **F5 — printable flyer mode** (½ day).
5. **F1 — voice input** (½ day).

Four days for one engineer; ~2 days split across a team. Framing becomes: *"Prism isn't a tool for developers. It's a tool that assumes its user doesn't have an API key, doesn't speak English, doesn't have high-speed internet, doesn't want to be logged, and may need to print what they make. Every design choice defaults to the user with the least."*

Qualities Q3, Q6, Q7, Q8, Q9, Q10 should be *claimed publicly* even if partial — they set long-term commitments judges remember.

## What's deliberately not here

- **Accounts / login / social.** Trades off against Q2 and Q1. Defer.
- **Model fine-tuning.** Expensive, slow, wrong call now.
- **A mobile app.** Browser is the point; native fragments the web-ness and reintroduces app-store gatekeepers.
- **Enterprise / B2B.** Not this doc. Impact first.
- **Watermarks, "Made with Prism" badges, referral tracking.** Extractive; violates Q8.
