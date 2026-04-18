# Privacy

## What Prism stores

Prism is designed to be safe for people who need it most — organizers, survivors, journalists, neighbors — and the defaults reflect that.

### Default (no sign-in, no account)

- **Your prompts and generated pages never leave your browser**, except as a single request to Anthropic's API for generation. They are not stored, logged, or analyzed on our servers.
- A local copy of your session lives in your browser's `localStorage` (keys like `prism:session:<id>`, `prism:env:<id>`) so refreshing the tab keeps your work. This data never leaves your device unless you explicitly export or fork.
- If the self-hoster opts in to Supabase persistence (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`), snapshots and forks are persisted to that project. This is a deliberate config choice, not a default.

### Ephemeral mode (top-left toggle)

When the ephemeral badge is showing:

- No `localStorage` writes for snapshots, usage, references, or the write-up.
- No Supabase writes (`lib/snapshots.ts` short-circuits every write path).
- In-tab state uses `sessionStorage` instead, which is cleared when the tab closes.
- The server still receives your prompt to generate (Anthropic has to see it), but Prism's server does not log prompt text.

**What ephemeral mode does NOT protect against:**

- Screen recordings or another person looking at your screen.
- Browser history, if not separately cleared.
- Shared-device forensic recovery.
- The Anthropic API's own logging and retention policies (see Anthropic's privacy policy).
- Network-level observers on your connection or ours.

### Server logging

`/api/generate` and related routes log request metadata (IP prefix, auth mode, token counts, approximate cost) for rate-limit enforcement. **They do not log prompt text, file contents, or Anthropic response bodies.** Error messages returned to the client are filtered to avoid leaking credentials.

### Session fingerprint

Session ids are random UUIDs. They are in the URL path (`/s/<uuid>`). Anyone with the URL can see that session's current state; URLs are effectively unlisted-but-not-secret. If you forked it, the new URL is a fresh UUID with no backward link to the parent aside from a pointer in its seed snapshot.

### What we never do

- Accounts, login, email capture, OAuth flows.
- Analytics pixels, Google Analytics, Mixpanel, Plausible, Fathom.
- Facebook/Meta/TikTok/LinkedIn tracking.
- Referrer tracking, UTM attribution.
- "Are you sure you want to leave" prompts, upsell modals, newsletter gates.
- IP-based geo-blocking, Tor blocking, VPN detection.

### What we store on the server *permanently*

Nothing, unless the host opted in to Supabase. In that case, snapshots and forks are stored in the host's Supabase project under the host's policies. Self-hosters are responsible for their own retention and access controls.

## Export and delete

- **Export:** every snapshot can be exported as a zip, a single-file HTML, or a CodeSandbox link. Nothing is locked in Prism.
- **Delete:** to remove a session, delete its `localStorage` entry in your browser (DevTools → Application → Local Storage), or start Prism in ephemeral mode so no state is stored in the first place.

## Anthropic API

All generation goes through Anthropic's Messages API. Your prompts and current file contents are sent as the user message; the write-up (if in brainstorm mode) is sent as an additional context block. See [Anthropic's privacy policy](https://www.anthropic.com/privacy) for how they retain this data.

Prism uses prompt caching on the system prompt and current-files block so repeated requests are faster and cheaper, but prompt caching does not change what Anthropic sees — only how efficiently.

## Contact

This is a hackathon project. If you are at real risk — a survivor, organizer, or activist — **do not rely on Prism as a private tool**. Use an operating-system-level incognito flow (Tails, a fresh device, a public terminal with a throwaway browser profile). Prism's ephemeral mode reduces surface area but does not eliminate it.
