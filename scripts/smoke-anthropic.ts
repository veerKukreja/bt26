// Minimal smoke test to check if Anthropic API streaming works at all.
// Usage: npx tsx scripts/smoke-anthropic.ts
// Prints each stream event with elapsed time so you can see exactly where it stalls.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

  console.log(`smoke: model=${model}`);
  const t0 = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: 200,
    messages: [{ role: "user", content: "say hi in 3 words" }],
    stream: true,
  });

  let i = 0;
  for await (const event of response) {
    i++;
    const t = Date.now() - t0;
    console.log(`[${t}ms] #${i} ${event.type}`);
    if (i > 50) break;
  }
  console.log(`smoke: done in ${Date.now() - t0}ms, ${i} events`);
}

main().catch((err) => {
  console.error("smoke: failed", err);
  process.exit(1);
});
