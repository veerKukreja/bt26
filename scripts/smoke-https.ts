// Smoke test using Node's native https module + manual SSE parsing.
// Zero fetch, zero SDK — should be immune to anything Next does to streams.
import https from "node:https";
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
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
  const apiKey = resolveKey();

  const userContent = [
    {
      type: "text",
      text: buildCurrentFilesMessage(DEFAULT_APP),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: "Add a bright red header saying Hello." },
  ];

  const body = JSON.stringify({
    model,
    max_tokens: 8000,
    tools: [WRITE_FILES_TOOL],
    tool_choice: { type: "tool", name: "write_files" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
    stream: true,
  });

  console.log(`smoke-https: model=${model} bodyLen=${body.length}`);
  const t0 = Date.now();

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        port: 443,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          accept: "text/event-stream",
          "content-length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode !== 200) {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            reject(
              new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`),
            ),
          );
          return;
        }
        res.setEncoding("utf8");
        let buffer = "";
        const counts: Record<string, number> = {};
        let deltaChars = 0;
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let evt = "message";
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) evt = line.slice(7).trim();
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (!data) continue;
            counts[evt] = (counts[evt] ?? 0) + 1;
            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                delta?: { type?: string; partial_json?: string };
              };
              if (
                parsed.type === "content_block_delta" &&
                parsed.delta?.type === "input_json_delta" &&
                parsed.delta.partial_json
              ) {
                deltaChars += parsed.delta.partial_json.length;
              }
            } catch {
              /* ignore */
            }
          }
        });
        res.on("end", () => {
          console.log(`smoke-https: done in ${Date.now() - t0}ms deltaChars=${deltaChars}`);
          console.log(`smoke-https: counts:`, counts);
          resolve();
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

main().catch((err) => {
  console.error("smoke-https: failed", err);
  process.exit(1);
});
