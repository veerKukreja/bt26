import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { streamGenerate, sanitizeError, gatherContext } from "@/lib/prism-core";
import { getAllClients, listConfiguredServers } from "@/lib/mcp-clients";
import type { FileMap } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const QUOTA_PER_HOUR = 30;
const QUOTA_PER_DAY = 200;
const MAX_PROMPT_BYTES = 10_000;
const INJECTION_PHRASES = [
  "ignore previous instructions",
  "ignore all previous",
  "system prompt",
  "reveal your system",
  "print your system",
];
const INPUT_COST_PER_1M = 3;
const OUTPUT_COST_PER_1M = 15;

interface TranslateOption {
  toLanguage: string;
}

interface GenerateBody {
  prompt: string;
  currentFiles: FileMap;
  errorContext?: string;
  translate?: TranslateOption;
  writeup?: unknown;
}

type IpRecord = { hour: number[]; day: number[] };
const quotaStore = new Map<string, IpRecord>();

let dailyCostUsd = 0;
let dailyCostDate = new Date().toISOString().slice(0, 10);

function resetDailyCostIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyCostDate) {
    dailyCostUsd = 0;
    dailyCostDate = today;
  }
}

function pruneAndCheckQuota(ip: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  const hourCutoff = now - 60 * 60 * 1000;
  const dayCutoff = now - 24 * 60 * 60 * 1000;
  let rec = quotaStore.get(ip);
  if (!rec) {
    rec = { hour: [], day: [] };
    quotaStore.set(ip, rec);
  }
  rec.hour = rec.hour.filter((t) => t > hourCutoff);
  rec.day = rec.day.filter((t) => t > dayCutoff);
  if (rec.hour.length >= QUOTA_PER_HOUR) return { ok: false, reason: "hourly" };
  if (rec.day.length >= QUOTA_PER_DAY) return { ok: false, reason: "daily" };
  rec.hour.push(now);
  rec.day.push(now);
  return { ok: true };
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

function resolveAnthropicClient(): Anthropic {
  const serverKey = process.env.SERVER_ANTHROPIC_API_KEY?.trim();
  if (serverKey) return new Anthropic({ apiKey: serverKey });
  return getAnthropic();
}

export async function POST(req: NextRequest) {
  resetDailyCostIfNeeded();

  const ceilingRaw = process.env.SERVER_DAILY_COST_CEILING_USD;
  const ceiling = ceilingRaw ? Number(ceilingRaw) : 50;
  if (Number.isFinite(ceiling) && dailyCostUsd > ceiling) {
    return jsonResponse(503, { error: "Daily cost ceiling reached; try tomorrow." });
  }

  const ip = clientIp(req);
  const q = pruneAndCheckQuota(ip);
  if (!q.ok) {
    return jsonResponse(429, {
      error: q.reason === "hourly" ? "Hourly rate limit exceeded." : "Daily rate limit exceeded.",
    });
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return jsonResponse(400, { error: "Malformed JSON body." });
  }

  if (!body || typeof body !== "object") {
    return jsonResponse(400, { error: "Malformed request body." });
  }
  if (typeof body.prompt !== "string" || typeof body.currentFiles !== "object" || body.currentFiles === null) {
    return jsonResponse(400, { error: "Missing required fields." });
  }

  const { prompt, currentFiles, errorContext, translate, writeup } = body;

  if (prompt.length > MAX_PROMPT_BYTES) {
    return jsonResponse(400, { error: "Prompt too long." });
  }
  const lowerPrompt = prompt.toLowerCase();
  for (const phrase of INJECTION_PHRASES) {
    if (lowerPrompt.includes(phrase)) {
      return jsonResponse(400, { error: "Prompt rejected by abuse filter." });
    }
  }

  const authMode = process.env.SERVER_ANTHROPIC_API_KEY ? "server-key" : "user-key";
  console.log(`/api/generate: ip=${ip} authMode=${authMode} translate=${!!translate} writeup=${!!writeup}`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const t0 = Date.now();
      let streamOpened = false;
      let finalPrompt = prompt;
      let gatheredContext: string | undefined;

      try {
        const client = resolveAnthropicClient();

        // Phase B: opt-in MCP context-gathering pass.
        const mcpTrigger = /^@mcp\b\s*/i;
        if (mcpTrigger.test(prompt)) {
          finalPrompt = prompt.replace(mcpTrigger, "").trim();
          const configured = await listConfiguredServers();
          send("mcp_gathering", { servers: configured });
          if (configured.length > 0) {
            try {
              const mcpClients = await getAllClients();
              const gathered = await gatherContext({
                client,
                model: MODEL,
                userPrompt: finalPrompt,
                mcpClients,
              });
              gatheredContext = gathered.summary;
              send("mcp_gathered", {
                summary: gathered.summary,
                toolCalls: gathered.toolCallCount,
                timedOut: gathered.timedOut,
              });
            } catch (err) {
              console.error("MCP gather failed:", err);
              send("mcp_gathered", {
                summary: "(gather failed; proceeding without context)",
                toolCalls: 0,
                timedOut: false,
              });
            }
          } else {
            send("mcp_gathered", {
              summary: "(no MCP servers configured)",
              toolCalls: 0,
              timedOut: false,
            });
          }
        }

        for await (const ev of streamGenerate({
          client,
          model: MODEL,
          prompt: finalPrompt,
          currentFiles,
          errorContext,
          translate,
          writeup,
          context: gatheredContext,
        })) {
          if (!streamOpened) {
            streamOpened = true;
            console.log(`/api/generate: first event in ${Date.now() - t0}ms`);
          }
          switch (ev.type) {
            case "tool_start":
              send("tool_start", { name: ev.name });
              break;
            case "progress":
              send("progress", { chars: ev.chars, tail: ev.tail });
              break;
            case "text":
              send("text", { text: ev.text });
              break;
            case "usage": {
              send("usage", ev.usage);
              const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = ev.usage;
              const totalInput = inputTokens + cacheCreationTokens + 0.1 * cacheReadTokens;
              const cost =
                (totalInput * INPUT_COST_PER_1M + outputTokens * OUTPUT_COST_PER_1M) / 1_000_000;
              dailyCostUsd += cost;
              console.log(
                `/api/generate: done ip=${ip} in=${inputTokens} out=${outputTokens} cacheRead=${cacheReadTokens} cacheCreate=${cacheCreationTokens} costUsd=${cost.toFixed(4)} dailyTotalUsd=${dailyCostUsd.toFixed(2)}`,
              );
              break;
            }
            case "done":
              send("done", { files: ev.files, summary: ev.summary });
              break;
            case "error":
              console.error("/api/generate failed:", ev.message);
              send("error", { message: ev.message });
              break;
          }
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        console.error("/api/generate failed:", raw);
        send("error", { message: sanitizeError(raw) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
