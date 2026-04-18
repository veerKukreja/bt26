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

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface FeatureInventory {
  summary: string;
  features: Array<{
    name: string;
    description: string;
    priority: "table-stakes" | "differentiator" | "nice-to-have";
  }>;
  userFlows: Array<{ name: string; steps: string[] }>;
  designLanguage: { palette: string[]; typography: string; vibe: string };
  copyExamples: string[];
}
