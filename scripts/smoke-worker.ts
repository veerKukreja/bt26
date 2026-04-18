// Verify worker_threads + inline JS pattern works for Gemini requests.
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WORKER_SRC = `
const https = require('node:https');
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (msg) => {
  if (msg.type !== 'request') return;
  const { url, body } = msg;
  const parsed = new URL(url);
  const req = https.request({
    method: 'POST',
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    port: parsed.port || 443,
    agent: false,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'content-length': Buffer.byteLength(body).toString(),
    },
  }, (res) => {
    parentPort.postMessage({ type: 'status', status: res.statusCode });
    res.setEncoding('utf8');
    res.on('data', (c) => parentPort.postMessage({ type: 'chunk', chunk: c }));
    res.on('end', () => parentPort.postMessage({ type: 'end' }));
    res.on('error', (err) => parentPort.postMessage({ type: 'error', message: err.message }));
  });
  req.on('socket', (s) => s.setTimeout(0));
  req.setTimeout(0);
  req.on('error', (err) => parentPort.postMessage({ type: 'error', message: err.message }));
  req.write(body);
  req.end();
});
`;

function resolveKey(): string {
  const env = process.env.GEMINI_API_KEY;
  if (env?.trim()) return env.trim();
  return readFileSync(join(homedir(), ".gemini-api-key"), "utf8").trim();
}

async function main() {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const apiKey = resolveKey();
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "say hi in 3 words" }] }],
    generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  console.log(`smoke-worker: spawn`);
  const t0 = Date.now();
  const worker = new Worker(WORKER_SRC, { eval: true });

  let text = "";
  let chunks = 0;
  await new Promise<void>((resolve, reject) => {
    worker.on("message", (msg: { type: string; [k: string]: unknown }) => {
      if (msg.type === "status") console.log(`[${Date.now() - t0}ms] status=${msg.status}`);
      else if (msg.type === "chunk") {
        chunks++;
        const c = msg.chunk as string;
        // crude parse
        for (const line of c.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const d = JSON.parse(line.slice(6)) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              };
              for (const cand of d.candidates ?? []) {
                for (const p of cand.content?.parts ?? []) {
                  if (p.text) text += p.text;
                }
              }
            } catch {
              /* ignore */
            }
          }
        }
      } else if (msg.type === "end") {
        console.log(`[${Date.now() - t0}ms] end chunks=${chunks} text="${text}"`);
        resolve();
      } else if (msg.type === "error") {
        reject(new Error(String(msg.message)));
      }
    });
    worker.on("error", reject);
    worker.postMessage({ type: "request", url, body });
  });

  await worker.terminate();
}

main().catch((e) => {
  console.error("smoke-worker failed", e);
  process.exit(1);
});
