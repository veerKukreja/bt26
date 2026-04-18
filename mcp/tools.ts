import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL } from "../lib/anthropic";
import { streamGenerate } from "../lib/prism-core/generate";
import { DEFAULT_APP } from "../lib/default-app";
import type { FileMap, Snapshot } from "../lib/types";
import {
  currentFilesOf,
  listSessions,
  loadSession,
  publicUrl,
  saveSession,
  type McpSession,
} from "./storage";

// Runs streamGenerate to completion in-memory and returns the final state.
async function runGeneration(opts: {
  client: Anthropic;
  prompt: string;
  currentFiles: FileMap;
}): Promise<{ files: FileMap; summary: string } | { error: string }> {
  let finalFiles: FileMap | null = null;
  let finalSummary = "";
  let error: string | null = null;

  for await (const ev of streamGenerate({
    client: opts.client,
    model: MODEL,
    prompt: opts.prompt,
    currentFiles: opts.currentFiles,
  })) {
    if (ev.type === "done") {
      finalFiles = ev.files;
      finalSummary = ev.summary;
    } else if (ev.type === "error") {
      error = ev.message;
    }
  }

  if (error) return { error };
  if (!finalFiles) return { error: "Generation ended without producing files." };
  return { files: finalFiles, summary: finalSummary || "Updated" };
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function registerTools(server: McpServer): void {
  const client = getAnthropic();

  // 1. create session
  server.registerTool(
    "prism_create_session",
    {
      description:
        "Create a new Prism session by generating a webpage from a natural-language prompt. Returns the session id, shareable URL (if a public origin is configured), and a summary of what was built.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe("Natural-language description of the page to build."),
      },
    },
    async ({ prompt }) => {
      const gen = await runGeneration({
        client,
        prompt,
        currentFiles: DEFAULT_APP,
      });
      if ("error" in gen) return errorResult(gen.error);

      const sessionId = randomUUID();
      const now = new Date().toISOString();
      const snapshotId = randomUUID();
      const snapshot: Snapshot = {
        id: snapshotId,
        sessionId,
        parentId: null,
        createdAt: now,
        prompt,
        summary: gen.summary,
        files: gen.files,
      };
      const session: McpSession = {
        id: sessionId,
        createdAt: now,
        parentSnapshotId: null,
        snapshots: [snapshot],
        currentSnapshotId: snapshotId,
      };
      await saveSession(session);

      return textResult({
        sessionId,
        url: publicUrl(sessionId),
        snapshotId,
        summary: gen.summary,
      });
    },
  );

  // 2. list sessions
  server.registerTool(
    "prism_list_sessions",
    {
      description: "List every Prism session stored locally.",
      inputSchema: {},
    },
    async () => {
      const sessions = await listSessions();
      return textResult(
        sessions.map((s) => ({
          sessionId: s.id,
          url: publicUrl(s.id),
          createdAt: s.createdAt,
          snapshotCount: s.snapshots.length,
          lastSummary: s.snapshots[s.snapshots.length - 1]?.summary ?? "",
        })),
      );
    },
  );

  // 3. get session
  server.registerTool(
    "prism_get_session",
    {
      description:
        "Fetch a session's full state: URL, all snapshots (each with prompt, summary, and files), and the currently-active snapshot index.",
      inputSchema: {
        sessionId: z.string().describe("Session id from prism_create_session."),
      },
    },
    async ({ sessionId }) => {
      const s = await loadSession(sessionId);
      if (!s) return errorResult(`Session ${sessionId} not found.`);
      const currentIndex = s.snapshots.findIndex(
        (snap) => snap.id === s.currentSnapshotId,
      );
      return textResult({
        sessionId: s.id,
        url: publicUrl(s.id),
        currentIndex: currentIndex === -1 ? s.snapshots.length - 1 : currentIndex,
        snapshots: s.snapshots.map((snap) => ({
          id: snap.id,
          createdAt: snap.createdAt,
          prompt: snap.prompt,
          summary: snap.summary,
          files: snap.files,
        })),
        currentFiles: currentFilesOf(s),
      });
    },
  );

  // 4. generate — add a turn to existing session
  server.registerTool(
    "prism_generate",
    {
      description:
        "Add a new generation turn to an existing session. The new snapshot is applied on top of the session's current snapshot.",
      inputSchema: {
        sessionId: z.string().describe("Session to modify."),
        prompt: z.string().min(1).describe("What the page should become next."),
      },
    },
    async ({ sessionId, prompt }) => {
      const s = await loadSession(sessionId);
      if (!s) return errorResult(`Session ${sessionId} not found.`);

      const current = currentFilesOf(s);
      const base = Object.keys(current).length > 0 ? current : DEFAULT_APP;
      const gen = await runGeneration({ client, prompt, currentFiles: base });
      if ("error" in gen) return errorResult(gen.error);

      const now = new Date().toISOString();
      const snapshotId = randomUUID();
      const snapshot: Snapshot = {
        id: snapshotId,
        sessionId: s.id,
        parentId: s.currentSnapshotId,
        createdAt: now,
        prompt,
        summary: gen.summary,
        files: gen.files,
      };
      s.snapshots.push(snapshot);
      s.currentSnapshotId = snapshotId;
      await saveSession(s);

      return textResult({
        snapshotId,
        summary: gen.summary,
        fileCount: Object.keys(gen.files).length,
      });
    },
  );

  // 5. fork
  server.registerTool(
    "prism_fork",
    {
      description:
        "Fork a session into a new one. By default forks from the current snapshot; pass snapshotIndex to fork from an earlier point.",
      inputSchema: {
        sessionId: z.string().describe("Session to fork from."),
        snapshotIndex: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Optional snapshot index; defaults to the current snapshot."),
      },
    },
    async ({ sessionId, snapshotIndex }) => {
      const s = await loadSession(sessionId);
      if (!s) return errorResult(`Session ${sessionId} not found.`);

      const idx =
        snapshotIndex === undefined
          ? s.snapshots.findIndex((snap) => snap.id === s.currentSnapshotId)
          : snapshotIndex;
      const source = s.snapshots[idx === -1 ? s.snapshots.length - 1 : idx];
      if (!source) return errorResult(`Snapshot index ${snapshotIndex} out of range.`);

      const newSessionId = randomUUID();
      const now = new Date().toISOString();
      const newSnapshotId = randomUUID();
      const snapshot: Snapshot = {
        id: newSnapshotId,
        sessionId: newSessionId,
        parentId: source.id,
        createdAt: now,
        prompt: source.prompt,
        summary: source.summary,
        files: source.files,
      };
      const forked: McpSession = {
        id: newSessionId,
        createdAt: now,
        parentSnapshotId: source.id,
        snapshots: [snapshot],
        currentSnapshotId: newSnapshotId,
      };
      await saveSession(forked);

      return textResult({
        sessionId: newSessionId,
        url: publicUrl(newSessionId),
      });
    },
  );

  // 6. export
  server.registerTool(
    "prism_export",
    {
      description:
        "Export the current snapshot of a session as a zip archive, a standalone HTML file, or a CodeSandbox share URL.",
      inputSchema: {
        sessionId: z.string().describe("Session to export."),
        format: z
          .enum(["zip", "html", "codesandbox"])
          .describe("Output format."),
      },
    },
    async ({ sessionId, format }) => {
      const s = await loadSession(sessionId);
      if (!s) return errorResult(`Session ${sessionId} not found.`);

      const files = currentFilesOf(s);
      if (Object.keys(files).length === 0) {
        return errorResult(`Session ${sessionId} has no current snapshot.`);
      }

      try {
        // Dynamic import — the export module references browser-friendly APIs
        // but its pure builders (buildZip, buildCodeSandboxUrl, exportFilename)
        // work in Node too.
        const exportModule = await import("../lib/export");
        const current = s.snapshots.find((snap) => snap.id === s.currentSnapshotId);
        const meta = {
          summary: current?.summary ?? "prism-export",
          id: s.id,
        };

        if (format === "codesandbox") {
          const { url } = exportModule.buildCodeSandboxUrl(files);
          return textResult({ kind: "codesandbox", url });
        }

        if (format === "zip") {
          const blob = await exportModule.buildZip(files, meta);
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          const filename = exportModule.exportFilename(meta, "zip");
          return textResult({ kind: "zip", filename, base64 });
        }

        // html format — needs the HTTP bundler route; for local MCP we emit
        // a URL the user can fetch if the Next.js server is running.
        const origin = process.env.PRISM_PUBLIC_ORIGIN?.trim();
        if (!origin) {
          return errorResult(
            "HTML export requires the Next.js server to be running and PRISM_PUBLIC_ORIGIN to be set. Try 'zip' or 'codesandbox' instead.",
          );
        }
        return textResult({
          kind: "html",
          note: "POST the session's current files to /api/export/html on the Next.js server to retrieve the bundle.",
          endpoint: `${origin.replace(/\/$/, "")}/api/export/html`,
        });
      } catch (err) {
        return errorResult(
          `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
