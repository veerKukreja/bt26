import type { FileMap } from "./types";

export interface GenerateCallbacks {
  onToolStart?: () => void;
  onProgress?: (chars: number, tail: string) => void;
  onText?: (text: string) => void;
  onDone: (files: FileMap, summary: string) => void;
  onError: (message: string) => void;
}

export async function streamGenerate(
  args: {
    prompt: string;
    currentFiles: FileMap;
    errorContext?: string;
    signal?: AbortSignal;
  },
  cb: GenerateCallbacks,
): Promise<void> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: args.prompt,
      currentFiles: args.currentFiles,
      errorContext: args.errorContext,
    }),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    cb.onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events separated by \n\n
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      switch (event) {
        case "tool_start":
          cb.onToolStart?.();
          break;
        case "progress":
          if (typeof payload === "object" && payload !== null) {
            const p = payload as { chars?: number; tail?: string };
            cb.onProgress?.(p.chars ?? 0, p.tail ?? "");
          }
          break;
        case "text":
          if (typeof payload === "object" && payload !== null) {
            cb.onText?.((payload as { text?: string }).text ?? "");
          }
          break;
        case "done": {
          const p = payload as { files: FileMap; summary: string };
          cb.onDone(p.files, p.summary);
          return;
        }
        case "error": {
          const p = payload as { message: string };
          cb.onError(p.message);
          return;
        }
      }
    }
  }
}
