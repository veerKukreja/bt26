import { NextRequest } from "next/server";
import { getAnthropic, MODEL, WRITE_FILES_TOOL } from "@/lib/anthropic";
import { SYSTEM_PROMPT, buildCurrentFilesMessage } from "@/lib/system-prompt";
import type { FileMap } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface GenerateBody {
  prompt: string;
  currentFiles: FileMap;
  errorContext?: string;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

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

        for await (const event of response) {
          if (event.type === "content_block_start") {
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
          } else if (event.type === "message_stop") {
            // handled after loop
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

        send("done", { files, summary: parsed.summary ?? "Updated" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { message });
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
