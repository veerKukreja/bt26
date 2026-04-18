# Prism MCP — Design Spec (Phases A + B)

**Date:** 2026-04-18
**Scope:** Two related features. Phase A makes Prism *speakable* by any MCP client (Claude Desktop, Cursor, Claude Code, Cline). Phase B lets Prism's generate loop *call* external MCP servers during ideation.
**Source idea:** `docs/IDEAS-CONNECTIONS.md` §6.4 + §6.5.

## The shape

- **Phase A** — new package `packages/prism-mcp/`, stdio binary `prism-mcp`, exposes 6 coarse tools. Reuses Prism's generation logic directly (no HTTP hop). Storage: local FS by default (`~/.prism/sessions/<id>.json`), Supabase if env vars present. Ships in isolation; doesn't touch the Next.js app's runtime behavior.
- **Phase B** — optional two-pass generate. When `mcp.config.json` declares servers AND the user opts in per-prompt (via `@mcp` prefix), a context-gathering pass runs first with MCP tools, then the existing SSE-streamed `write_files` build runs with the gathered context prepended. Preserves the SSE contract verbatim.
- **Shared core** — extract generation logic from `app/api/generate/route.ts` into `lib/prism-core/` so both the Next.js API and the MCP server call one implementation. Behavior-preserving refactor, no semantic change to the existing route.

## Non-goals (deliberately deferred)

- HTTP/SSE MCP transport (remote hosted Prism as an MCP server). Stdio first; HTTP when there's a user.
- MCP tool-use *inside* a single streaming generate pass (i.e., one streaming turn with multiple tool calls). The two-pass model keeps the SSE event contract unchanged — much safer to ship.
- User-facing UI for configuring MCP servers. `mcp.config.json` is fine for hackathon.
- OAuth / multi-user auth on Prism's MCP server. Single-user stdio only.
- Fine-grained file ops (`prism_read_file`, `prism_write_file`). Coarse tools first; agents should think in Prism's abstractions.

## Phase A — Prism as MCP server

### Transport

**stdio only in v1.** Every mainstream MCP client (Claude Desktop, Claude Code, Cursor, Cline, Zed) supports stdio via spawn. The client spawns `prism-mcp` as a subprocess, speaks newline-delimited JSON-RPC 2.0 over stdin/stdout. No HTTP, no ports, no auth.

### Tool surface — 6 tools

All tools are namespaced `prism_*` to be unambiguous when agents see them alongside other MCP servers' tools.

```ts
// 1. Create a session with a first prompt.
prism_create_session({
  prompt: string;        // the initial "tell this page what to become"
  template?: string;     // optional starter template id; default is blank canvas
}): Promise<{
  sessionId: string;
  url: string;           // e.g., "https://raph.live/s/<uuid>" if hosted env set, else local
  snapshotId: string;
  summary: string;
}>;

// 2. List all known sessions.
prism_list_sessions(): Promise<Array<{
  sessionId: string;
  url: string;
  createdAt: string;
  snapshotCount: number;
  lastSummary: string;
}>>;

// 3. Get full state of one session.
prism_get_session({
  sessionId: string;
}): Promise<{
  sessionId: string;
  url: string;
  snapshots: Array<{
    id: string;
    createdAt: string;
    prompt: string;
    summary: string;
    files: Record<string, string>;
  }>;
  currentFiles: Record<string, string>;
  currentIndex: number;
}>;

// 4. Add a generation turn to an existing session.
prism_generate({
  sessionId: string;
  prompt: string;
}): Promise<{
  snapshotId: string;
  summary: string;
  fileCount: number;
  compileFailed?: boolean;  // true if even the 2-retry loop exhausted
}>;

// 5. Fork from a snapshot.
prism_fork({
  sessionId: string;
  snapshotIndex?: number;  // defaults to current
}): Promise<{
  sessionId: string;     // new session id
  url: string;
}>;

// 6. Export the current snapshot as zip/html/codesandbox.
prism_export({
  sessionId: string;
  format: "zip" | "html" | "codesandbox";
}): Promise<{
  kind: "zip" | "html";
  base64: string;          // for zip and html formats
  filename: string;
} | {
  kind: "codesandbox";
  url: string;             // the CodeSandbox share URL
}>;
```

**Tool-surface rationale:** Agents describe *intent* and Prism handles the code. `prism_generate` is the core — it's the MCP mirror of the "describe this page" loop. Exposing `prism_read_file` / `prism_write_file` would invite agents to treat Prism as a git repo, which breaks the abstraction and loses all the retry / compile-guard behavior baked into the existing generate path.

### Package layout

```
packages/
  prism-mcp/
    package.json              # { "bin": { "prism-mcp": "./dist/bin.js" }, ... }
    tsconfig.json
    src/
      bin.ts                  # stdio entrypoint — wires the MCP SDK to the tools
      tools.ts                # tool implementations (call into prism-core)
      storage.ts              # session persistence (local FS default, Supabase opt-in)
      types.ts
    README.md                 # how to register with Claude Desktop / Claude Code / Cursor
```

The root `package.json` gets a `workspaces: ["packages/*"]` entry (or just independent install if workspaces feel heavy).

### Storage

**Default: local FS.** Sessions live at `~/.prism/sessions/<id>.json`. File shape:

```json
{
  "sessionId": "01HXYZ...",
  "createdAt": "2026-04-18T12:34:56Z",
  "parentSnapshotId": null,
  "snapshots": [
    {
      "id": "...",
      "parentId": null,
      "createdAt": "...",
      "prompt": "...",
      "summary": "...",
      "files": { "/App.tsx": "...", "/index.css": "..." }
    }
  ]
}
```

**Opt-in: Supabase.** When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in the environment, writes go through `lib/snapshots.ts` (same path as the web app). This lets a session created via MCP be opened in the web app at `prism.live/s/<id>` and vice versa.

**URL field** in tool responses: if Supabase is configured and a hosted origin is set (`PRISM_PUBLIC_ORIGIN` env), return `<origin>/s/<id>`. Otherwise return `file://~/.prism/sessions/<id>.json` so agents have something to reference.

### Auth

No MCP-layer auth. The MCP server uses the user's own Anthropic API key, resolved the same way `lib/anthropic.ts` does today (`ANTHROPIC_API_KEY` env → `~/.anthropic-api-key` file). The Claude Desktop config passes it through:

```json
{
  "mcpServers": {
    "prism": {
      "command": "npx",
      "args": ["-y", "prism-mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

### Claude Desktop / Claude Code registration

Document in `packages/prism-mcp/README.md`:

- **Claude Desktop:** edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the Windows equivalent — add the `mcpServers.prism` entry shown above. Restart Claude Desktop.
- **Claude Code:** `claude mcp add prism npx -y prism-mcp --env ANTHROPIC_API_KEY=...` (CLI) or equivalent entry in `~/.claude/settings.json`.
- **Cursor / Cline / Zed:** their respective `mcp` config files, same shape.

### Error handling

- Tools return MCP-spec-conformant errors. Categories: `invalid_input` (400-equivalent), `not_found` (session id missing), `generation_failed` (Claude errored or compile-retry exhausted), `upstream_error` (Supabase/network). Each error has a human-readable message. MCP clients surface these naturally.
- `prism_generate` with `compileFailed: true` is a *success* at the MCP layer — the tool call completed, the result just records that the generation didn't produce runnable code. Agents can decide to retry with a modified prompt.

### Testing

- Unit tests for `storage.ts` (local FS round-trip).
- Integration test: spawn the binary with stdio piped, send `tools/list`, `tools/call prism_create_session`, assert the response. Smoke level only.
- Manual acceptance: register with Claude Desktop, run "create a Prism for a coffee shop in Tokyo" from a chat, verify URL works.

## Phase B — Prism consumes MCP servers

### Why opt-in, not automatic

Every generation today is one Anthropic call, ~5–20s. Auto-triggering an MCP context-gathering pass would add 3–15s of latency to *every* prompt, even when the user doesn't need external context. That kills the demo feel.

Instead: explicit opt-in per prompt via a `@mcp` prefix. Typing `@mcp pull the colors from my figma file and make the landing page match` triggers the two-pass flow. Without the prefix, Prism generates as today.

Alternative, more discoverable: a toggle UI. Deferred — JSON file is easier to ship first.

### Config file

**`mcp.config.json` at the project root** (developer-facing). Gitignored if it contains secrets; committed if it uses `${ENV_VAR}` interpolation.

```json
{
  "servers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-figma"],
      "env": { "FIGMA_ACCESS_TOKEN": "${FIGMA_ACCESS_TOKEN}" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/prism-scratch"]
    }
  }
}
```

`${ENV_VAR}` interpolation resolved at server startup from `process.env`.

### Two-pass generate

When `@mcp` prefix is detected in the prompt **and** at least one MCP server is configured:

**Pass 1 — context gathering:**
- Model: same as generate (Haiku or Sonnet).
- Tools: **only** the union of all configured MCP servers' tools. No `write_files`.
- System prompt additions: *"The user is about to ask you to build a page. Before they do, use your tools to gather any relevant context from the configured MCP servers. Return a compact markdown summary of what you found. Do NOT write files. When you're done gathering, respond with the summary and end your turn."*
- Loop: standard agentic tool-use loop (Claude calls a tool, we invoke it via MCP, feed the result back) until Claude's response has no tool calls. Cap at 6 tool calls to bound latency.
- Output: the markdown summary text.

**Pass 2 — build:**
- Runs the **existing** `/api/generate` route, but with a modified request body:
  - `prompt`: the user's original prompt with `@mcp` stripped.
  - `currentFiles`: unchanged.
  - NEW: `context?: string` — the Pass 1 summary, injected into `messages[0].content` as an additional text block with cache-control `ephemeral` (so it caches across the retry loop but not across sessions).
- SSE contract: identical. Client sees `tool_start` → `progress` → `done` as today. The existence of Pass 1 is invisible to the UI except for a slight delay before the first `tool_start` event.
- **Pre-stream signal:** emit a new SSE event `mcp_gathering` with `{ servers: string[] }` *before* Pass 1 starts. Client can show a "gathering context…" indicator. After Pass 1 completes, emit `mcp_gathered` with `{ summary: string }`. Then Pass 2 proceeds with normal events.

### SSE event contract addition

```
mcp_gathering  → { servers: string[] }                 (only when @mcp)
mcp_gathered   → { summary: string, toolCalls: number } (only when @mcp)
tool_start     → { name: string }                       (existing)
progress       → { chars: number, tail: string }        (existing)
text           → { text: string }                       (existing)
usage          → SessionUsage                           (existing)
done           → { files: FileMap, summary: string }    (existing)
error          → { message: string }                    (existing)
```

Existing events' shapes are unchanged. `lib/generate-client.ts` gets new callbacks `onMcpGathering?`, `onMcpGathered?` — both optional, backward-compatible.

### MCP client lifecycle

Long-lived, module-scoped cache of MCP client instances. Spawned on first use, stay alive for the process lifetime:

```ts
// lib/mcp-clients.ts
const clients = new Map<string, Client>();

export async function getMcpClient(serverName: string): Promise<Client> {
  let c = clients.get(serverName);
  if (!c) {
    c = await spawnFromConfig(serverName);
    clients.set(serverName, c);
  }
  return c;
}
```

On Next.js dev reload, the cache is wiped (fresh module). In production, clients live as long as the server process. Dead client auto-respawn on the next call if a previous call threw a transport error.

### Failure modes

- **MCP server fails to spawn** → Pass 1 logs the error, skips that server. If no servers remain, skip Pass 1 entirely and fall back to a normal generate (with a `mcp_gathering` event carrying `servers: []`).
- **Tool call fails** → Pass 1 feeds the error back to Claude as the tool result. Claude can try another tool or give up. The gathered summary reflects what did work.
- **Pass 1 exceeds 6 tool calls** → terminate the loop, take whatever summary Claude has produced so far.
- **Pass 1 takes >30s** → timeout, proceed to Pass 2 without context. Emit `mcp_gathered` with a warning summary.
- **Pass 2 fails** → same as today (SSE error event, UI shows toast).

### Security

MCP servers are configured by the operator (person running Prism). Don't add MCP servers to `mcp.config.json` you don't trust — they run as subprocesses with full env access.

Document this prominently in the README.

## Shared core refactor

Extract from `app/api/generate/route.ts` into `lib/prism-core/`:

```
lib/prism-core/
  index.ts                    # public surface
  generate.ts                 # streaming generation with retry — no Next.js deps
  compile-guard.ts            # (if there's one today; otherwise a small wrapper)
  types.ts                    # re-exports FileMap, Snapshot, etc.
```

The function signature should look roughly:

```ts
export async function* streamGenerate(opts: {
  prompt: string;
  currentFiles: FileMap;
  errorContext?: string;
  context?: string;  // Phase B injection point
  apiKey: string;
  model: string;
}): AsyncIterable<GenerateEvent>;
```

- `app/api/generate/route.ts` becomes a thin adapter: consume env + body, call `streamGenerate`, forward events as SSE.
- `packages/prism-mcp/src/tools.ts` imports the same function directly — no HTTP round-trip needed for local MCP mode.

This refactor is behavior-preserving. Zero change to SSE events, retry count, or prompt caching.

## Dependencies

- **Add:** `@modelcontextprotocol/sdk` (official TypeScript SDK from Anthropic). Used by both packages/prism-mcp (server side) and lib/mcp-clients.ts (Phase B client side).
- **Add dev:** `zod` if it's not already transitively available — MCP tools are easier to validate with zod schemas.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Phase B latency on every prompt | Opt-in via `@mcp` prefix. Never triggers implicitly. |
| MCP clients holding dead subprocesses across dev reloads | Module-scoped cache; Next.js HMR clears it naturally. |
| Phase A session IDs collide with web app's | Same ULID generator (lib/default-app.ts already has one); global uniqueness. |
| Hackathon scope creep on fine-grained file tools | Explicitly out of scope for v1. Coarse-only. |
| Operator adds malicious MCP server to config | Security note in README. No sandboxing — trust boundary is the config. |
| Shared core refactor breaks the existing route | Behavior-preserving; integration test the route before/after to confirm SSE output is byte-identical. |
| Haiku model swap reduces code-gen quality | The two retry passes already cushion. If quality drops too far, revert or keep Sonnet for first-pass only. |

## Sequencing

1. **Ship the shared-core refactor first** (zero-semantic change; unblocks everything).
2. **Phase A** (independent package, local FS, stdio only). Ship, register with Claude Desktop, verify end-to-end. ~1 day.
3. **Phase B** (config file, two-pass generate, opt-in prefix). Ship behind the prefix. ~1.5 days.
4. **Stretch:** HTTP transport for Phase A, `@mcp` UI toggle, fine-grained file tools — all post-hackathon.

## Open decisions (I'll default these if no override)

- **Package manager / workspaces:** use `npm workspaces` since the repo is already `npm`. No switch to pnpm.
- **Session ID generation:** reuse the ULID approach from existing code for cross-compatibility.
- **Default MCP server bundle:** ship *empty* `mcp.config.example.json` — no default servers. User opts in to each one.
- **Model for Pass 1:** Haiku (matches the new default). Pass 1 is routing, not deep reasoning — Haiku is right for it.
- **Prompt for Pass 1's system suffix:** live in `lib/prism-core/mcp-gather-prompt.ts`, cache-marked.
