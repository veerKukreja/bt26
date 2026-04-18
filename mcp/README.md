# prism-mcp

An MCP (Model Context Protocol) server that exposes Prism as a tool surface for Claude Desktop, Claude Code, Cursor, Cline, and any other MCP client. Describe what you want; agents can build it with Prism.

## What it exposes

Six coarse tools — agents work in Prism's abstractions (describe → build), not in file operations:

- `prism_create_session(prompt)` — spin up a new session, run the first generation, return the URL + snapshot id.
- `prism_list_sessions()` — list every session stored locally.
- `prism_get_session(sessionId)` — full state: snapshots, prompts, summaries, files, current pointer.
- `prism_generate(sessionId, prompt)` — add another turn to an existing session.
- `prism_fork(sessionId, snapshotIndex?)` — branch from a snapshot.
- `prism_export(sessionId, format)` — export as `zip` / `html` / `codesandbox`.

## Storage

Sessions live at `~/.prism/sessions/<uuid>.json`. Nothing talks to Supabase unless you set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the MCP server's environment — in which case the session URL returned by tools will point to your hosted Prism instance, so sessions created via MCP are openable in a browser.

## Register with Claude Desktop

Edit your Claude Desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add an `mcpServers` entry:

```json
{
  "mcpServers": {
    "prism": {
      "command": "npx",
      "args": ["-y", "tsx", "/ABSOLUTE/PATH/TO/bt26/mcp/bin.ts"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "PRISM_PUBLIC_ORIGIN": "https://raph.live"
      }
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/bt26` with the actual path to this repo. Restart Claude Desktop.

`PRISM_PUBLIC_ORIGIN` is optional. If set, tool responses include a shareable URL under that origin (requires your hosted Prism instance to share Supabase with this server's env). Omit it for local-only use.

## Register with Claude Code

Either edit `~/.claude/settings.json` directly with the same structure, or run:

```bash
claude mcp add prism \
  --command npx \
  --args "-y,tsx,/ABSOLUTE/PATH/TO/bt26/mcp/bin.ts" \
  --env "ANTHROPIC_API_KEY=sk-ant-..."
```

## Register with Cursor / Cline / Zed

All three read an `mcp` config with the same shape as Claude Desktop. Check each tool's docs for the file location.

## Smoke test

With the server registered, ask the agent:

> *"Create a Prism session for a landing page for a Tokyo coffee shop in neon colors."*

The agent should call `prism_create_session`, and a few seconds later hand you a URL (or a local session id if `PRISM_PUBLIC_ORIGIN` is unset). Follow it up with:

> *"Now make the coffee shop feel like 3am."*

The agent should call `prism_generate` on the same session.

## Running manually

```bash
# from the repo root
npx tsx mcp/bin.ts
```

That opens a stdio loop. Paste a JSON-RPC request terminated by a newline and the server responds on stdout. Example:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

(You'll need to send `initialize` first per the MCP spec; see `mcp/bin.ts` for the handshake.)

## Architecture

- `mcp/bin.ts` — entrypoint; wires stdio transport.
- `mcp/server.ts` — creates an `McpServer` and registers tools.
- `mcp/tools.ts` — tool implementations. Calls `streamGenerate` from `lib/prism-core/` directly — no HTTP hop to the Next.js app.
- `mcp/storage.ts` — local FS session persistence.

`lib/prism-core/generate.ts` is the single source of truth for generation logic; both the Next.js `POST /api/generate` route and this MCP server import it. Changes to generation behavior (system prompt, tool contract, retry logic) land in one place.

## Limitations (v1)

- Stdio transport only; no HTTP.
- No MCP-layer auth — the user's own Anthropic API key is used directly.
- `prism_export` with `format: "html"` requires a running Next.js server (esbuild-based standalone bundler lives in the route). `zip` and `codesandbox` work standalone.
- No compile-validity checking — what the tool returns is what the model produced. Agents should iterate if output is broken.
- No cross-session references; each tool call is independent.
