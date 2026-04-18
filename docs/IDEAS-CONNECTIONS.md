# Prism — Connections & Ideation Layer

A comprehensive brainstorm of everything that turns Prism from a self-contained "describe-and-morph" demo into a porous creative pipeline: **references flow in, ideas get reasoned about, output takes richer shapes, artifacts flow back out into the world.**

Sibling of `docs/IDEAS.md` (impact-through-app-design). That one is about Prism's *defaults*; this one is about Prism's *surfaces*.

---

## The thesis

Prism today is a box. A user types a sentence, a page materializes, the page lives inside one URL. That loop is the whole product.

The connections + ideation layer is the argument that Prism could be a *pipeline* instead of a box — five stages, each optional, each independently useful:

```
 References ──┐
              ├─> Brainstorm ──> Write-up ──> Build ──> Distribute
 Intent ──────┘
```

Each stage degrades gracefully:
- **No references, no brainstorm** → today's Prism.
- **No references, yes brainstorm** → structured-spec one-shot before building.
- **Yes references, no brainstorm** → "build me a page like this, but for my thing."
- **Yes references, yes brainstorm** → the full ideation-to-app pipeline.
- **Any of the above, then distribute** → the artifact actually goes somewhere.

Every idea in this doc opens one of four boundaries:

1. **Input boundary** — what flows *in* as reference material.
2. **Thought boundary** — what can be *reasoned about* before building.
3. **Output shape** — what Prism *produces* (currently one page; could be an app, a library, a PDF, an email).
4. **Destination boundary** — where the artifact *ends up living*.

Ideas that break more than one boundary compound.

---

## How to read this doc

Each idea carries three scores:

- **Impact** — who does this unlock? `Niche` / `Broad` / `Systemic`.
- **Build** — focused engineer-days to a shippable v1. `½` / `1` / `2` / `3+`.
- **Risk** — one-sentence note on how this goes wrong.

---

## Bucket 1 — Ideation inputs (uploads, references, the things that flow IN)

### 1.1 URL ingest
Paste any URL. Claude fetches, runs vision over a screenshot, and extracts a structured inventory: what the page is for, what features it exposes, design language, user flow.
- **Impact:** Broad. **Build:** 1. **Risk:** CORS / bot-blocking; mitigate with server-side fetch + transparent fallback.

### 1.2 App Store / Play Store link
Extract description, screenshots, "what's new," top reviews → features + UX patterns + pain clusters.
- **Impact:** Broad. **Build:** 1. **Risk:** Store HTML changes; pin to a working parser.

### 1.3 Figma file / link
Pull frames as images, identify components, extract design tokens / typography / spacing.
- **Impact:** Broad (high for designers). **Build:** 2. **Risk:** Figma API scopes; accept image-paste fallback.

### 1.4 PDF / pitch deck / spec doc
Parse text + page-by-page vision → extract feature set, user stories, data model.
- **Impact:** Broad. **Build:** 1. **Risk:** Multi-column PDFs parse badly; set expectations.

### 1.5 GitHub repo URL
Read README + package.json + folder structure + sampled source → "what this project does" inventory.
- **Impact:** Broad. **Build:** 1–2. **Risk:** Large repos exceed context; sample smartly.

### 1.6 Screenshot dump
Drop N screenshots; Claude identifies common patterns and distinctive ones.
- **Impact:** Broad. **Build:** 1. **Risk:** None serious.

### 1.7 Video demo (YouTube / TikTok / Loom)
Transcribe + vision-sample frames → flow + feature list.
- **Impact:** Medium. **Build:** 2. **Risk:** YouTube scraping legally gray; use official API or public-link only.

### 1.8 "What's your favorite app?"
One sentence. Claude reconstructs the feature set from world knowledge.
- **Impact:** Niche (delightful). **Build:** ½. **Risk:** Hallucination; label as "may be out of date."

### 1.9 Tweet / thread / social post
Extract product idea, audience, value prop.
- **Impact:** Medium. **Build:** 1. **Risk:** Low.

### 1.10 Podcast / audio / meeting transcript
Extract ideas embedded in founder interviews or user-research calls.
- **Impact:** Niche. **Build:** 1–2. **Risk:** Transcription quality on messy audio.

### 1.11 Multi-upload with set operations
Upload 3 competitors; show *intersection* (table stakes), *union* (all features), and *gap* (opportunity space).
- **Impact:** High for product thinkers. **Build:** 2. **Risk:** Gap is model-dependent; flag as "worth exploring," not "validated."

### 1.12 Voice description of an app
Speak an idea for 30–60s. Claude produces a structured write-up.
- **Impact:** Broad. **Build:** ½. **Risk:** None serious.

### 1.13 Prism remix — upload another Prism
Paste a Prism URL. Mine it for features; seed a new session.
- **Impact:** Medium (viral loop). **Build:** ½. **Risk:** None.

---

## Bucket 2 — Brainstorm & write-up (the reasoning layer)

### 2.1 Question-driven brainstorm
Claude asks 5–10 structured questions, synthesizes a write-up.
- **Impact:** High. **Build:** 1. **Risk:** Too many questions feels like intake; cap ~7.

### 2.2 One-shot write-up
User types one paragraph, Claude produces a full PRD.
- **Impact:** High. **Build:** 1. **Risk:** Hallucinated detail; flag speculative sections.

### 2.3 Template starters
SaaS, marketplace, newsletter, portfolio, directory, community, event, nonprofit, personal site.
- **Impact:** Medium. **Build:** 1. **Risk:** Templates ossify thinking; offer "custom" default.

### 2.4 Inline write-up editor
The write-up is editable; edits feed back into build.
- **Impact:** High. **Build:** 1. **Risk:** Low.

### 2.5 Per-section regenerate
"Expand the data model," "redo the copy darker" — regenerate one section at a time.
- **Impact:** High. **Build:** 1. **Risk:** Section boundaries muddy; enforce clean markers.

### 2.6 Write-up export formats
Markdown, PDF, Notion, Linear tickets, Jira, GitHub issue, Google Doc.
- **Impact:** Medium (but sticky — fits existing workflows). **Build:** 1–2 per format.

### 2.7 Brainstorm ↔ build toggle
Planning mode is valid output. Some users stop there; success.
- **Impact:** Medium (changes what Prism *is*). **Build:** ½.

### 2.8 Devil's-advocate pass
Optional "what could go wrong" section — competitive, tech, ethical, adoption risks.
- **Impact:** Medium (high for serious users). **Build:** ½.

### 2.9 "Inspired by, but different from"
With attached references, explicitly name what it's *not* copying.
- **Impact:** Medium. **Build:** ½.

### 2.10 Brainstorm personalities
Pragmatic-PM, bold-VC, security-minded, a11y-first, user-research-driven, growth-hacker, nonprofit-organizer.
- **Impact:** Medium. **Build:** 1. **Risk:** Caricatures land badly; use descriptive names.

### 2.11 Competitor matrix
Generated from multi-uploads: rows = competitors, cols = features, cells = y/n/partial.
- **Impact:** Medium. **Build:** 1.

### 2.12 User persona + journey generation
2–3 personas with JTBD, walking through the proposed app.
- **Impact:** Medium. **Build:** 1. **Risk:** Stereotypes; prompt carefully.

### 2.13 Brand & tagline generation
Names, taglines, voice-tone, color-palette, typography vibe.
- **Impact:** Medium (deceptively important — naming kills projects). **Build:** 1.

### 2.14 Business model brainstorm
Free, freemium, subscription, donation, grant, cooperative, open-source-service — suggested with reasoning.
- **Impact:** Medium. **Build:** ½.

### 2.15 Growth / GTM brainstorm
"How do the first 100 users find this."
- **Impact:** Medium. **Build:** ½.

---

## Bucket 3 — App shape (what Prism produces)

### 3.1 Multi-page output
A session contains N pages with real navigation, shared layout, shared state.
- **Impact:** High. **Build:** 3. **Risk:** Biggest architectural lift here — touches Sandpack layout, system prompt, preview shell, timeline model.

### 3.2 Component library mode
Output is a reusable library (Storybook-style) instead of a page.
- **Impact:** Medium–High. **Build:** 2.

### 3.3 App vs page vs library toggle
Per session, pick shape.
- **Impact:** Medium. **Build:** ½ (after 3.1/3.2).

### 3.4 "Extract to component"
Highlight a region on a rendered page, promote it to shared component.
- **Impact:** High. **Build:** 2.

### 3.5 Page graph / sitemap view
Visualize a multi-page app as a node graph.
- **Impact:** Medium. **Build:** 1 (on 3.1).

### 3.6 Data model as first-class artifact
Write-up produces a schema; Prism generates TS types + optional Supabase migrations.
- **Impact:** High for app-builders. **Build:** 2–3.

### 3.7 Admin panel auto-generated
For any generated app with a data model, produces a CRUD admin.
- **Impact:** Medium–High. **Build:** 2.

### 3.8 Email templates as an artifact
Welcome, confirmation, notifications. Email-safe HTML that renders in Gmail/Outlook.
- **Impact:** Medium. **Build:** 1.

### 3.9 Native mobile layout as separate artifact
Real mobile render (touch targets, bottom nav, iOS/Android idioms). Not a responsive hack.
- **Impact:** Medium. **Build:** 2.

### 3.10 API routes generated alongside pages
Next.js route handlers + docs.
- **Impact:** High for app-builders. **Build:** 2.

---

## Bucket 4 — Distribution (where the artifact lives)

### 4.1 Rich OG image service
Every Prism URL unfurls with a live preview in Twitter/iMessage/Slack/Discord.
- **Impact:** High (virality amplifier). **Build:** 1. **Risk:** Render cost; cache aggressively.

### 4.2 Embed-in-platform
Notion, Ghost, Substack, WordPress, Medium, LinkedIn, Confluence. Modes: read-only / editable / fork-from-here.
- **Impact:** High. **Build:** 1.

### 4.3 Slack / Discord app
`/prism build a page about X`. Share forks as rich cards.
- **Impact:** Medium–High. **Build:** 2.

### 4.4 One-click deploy
Vercel / Cloudflare / Netlify → real hostname (`<slug>.prism.live` or custom).
- **Impact:** Outsized. **Build:** 3. **Risk:** Abuse vector; pair with moderation.

### 4.5 Eject to GitHub repo
Push current session as a full `create-next-app` repo via OAuth.
- **Impact:** Outsized for developers. **Build:** 3.

### 4.6 QR-code share
Auto-generate for every URL for physical distribution (flyers, postcards, zines).
- **Impact:** Medium. **Build:** ½.

### 4.7 Email-as-HTML export
Email-safe HTML for newsletters / mass email.
- **Impact:** Niche. **Build:** 1.

### 4.8 PWA export
"Download as app." Installable manifest.
- **Impact:** Medium. **Build:** 1.

### 4.9 Markdown blog export
Paste-ready for Ghost/Medium/Substack/Hashnode.
- **Impact:** Niche. **Build:** ½.

### 4.10 Print-on-demand integration
Stickers, postcards, zines, posters via POD API (Printful).
- **Impact:** Niche but fun. **Build:** 2.

### 4.11 Permanent hosting via IPFS / Arweave
Pages that survive takedowns.
- **Impact:** Niche but meaningful. **Build:** 2.

### 4.12 AirDrop / proximity share
iOS/macOS system share sheet. Just make URL share-sheet-friendly.
- **Impact:** Low but free. **Build:** ½.

### 4.13 Open-social distribution
Mastodon, Bluesky, Farcaster, Matrix as first-class share targets.
- **Impact:** Medium. **Build:** 1–2.

---

## Bucket 5 — Live / runtime data (inside generated pages)

### 5.1 Map embeds
Google Maps / OSM / Mapbox / Leaflet. Geocode from prompt addresses.
- **Impact:** Broad. **Build:** 1.

### 5.2 Calendar embed / iCal feed
Google Calendar public events, user's own calendar (OAuth), or hand-defined iCal.
- **Impact:** Medium. **Build:** 1–2.

### 5.3 Live weather / news / sports
Standard widgets from well-known APIs.
- **Impact:** Niche. **Build:** 1.

### 5.4 Supabase table as a CMS
Link a table; pages read/display live rows; edits reflected immediately.
- **Impact:** High for app-builders. **Build:** 2.

### 5.5 Airtable / Google Sheets as backend
The no-code classic.
- **Impact:** High. **Build:** 1–2.

### 5.6 Media embeds
Spotify, YouTube, TikTok, Twitch, Loom, Figma, Vimeo, SoundCloud — Claude drops them in given a URL.
- **Impact:** Broad. **Build:** ½.

### 5.7 Payments
Stripe, Ko-fi, LemonSqueezy, donation widgets, nonprofit tip jars.
- **Impact:** High. **Build:** 2.

### 5.8 Email-capture forms
Mailchimp, ConvertKit, Loops, Substack, Buttondown.
- **Impact:** Broad. **Build:** 1.

### 5.9 Generic form → webhook / Google Sheet
No-backend form handling.
- **Impact:** Broad. **Build:** 1.

### 5.10 Image generation inside pages
Claude tool-calls Flux / DALL-E / Replicate / Ideogram.
- **Impact:** High. **Build:** 2. **Risk:** Costs compound; rate-limit.

### 5.11 Live chat widget
Crisp, Chatra, Chatwoot.
- **Impact:** Niche. **Build:** 1.

### 5.12 Privacy-preserving analytics
Plausible / Umami / Fathom — opt-in per page, not default (respects `docs/IDEAS.md` Q8).
- **Impact:** Niche. **Build:** 1.

### 5.13 User's own calendar / inbox / photos
With OAuth, a page can read the user's Gmail/Calendar/Photos to personalize.
- **Impact:** Niche but powerful. **Build:** 3. **Risk:** Privacy — only for self-hosted pages, never shared.

---

## Bucket 6 — Automation, identity, AI federation

### 6.1 Webhook on fork / on snapshot
Fire into Zapier / n8n / Make / Slack / Discord / SMS.
- **Impact:** Medium. **Build:** 1.

### 6.2 Incoming webhook → Prism update
"When my Stripe sees a new customer, update this page."
- **Impact:** Medium. **Build:** 2.

### 6.3 Sign in with GitHub / Google / Apple / magic link
Optional. Anonymous stays default (respects `docs/IDEAS.md` Q1).
- **Impact:** Medium. **Build:** 2. **Risk:** Login friction kills keyless; keep opt-in.

### 6.4 Prism as an MCP server
Claude Desktop / Claude Code / Cursor / Cline can list, read, fork, build Prism sessions.
- **Impact:** High in the AI-agent ecosystem. **Build:** 2.

### 6.5 Prism consumes MCP servers
Point at Figma MCP, Supabase MCP, GitHub MCP, Notion MCP, Linear MCP.
- **Impact:** High. **Build:** 2.

### 6.6 Chrome / Brave / Arc extension: "Prismify this page"
Rewrite any webpage in Prism (accessibility rewriter, simplification, remix).
- **Impact:** High. **Build:** 3.

### 6.7 VS Code extension
Prism loop inside the editor, operating on real files.
- **Impact:** Outsized. **Build:** >3. **Risk:** Effectively its own product.

### 6.8 OS-level shortcuts
Raycast, Alfred, iOS Shortcut, Siri.
- **Impact:** Medium. **Build:** 1 per platform.

### 6.9 Email-in (`page@prism.live`)
Forward any email, get a URL back. Fantastic for low-infra users.
- **Impact:** High. **Build:** 2.

### 6.10 SMS / WhatsApp / Signal bot
Text a prompt, get a URL. Global south use.
- **Impact:** High. **Build:** 2.

### 6.11 Async comments on snapshots
No real-time infrastructure needed.
- **Impact:** Medium. **Build:** 2.

### 6.12 Real-time multiplayer
Two users on one prompt bar.
- **Impact:** Medium but unique. **Build:** >3. **Risk:** CRDT complexity.

### 6.13 CRM bridges
HubSpot, Salesforce, Attio, Airtable, Notion, Linear, Jira, Asana.
- **Impact:** Medium (enterprise). **Build:** 1–2 per.

### 6.14 Local model adapter
Ollama / llama.cpp. Already covered as F9 in `docs/IDEAS.md`.
- **Impact:** High. **Build:** 3. **Risk:** Quality cliff.

### 6.15 Federated Prism instances
Self-hosted Prisms share galleries, import/export sessions across instances.
- **Impact:** Niche but meaningful long-term. **Build:** 3+.

---

## Cross-cutting design principles

1. **Every connection must degrade gracefully.** Fallback when Figma API is down, when rate-limited, when a webhook rejects.
2. **Every input must be attributable.** If generated output drew on a reference, cite it.
3. **Every output must be exportable.** Write-ups as Markdown, pages as HTML, data models as JSON. Never lock work in Prism format. Reinforces `docs/IDEAS.md` Q9.
4. **Every connection touching privacy must be opt-in and off by default.** Respects `docs/IDEAS.md` Q2/Q8.

---

## Impact lens

Connections layer most valuable for:
- **People who can't code but already have ideas.** Uploads + brainstorm = hunch → spec without VS Code.
- **Organizers / small teams without product designers.** Brainstorm features do work that otherwise requires hiring.
- **Non-English speakers.** Uploads let them gesture at apps they can't describe in English. Pair with `docs/IDEAS.md` Q4/F4.
- **Low-bandwidth users.** SMS (6.10), email-in (6.9), QR codes (4.6) reach users who can't keep a tab open.
- **The AI-agent ecosystem.** MCP (6.4, 6.5) makes Prism infrastructure others build on.

Ideas without this through-line (CRM integrations, most of 5.3) are valid but lower priority.

---

## Hackathon recommendation

### Core pipeline (1–2 engineer-days)

- **URL ingest (1.1)** + **Screenshot dump (1.6)** as uploads entry. Covers 80% of reference cases.
- **One-shot write-up (2.2)** + **per-section regenerate (2.5)**. Brainstorm MVP.
- **Brainstorm ↔ build toggle (2.7)**. Let the write-up be valid output on its own.

### High-leverage extensions (1 day each)

- **Multi-upload set operations (1.11)**. The gap analysis is the *demo moment*.
- **Write-up export as Markdown / GitHub issue (2.6)**. Fits existing workflows. Sticky.

### One connection-out (1 day)

- **Rich OG images (4.1)** if public-facing demo.
- **Eject to GitHub (4.5)** if developer-focused.
- **SMS bot (6.10)** if impact-focused (pairs with `docs/IDEAS.md`).

### Deferred for hackathon

- **Multi-page output (3.1)** — architectural lift; stay single-page.
- **Live runtime data (Bucket 5 beyond embeds)** — too many moving parts.
- **MCP (6.4/6.5)** — narrow audience unless rewarded.
- **OAuth-gated integrations** — day-per-service scope bomb.

### The narrative this bundle enables

> *"A neighborhood organizer sees a mutual-aid site in another city. She pastes its URL into Prism. She adds two screenshots of another site she likes. Prism analyzes both, shows her what they share and what they're each missing, and produces a one-page write-up for her own version. She edits a few lines, clicks Build, and thirty seconds later she has her own site with a URL she can text to her neighbors. She exports the write-up to a GitHub issue so her cousin who codes can eject it next month."*

Every step uses an idea from this doc. Every step degrades gracefully. Judges' takeaway: *this is what ideation with AI is supposed to feel like.*

---

## What's deliberately not here

- **Therapy / coaching / personal chat modes.** Prism's brainstorm is about building things, not processing feelings.
- **Fine-tuned domain models.** Premature.
- **Crypto / web3-first framings.** Fragments product, alienates judges, conflicts with `docs/IDEAS.md` posture.
- **SaaS-pricing / enterprise paywalls.** Not this doc.
- **"AI employees" / agent swarms.** Distraction from Prism's actual strength.

---

## Next step

Promote the hackathon bundle into an implementation plan: `docs/superpowers/plans/2026-04-18-unified-hackathon.md` (already exists). Everything else here is a catalog to return to once the core pipeline exists.
