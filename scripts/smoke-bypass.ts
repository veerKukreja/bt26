// Smoke test using the same undici bypass fetch we use in the route.
// Logs every event type so we can see what actually arrives.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetch as undiciFetch, Agent } from "undici";
import { WRITE_FILES_TOOL } from "../lib/anthropic";
import { SYSTEM_PROMPT, buildCurrentFilesMessage } from "../lib/system-prompt";
import { DEFAULT_APP } from "../lib/default-app";

function resolveKey(): string {
  const env = process.env.ANTHROPIC_API_KEY;
  if (env?.trim()) return env.trim();
  try {
    return readFileSync(join(homedir(), ".anthropic-api-key"), "utf8").trim();
  } catch {
    throw new Error("no key in env or ~/.anthropic-api-key");
  }
}

const agent = new Agent({
  keepAliveTimeout: 30_000,
  connectTimeout: 10_000,
  bodyTimeout: 180_000,
  headersTimeout: 30_000,
});

const bypassFetch: typeof globalThis.fetch = ((input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: agent,
  }) as unknown as ReturnType<typeof globalThis.fetch>) as typeof globalThis.fetch;

async function main() {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
  const client = new Anthropic({ apiKey: resolveKey(), fetch: bypassFetch });

  const userContent: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: buildCurrentFilesMessage(DEFAULT_APP),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: "Add a bright red header saying Hello." },
  ];

  console.log(`smoke-bypass: model=${model}`);
  const t0 = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    tools: [WRITE_FILES_TOOL],
    tool_choice: { type: "tool", name: "write_files" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
    stream: true,
  });

  const typeCounts: Record<string, number> = {};
  let deltaChars = 0;
  for await (const event of response) {
    typeCounts[event.type] = (typeCounts[event.type] ?? 0) + 1;
    if (event.type === "content_block_delta") {
      const d = event.delta as { type: string; partial_json?: string; text?: string };
      const subtype = d.type;
      const key = `content_block_delta.${subtype}`;
      typeCounts[key] = (typeCounts[key] ?? 0) + 1;
      if (subtype === "input_json_delta" && d.partial_json) {
        deltaChars += d.partial_json.length;
      }
    }
  }
  console.log(`smoke-bypass: done in ${Date.now() - t0}ms`);
  console.log(`smoke-bypass: deltaChars=${deltaChars}`);
  console.log(`smoke-bypass: type counts:`, typeCounts);
}

main().catch((err) => {
  console.error("smoke-bypass: failed", err);
  process.exit(1);
});
