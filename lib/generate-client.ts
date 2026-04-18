import type { FileMap, SessionUsage } from "./types";

export interface GenerateCallbacks {
  onToolStart?: () => void;
  onProgress?: (chars: number, tail: string) => void;
  onText?: (text: string) => void;
  onUsage?: (usage: SessionUsage) => void;
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
      if (typeof payload !== "object" || payload === null) continue;
      const p = payload as Record<string, unknown>;
      switch (event) {
        case "tool_start":
          cb.onToolStart?.();
          break;
        case "progress":
          cb.onProgress?.(
            typeof p.chars === "number" ? p.chars : 0,
            typeof p.tail === "string" ? p.tail : "",
          );
          break;
        case "text":
          cb.onText?.(typeof p.text === "string" ? p.text : "");
          break;
        case "usage":
          cb.onUsage?.({
            inputTokens: typeof p.inputTokens === "number" ? p.inputTokens : 0,
            outputTokens: typeof p.outputTokens === "number" ? p.outputTokens : 0,
            cacheReadTokens: typeof p.cacheReadTokens === "number" ? p.cacheReadTokens : 0,
            cacheCreationTokens: typeof p.cacheCreationTokens === "number" ? p.cacheCreationTokens : 0,
          });
          break;
        case "done": {
          const files = (p.files && typeof p.files === "object" ? p.files : {}) as FileMap;
          const summary = typeof p.summary === "string" ? p.summary : "";
          cb.onDone(files, summary);
          return;
        }
        case "error": {
          const message = typeof p.message === "string" ? p.message : "Unknown error";
          cb.onError(message);
          return;
        }
      }
    }
  }
}
