import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let _client: Anthropic | null = null;
let _apiKey: string | null = null;

function resolveApiKey(): string {
  if (_apiKey) return _apiKey;
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.trim()) {
    _apiKey = envKey.trim();
    return _apiKey;
  }
  // Fallback: ~/.anthropic-api-key — user's preferred storage location.
  try {
    const home = homedir();
    const path = join(home, ".anthropic-api-key");
    const contents = readFileSync(path, "utf8").trim();
    if (contents) {
      _apiKey = contents;
      return _apiKey;
    }
  } catch {
    /* ignore */
  }
  throw new Error(
    "ANTHROPIC_API_KEY is not set. Put it in .env.local or ~/.anthropic-api-key.",
  );
}

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: resolveApiKey() });
  return _client;
}

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

export const WRITE_FILES_TOOL = {
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
            path: {
              type: "string",
              description: "Absolute path within the sandbox, e.g. '/App.tsx'",
            },
            contents: {
              type: "string",
              description: "Complete file contents",
            },
          },
          required: ["path", "contents"],
        },
      },
    },
    required: ["summary", "files"],
  },
};
