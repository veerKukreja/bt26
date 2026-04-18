import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FileMap, Snapshot, Session } from "../lib/types";

export interface McpSession extends Session {
  snapshots: Snapshot[];
  currentSnapshotId: string | null;
}

export const SESSIONS_ROOT = join(homedir(), ".prism", "sessions");

async function ensureDir(): Promise<void> {
  await mkdir(SESSIONS_ROOT, { recursive: true });
}

export async function saveSession(session: McpSession): Promise<void> {
  await ensureDir();
  const path = join(SESSIONS_ROOT, `${session.id}.json`);
  await writeFile(path, JSON.stringify(session, null, 2), "utf-8");
}

export async function loadSession(sessionId: string): Promise<McpSession | null> {
  const path = join(SESSIONS_ROOT, `${sessionId}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as McpSession;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<McpSession[]> {
  await ensureDir();
  let entries: string[];
  try {
    entries = await readdir(SESSIONS_ROOT);
  } catch {
    return [];
  }
  const sessions: McpSession[] = [];
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(SESSIONS_ROOT, file), "utf-8");
      sessions.push(JSON.parse(raw) as McpSession);
    } catch {
      // skip corrupt files
    }
  }
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function currentFilesOf(session: McpSession): FileMap {
  const current = session.snapshots.find((s) => s.id === session.currentSnapshotId);
  return current?.files ?? {};
}

export function publicUrl(sessionId: string): string | null {
  const origin = process.env.PRISM_PUBLIC_ORIGIN?.trim();
  if (!origin) return null;
  return `${origin.replace(/\/$/, "")}/s/${sessionId}`;
}
