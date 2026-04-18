import type Anthropic from "@anthropic-ai/sdk";
import { WRITE_FILES_TOOL } from "../anthropic";
import { SYSTEM_PROMPT, buildCurrentFilesMessage } from "../system-prompt";
import type { FileMap, SessionUsage } from "../types";

export interface GenerateOptions {
  client: Anthropic;
  model: string;
  prompt: string;
  currentFiles: FileMap;
  errorContext?: string;
  translate?: { toLanguage: string };
  writeup?: unknown;
  context?: string;
  maxTokens?: number;
}

export type GenerateEvent =
  | { type: "tool_start"; name: string }
  | { type: "progress"; chars: number; tail: string }
  | { type: "text"; text: string }
  | { type: "usage"; usage: SessionUsage }
  | { type: "done"; files: FileMap; summary: string }
  | { type: "error"; message: string };

function buildSystemPrompt(translate?: { toLanguage: string }): string {
  if (!translate) return SYSTEM_PROMPT;
  return `You are translating a web page's user-visible text to ${translate.toLanguage}.

Preserve the full file structure, component hierarchy, styling, imports, comments, and all code exactly as-is. Use the same write_files tool to return the translated source tree with the identical set of files.

Translate ONLY text content inside JSX string children, placeholder attributes, title attributes, alt attributes, aria-label attributes, and user-facing strings in JS constants. Do NOT translate: variable names, function names, imports, CSS property names, tag names, attribute names, or any code-level identifiers.

Keep every file the user sent — even files where nothing needed translation must be returned unchanged.`;
}

export function sanitizeError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("api key") || lower.includes("authentication") || lower.includes("unauthorized")) {
    return "Auth failed — check ANTHROPIC_API_KEY.";
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "Rate limited — try again in a moment.";
  }
  if (lower.includes("malformed json")) {
    return raw.split("\n")[0].slice(0, 200);
  }
  if (lower.includes("did not return a files array")) {
    return raw;
  }
  return "Generation failed. See server logs for details.";
}

export async function* streamGenerate(
  opts: GenerateOptions,
): AsyncGenerator<GenerateEvent> {
  const {
    client,
    model,
    prompt,
    currentFiles,
    errorContext,
    translate,
    writeup,
    context,
    maxTokens = 32000,
  } = opts;

  try {
    const systemText = buildSystemPrompt(translate);
    const userInstruction = errorContext
      ? `The previous code you wrote threw this error when it ran:\n\n${errorContext}\n\nPlease fix it. The user's most recent instruction follows. Return the full corrected source tree.`
      : prompt;

    const userContent: Anthropic.Messages.TextBlockParam[] = [];
    if (writeup !== undefined) {
      userContent.push({
        type: "text",
        text:
          "The user has already planned this app. Build accordingly. Spec:\n" +
          JSON.stringify(writeup, null, 2),
        cache_control: { type: "ephemeral" },
      });
    }
    if (context) {
      userContent.push({
        type: "text",
        text:
          "Context gathered from external sources before this build:\n" +
          context,
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

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      tools: [WRITE_FILES_TOOL],
      tool_choice: { type: "tool", name: "write_files" },
      system: [
        {
          type: "text",
          text: systemText,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
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
          yield { type: "tool_start", name: cb.name };
        }
      } else if (event.type === "content_block_delta") {
        const d = event.delta;
        if (d.type === "input_json_delta") {
          accumulatedJson += d.partial_json;
          yield {
            type: "progress",
            chars: accumulatedJson.length,
            tail: accumulatedJson.slice(-120),
          };
        } else if (d.type === "text_delta") {
          yield { type: "text", text: d.text };
        }
      }
    }

    let parsed: {
      summary?: string;
      files?: Array<{ path: string; contents: string }>;
    };
    try {
      parsed = JSON.parse(accumulatedJson);
    } catch (e) {
      throw new Error(`Model returned malformed JSON: ${(e as Error).message}`);
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

    yield { type: "usage", usage };
    yield { type: "done", files, summary: parsed.summary ?? "Updated" };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    yield { type: "error", message: sanitizeError(raw) };
  }
}
