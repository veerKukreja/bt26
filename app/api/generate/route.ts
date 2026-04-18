import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getAnthropic, MODEL, WRITE_FILES_TOOL } from "@/lib/anthropic";
import { SYSTEM_PROMPT, buildCurrentFilesMessage } from "@/lib/system-prompt";
import type { FileMap, SessionUsage } from "@/lib/types";

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

function buildSystemPrompt(translate: TranslateOption | undefined): string {
  if (!translate) return SYSTEM_PROMPT;
  return `You are translating a web page's user-visible text to ${translate.toLanguage}.

Preserve the full file structure, component hierarchy, styling, imports, comments, and all code exactly as-is. Use the same write_files tool to return the translated source tree with the identical set of files.

Translate ONLY text content inside JSX string children, placeholder attributes, title attributes, alt attributes, aria-label attributes, and user-facing strings in JS constants. Do NOT translate: variable names, function names, imports, CSS property names, tag names, attribute names, or any code-level identifiers.

Keep every file the user sent — even files where nothing needed translation must be returned unchanged.`;
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

      try {
        const systemText = buildSystemPrompt(translate);
        const userInstruction = errorContext
          ? `The previous code you wrote threw this error when it ran:\n\n${errorContext}\n\nPlease fix it. The user's most recent instruction follows. Return the full corrected source tree.`
          : prompt;

        const userContent: Anthropic.Messages.TextBlockParam[] = [];
        if (writeup !== undefined) {
          userContent.push({
            type: "text",
            text: "The user has already planned this app. Build accordingly. Spec:\n" + JSON.stringify(writeup, null, 2),
            cache_control: { type: "ephemeral" },
          });
        }
        userContent.push({
          type: "text",
          text: buildCurrentFilesMessage(currentFiles),
          cache_control: { type: "ephemeral" },
        });
        userContent.push({
          type: "text",
          text: userInstruction,
        });

        const client = resolveAnthropicClient();
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 8000,
          tools: [WRITE_FILES_TOOL],
          tool_choice: { type: "tool", name: "write_files" },
          system: [
            {
              type: "text",
              text: systemText,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: userContent,
            },
          ],
          stream: true,
        });

        let accumulatedJson = "";
        const usage: SessionUsage = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        };

        for await (const event of response) {
          if (event.type === "message_start") {
            const u = event.message.usage;
            if (u) {
              usage.inputTokens = u.input_tokens ?? 0;
              usage.outputTokens = u.output_tokens ?? 0;
              usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
              usage.cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
            }
          } else if (event.type === "message_delta") {
            const u = event.usage;
            if (u) {
              if (typeof u.input_tokens === "number") usage.inputTokens = u.input_tokens;
              if (typeof u.output_tokens === "number") usage.outputTokens = u.output_tokens;
              if (typeof u.cache_read_input_tokens === "number")
                usage.cacheReadTokens = u.cache_read_input_tokens;
              if (typeof u.cache_creation_input_tokens === "number")
                usage.cacheCreationTokens = u.cache_creation_input_tokens;
            }
          } else if (event.type === "content_block_start") {
            const cb = event.content_block;
            if (cb.type === "tool_use") {
              send("tool_start", { name: cb.name });
            }
          } else if (event.type === "content_block_delta") {
            const d = event.delta;
            if (d.type === "input_json_delta") {
              accumulatedJson += d.partial_json;
              send("progress", {
                chars: accumulatedJson.length,
                tail: accumulatedJson.slice(-120),
              });
            } else if (d.type === "text_delta") {
              send("text", { text: d.text });
            }
          }
        }

        let parsed: { summary?: string; files?: Array<{ path: string; contents: string }> };
        try {
          parsed = JSON.parse(accumulatedJson);
        } catch (e) {
          throw new Error(
            `Model returned malformed JSON: ${(e as Error).message}`,
          );
        }

        if (!parsed.files || !Array.isArray(parsed.files)) {
          throw new Error("Model did not return a files array.");
        }

        const files: FileMap = {};
        for (const f of parsed.files) {
          if (f && typeof f.path === "string" && typeof f.contents === "string") {
            files[f.path] = f.contents;
          }
        }

        const totalTokens = usage.inputTokens + usage.cacheCreationTokens + 0.1 * usage.cacheReadTokens;
        const cost = (totalTokens * INPUT_COST_PER_1M + usage.outputTokens * OUTPUT_COST_PER_1M) / 1_000_000;
        dailyCostUsd += cost;
        console.log(`/api/generate: done ip=${ip} in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cacheCreate=${usage.cacheCreationTokens} costUsd=${cost.toFixed(4)} dailyTotalUsd=${dailyCostUsd.toFixed(2)}`);

        send("usage", usage);
        send("done", { files, summary: parsed.summary ?? "Updated" });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        console.error("/api/generate failed:", raw);
        const lower = raw.toLowerCase();
        let safe: string;
        if (lower.includes("api key") || lower.includes("authentication") || lower.includes("unauthorized")) {
          safe = "Auth failed — check ANTHROPIC_API_KEY.";
        } else if (lower.includes("rate limit") || lower.includes("429")) {
          safe = "Rate limited — try again in a moment.";
        } else if (lower.includes("malformed json")) {
          safe = raw.split("\n")[0].slice(0, 200);
        } else if (lower.includes("did not return a files array")) {
          safe = raw;
        } else {
          safe = "Generation failed. See server logs for details.";
        }
        send("error", { message: safe });
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
