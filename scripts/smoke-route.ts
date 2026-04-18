// Smoke test that mimics the /api/generate setup: forced tool_choice,
// cache_control on system prompt, and a realistic user message shape.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

async function main() {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  const client = new Anthropic({ apiKey: resolveKey() });

  const userContent: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: buildCurrentFilesMessage(DEFAULT_APP),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: "Add a bright red header saying Hello." },
  ];

  console.log(`smoke-route: model=${model} systemLen=${SYSTEM_PROMPT.length} userLen=${userContent.reduce((a, c) => a + c.text.length, 0)}`);
  const t0 = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    tools: [WRITE_FILES_TOOL],
    tool_choice: { type: "tool", name: "write_files" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
    stream: true,
  });

  let i = 0;
  let deltaCount = 0;
  let chars = 0;
  let lastPrintAt = t0;
  for await (const event of response) {
    i++;
    const t = Date.now() - t0;
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      deltaCount++;
      chars += event.delta.partial_json.length;
      if (Date.now() - lastPrintAt > 500) {
        console.log(`[${t}ms] #${i} delta #${deltaCount} chars=${chars}`);
        lastPrintAt = Date.now();
      }
    } else {
      console.log(`[${t}ms] #${i} ${event.type}`);
    }
  }
  console.log(`smoke-route: done in ${Date.now() - t0}ms, ${i} events, ${chars} json chars`);
}

main().catch((err) => {
  console.error("smoke-route: failed", err);
  process.exit(1);
});
