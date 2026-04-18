export type FileMap = Record<string, string>;

export interface Snapshot {
  id: string;
  sessionId: string;
  parentId: string | null;
  createdAt: string;
  prompt: string;
  summary: string;
  files: FileMap;
}

export interface Session {
  id: string;
  createdAt: string;
  parentSnapshotId: string | null;
}

export type GenerateEvent =
  | { type: "thinking"; text: string }
  | { type: "file_start"; path: string }
  | { type: "file_delta"; path: string; delta: string }
  | { type: "file_done"; path: string; contents: string }
  | { type: "done"; files: FileMap; summary: string }
  | { type: "error"; message: string };

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
