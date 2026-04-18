// Quick Gemini API verification — same pattern as smoke-https but hitting
// Google's generativelanguage API.
import https from "node:https";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolveKey(): string {
  const env = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (env?.trim()) return env.trim();
  return readFileSync(join(homedir(), ".gemini-api-key"), "utf8").trim();
}

async function main() {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const apiKey = resolveKey();

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "say hi in 3 words" }] }],
    generationConfig: { maxOutputTokens: 100, temperature: 0.7 },
  });

  const path = `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  console.log(`smoke-gemini: model=${model}`);
  const t0 = Date.now();

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: "generativelanguage.googleapis.com",
        path,
        port: 443,
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "content-length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
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
        let events = 0;
        let text = "";
        const process = (block: string) => {
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("data: ")) data += line.slice(6);
            else if (line.startsWith("data:")) data += line.slice(5).trimStart();
          }
          if (!data) return;
          events++;
          try {
            const parsed = JSON.parse(data) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            for (const c of parsed.candidates ?? []) {
              for (const p of c.content?.parts ?? []) {
                if (p.text) text += p.text;
              }
            }
          } catch {
            /* ignore */
          }
        };
        res.on("data", (chunk: string) => {
          buffer += chunk;
          for (;;) {
            const lf = buffer.indexOf("\n\n");
            const crlf = buffer.indexOf("\r\n\r\n");
            if (lf === -1 && crlf === -1) break;
            const useLf = lf !== -1 && (crlf === -1 || lf < crlf);
            const idx = useLf ? lf : crlf;
            const sepLen = useLf ? 2 : 4;
            process(buffer.slice(0, idx));
            buffer = buffer.slice(idx + sepLen);
          }
        });
        res.on("end", () => {
          if (buffer.trim().length > 0) process(buffer);
          console.log(`smoke-gemini: done in ${Date.now() - t0}ms events=${events}`);
          console.log(`smoke-gemini: text="${text}"`);
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
  console.error("smoke-gemini: failed", err);
  process.exit(1);
});
