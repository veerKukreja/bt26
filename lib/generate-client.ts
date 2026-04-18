// Browser-side generation: POST directly to Anthropic's API from the user's
// browser, bypassing Next.js entirely. The server route was starving SSE
// streams under Next 16 dev; the browser fetch works normally.
//
// API key is hardcoded at build time via NEXT_PUBLIC_ANTHROPIC_API_KEY in
// .env.local. Next inlines that value into the browser bundle.
//
// WARNING: this is a dev-oriented setup — your key is embedded in the
// browser JS and visible to anyone who loads the site. Do NOT deploy this
// publicly. The right production setup is server-side with the key hidden.

import { SYSTEM_PROMPT, buildCurrentFilesMessage } from "./system-prompt";
import type { FileMap, SessionUsage, WriteUp } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5";

const WRITE_FILES_TOOL = {
  name: "write_files",
  description:
    "Write the complete source tree for the new version of the website. Files you don't include are deleted. Keep it compact.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "One short sentence describing what changed. Shown as a caption on the timeline.",
      },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path within the sandbox, e.g. '/App.tsx'" },
            contents: { type: "string", description: "Complete file contents" },
          },
          required: ["path", "contents"],
        },
      },
    },
    required: ["summary", "files"],
  },
};

function resolveApiKey(): string | null {
  const envKey = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
  if (envKey && envKey.trim().length > 0) return envKey.trim();
  return null;
}

export interface GenerateCallbacks {
  onToolStart?: () => void;
  onProgress?: (chars: number, tail: string) => void;
  onText?: (text: string) => void;
  onUsage?: (usage: SessionUsage) => void;
  onMcpGathering?: (servers: string[]) => void;
  onMcpGathered?: (summary: string, toolCalls: number, timedOut: boolean) => void;
  onDone: (files: FileMap, summary: string) => void;
  onError: (message: string) => void;
}

export interface StreamGenerateArgs {
  prompt: string;
  currentFiles: FileMap;
  errorContext?: string;
  translate?: { toLanguage: string };
  writeup?: WriteUp;
  signal?: AbortSignal;
}

function buildSystemText(translate?: { toLanguage: string }): string {
  if (!translate) return SYSTEM_PROMPT;
  return `You are translating a web page's user-visible text to ${translate.toLanguage}.

Preserve the full file structure, component hierarchy, styling, imports, comments, and all code exactly as-is. Use the same write_files tool to return the translated source tree with the identical set of files.

Translate ONLY text content inside JSX string children, placeholder attributes, title attributes, alt attributes, aria-label attributes, and user-facing strings in JS constants. Do NOT translate: variable names, function names, imports, CSS property names, tag names, attribute names, or any code-level identifiers.

Keep every file the user sent — even files where nothing needed translation must be returned unchanged.`;
}

export async function streamGenerate(
  args: StreamGenerateArgs,
  cb: GenerateCallbacks,
): Promise<void> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    cb.onError("NEXT_PUBLIC_ANTHROPIC_API_KEY is not set. Add it to .env.local and restart dev.");
    return;
  }

  const userInstruction = args.errorContext
    ? `The previous code you wrote threw this error when it ran:\n\n${args.errorContext}\n\nPlease fix it. The user's most recent instruction follows. Return the full corrected source tree.`
    : args.prompt;

  const userContent: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [];
  if (args.writeup !== undefined) {
    userContent.push({
      type: "text",
      text: "The user has already planned this app. Build accordingly. Spec:\n" + JSON.stringify(args.writeup, null, 2),
      cache_control: { type: "ephemeral" },
    });
  }
  userContent.push({
    type: "text",
    text: buildCurrentFilesMessage(args.currentFiles),
    cache_control: { type: "ephemeral" },
  });
  userContent.push({ type: "text", text: userInstruction });

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      signal: args.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 32000,
        tools: [WRITE_FILES_TOOL],
        tool_choice: { type: "tool", name: "write_files" },
        system: [{ type: "text", text: buildSystemText(args.translate), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
        stream: true,
      }),
    });
  } catch (err) {
    cb.onError((err as Error).message);
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    cb.onError(`Anthropic HTTP ${res.status}: ${text.slice(0, 400)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedJson = "";
  const usage: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let toolStartFired = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx === -1) break;
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        let eventName = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) eventName = line.slice(7).trim();
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (typeof payload !== "object" || payload === null) continue;
        const p = payload as Record<string, unknown>;

        if (eventName === "message_start") {
          const msg = p.message as { usage?: Record<string, number> } | undefined;
          if (msg?.usage) {
            usage.inputTokens = msg.usage.input_tokens ?? 0;
            usage.outputTokens = msg.usage.output_tokens ?? 0;
            usage.cacheReadTokens = msg.usage.cache_read_input_tokens ?? 0;
            usage.cacheCreationTokens = msg.usage.cache_creation_input_tokens ?? 0;
          }
        } else if (eventName === "message_delta") {
          const u = p.usage as Record<string, number> | undefined;
          if (u) {
            if (typeof u.input_tokens === "number") usage.inputTokens = u.input_tokens;
            if (typeof u.output_tokens === "number") usage.outputTokens = u.output_tokens;
            if (typeof u.cache_read_input_tokens === "number") usage.cacheReadTokens = u.cache_read_input_tokens;
            if (typeof u.cache_creation_input_tokens === "number")
              usage.cacheCreationTokens = u.cache_creation_input_tokens;
          }
        } else if (eventName === "content_block_start") {
          const cb2 = p.content_block as { type?: string; name?: string } | undefined;
          if (cb2?.type === "tool_use" && !toolStartFired) {
            toolStartFired = true;
            cb.onToolStart?.();
          }
        } else if (eventName === "content_block_delta") {
          const d = p.delta as { type?: string; partial_json?: string; text?: string } | undefined;
          if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
            accumulatedJson += d.partial_json;
            cb.onProgress?.(accumulatedJson.length, accumulatedJson.slice(-120));
          } else if (d?.type === "text_delta" && typeof d.text === "string") {
            cb.onText?.(d.text);
          }
        }
      }
    }
  } catch (err) {
    cb.onError((err as Error).message);
    return;
  }

  cb.onUsage?.(usage);

  let parsed: { summary?: string; files?: Array<{ path: string; contents: string }> };
  try {
    parsed = JSON.parse(accumulatedJson);
  } catch (e) {
    cb.onError(`Model returned malformed JSON: ${(e as Error).message}`);
    return;
  }
  if (!parsed.files || !Array.isArray(parsed.files)) {
    cb.onError("Model did not return a files array.");
    return;
  }
  const files: FileMap = {};
  for (const f of parsed.files) {
    if (f && typeof f.path === "string" && typeof f.contents === "string") {
      files[f.path] = f.contents;
    }
  }
  cb.onDone(files, parsed.summary ?? "Updated");
}
