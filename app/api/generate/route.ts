import { NextRequest } from "next/server";
import { getAnthropic, MODEL, WRITE_FILES_TOOL } from "@/lib/anthropic";
import { SYSTEM_PROMPT, buildCurrentFilesMessage } from "@/lib/system-prompt";
import type { FileMap, SessionUsage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface GenerateBody {
  prompt: string;
  currentFiles: FileMap;
  errorContext?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateBody;
  const { prompt, currentFiles, errorContext } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const userInstruction = errorContext
          ? `The previous code you wrote threw this error when it ran:\n\n${errorContext}\n\nPlease fix it. The user's most recent instruction was: "${prompt}". Return the full corrected source tree.`
          : prompt;

        const response = await getAnthropic().messages.create({
          model: MODEL,
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
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: buildCurrentFilesMessage(currentFiles),
                  cache_control: { type: "ephemeral" },
                },
                {
                  type: "text",
                  text: userInstruction,
                },
              ],
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
            `Model returned malformed JSON: ${(e as Error).message}. Raw tail: ${accumulatedJson.slice(-200)}`,
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
