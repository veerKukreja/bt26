import type { WriteUp } from "./types";
import type { FeatureInventoryLike } from "./brainstorm-prompt";

export interface BrainstormCallbacks {
  onProgress?: (chars: number, tail: string) => void;
  onDone: (writeup: WriteUp, sectionKey: string | null) => void;
  onError: (message: string) => void;
}

export async function streamBrainstorm(
  args: {
    intent: string;
    references?: FeatureInventoryLike[];
    mode: "full" | "section";
    sectionKey?: string;
    previousWriteup?: WriteUp;
    signal?: AbortSignal;
  },
  cb: BrainstormCallbacks,
): Promise<void> {
  const res = await fetch("/api/brainstorm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: args.intent,
      references: args.references,
      mode: args.mode,
      sectionKey: args.sectionKey,
      previousWriteup: args.previousWriteup,
    }),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.clone().json();
      if (
        typeof body === "object" &&
        body !== null &&
        typeof (body as { error?: unknown }).error === "string"
      ) {
        message = (body as { error: string }).error;
      }
    } catch {
      /* ignore */
    }
    cb.onError(message);
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
        case "progress":
          if (typeof payload === "object" && payload !== null) {
            const p = payload as { chars?: unknown; tail?: unknown };
            const chars = typeof p.chars === "number" ? p.chars : 0;
            const tail = typeof p.tail === "string" ? p.tail : "";
            cb.onProgress?.(chars, tail);
          }
          break;
        case "done": {
          if (typeof payload === "object" && payload !== null) {
            const p = payload as { writeup?: unknown; sectionKey?: unknown };
            if (
              typeof p.writeup === "object" &&
              p.writeup !== null &&
              isWriteUp(p.writeup)
            ) {
              const sectionKey =
                typeof p.sectionKey === "string" ? p.sectionKey : null;
              cb.onDone(p.writeup, sectionKey);
              return;
            }
            cb.onError("done event missing valid writeup");
            return;
          }
          cb.onError("done event payload is not an object");
          return;
        }
        case "error": {
          if (typeof payload === "object" && payload !== null) {
            const p = payload as { message?: unknown };
            cb.onError(
              typeof p.message === "string" ? p.message : "Unknown error",
            );
          } else {
            cb.onError("Unknown error");
          }
          return;
        }
      }
    }
  }
}

function isWriteUp(v: unknown): v is WriteUp {
  if (typeof v !== "object" || v === null) return false;
  const w = v as Record<string, unknown>;
  if (typeof w.title !== "string") return false;
  if (typeof w.problem !== "string") return false;
  if (typeof w.valueProp !== "string") return false;
  if (typeof w.copyDirection !== "string") return false;
  if (typeof w.visualDirection !== "string") return false;
  if (!Array.isArray(w.users)) return false;
  if (!Array.isArray(w.pages)) return false;
  if (!Array.isArray(w.risks)) return false;
  if (typeof w.features !== "object" || w.features === null) return false;
  const f = w.features as Record<string, unknown>;
  if (!Array.isArray(f.mustHave)) return false;
  if (!Array.isArray(f.shouldHave)) return false;
  if (!Array.isArray(f.couldHave)) return false;
  return true;
}
