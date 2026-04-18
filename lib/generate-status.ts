// Heuristics that turn raw stream state into a human-friendly status phrase.
// The server streams a sliding 120-char tail of the accumulating JSON tool
// call ({ "summary": "...", "files": [{ "path": "...", "contents": "..." }] }).
// We can read it for phase transitions without modifying the protocol.

export interface StreamState {
  chars: number;
  tail: string;
  elapsedMs: number;
  filesDone: number;
  currentFile: string | null;
  mcpLabel: string | null;
  toolStarted: boolean;
}

export interface StreamPhase {
  phase: string;
  currentFile: string | null;
}

const PATH_RE = /"path"\s*:\s*"([^"]+)"/g;

export function extractLatestPath(tail: string): string | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = PATH_RE.exec(tail)) !== null) {
    last = match[1];
  }
  return last;
}

const AMBIENT_EARLY = [
  "reading your request",
  "thinking through structure",
  "choosing an approach",
];

const AMBIENT_MID = [
  "still cooking",
  "composing components",
  "wiring up state",
  "picking colors",
  "shaping the layout",
];

const AMBIENT_LATE = [
  "polishing details",
  "almost there",
  "wrapping up",
];

function pickAmbient(elapsedMs: number): string {
  const bucket =
    elapsedMs < 4000 ? AMBIENT_EARLY : elapsedMs < 20000 ? AMBIENT_MID : AMBIENT_LATE;
  const idx = Math.floor(elapsedMs / 2800) % bucket.length;
  return bucket[idx];
}

export function derivePhase(s: StreamState): StreamPhase {
  if (s.mcpLabel) {
    return { phase: s.mcpLabel, currentFile: null };
  }

  if (s.currentFile) {
    return { phase: `writing ${s.currentFile}`, currentFile: s.currentFile };
  }

  if (s.toolStarted && s.chars === 0) {
    return { phase: "drafting the build", currentFile: null };
  }

  if (s.chars > 0 && s.chars < 600) {
    return { phase: "drafting the plan", currentFile: null };
  }

  return { phase: pickAmbient(s.elapsedMs), currentFile: null };
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export function estimateTokens(chars: number): number {
  return Math.floor(chars / 4);
}
