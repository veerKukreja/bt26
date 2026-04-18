import { NextRequest } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import {
  BRAINSTORM_SYSTEM_PROMPT,
  WRITE_WRITEUP_TOOL,
  buildUserMessage,
  isWriteUpSectionKey,
  type FeatureInventoryLike,
  type WriteUpSectionKey,
} from "@/lib/brainstorm-prompt";
import type { ProjectStructure, ProjectTreeNode, WriteUp } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface BrainstormBody {
  intent: string;
  references?: FeatureInventoryLike[];
  mode: "full" | "section";
  sectionKey?: string;
  previousWriteup?: WriteUp;
}

export async function POST(req: NextRequest) {
  let body: BrainstormBody;
  try {
    body = (await req.json()) as BrainstormBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body.intent !== "string" || !body.intent.trim()) {
    return new Response(JSON.stringify({ error: "intent is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (body.mode !== "full" && body.mode !== "section") {
    return new Response(
      JSON.stringify({ error: "mode must be 'full' or 'section'" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let sectionKey: WriteUpSectionKey | undefined;
  if (body.mode === "section") {
    if (!isWriteUpSectionKey(body.sectionKey)) {
      return new Response(
        JSON.stringify({
          error: "sectionKey is required in section mode and must be a valid WriteUp key",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    sectionKey = body.sectionKey;
  }

  const userMessage = buildUserMessage({
    intent: body.intent,
    references: body.references,
    mode: body.mode,
    sectionKey,
    previousWriteup: body.previousWriteup,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const response = await getAnthropic().messages.create({
          model: MODEL,
          max_tokens: 4000,
          tools: [WRITE_WRITEUP_TOOL],
          tool_choice: { type: "tool", name: "write_writeup" },
          system: [
            {
              type: "text",
              text: BRAINSTORM_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: userMessage }],
            },
          ],
          stream: true,
        });

        let accumulatedJson = "";

        for await (const event of response) {
          if (event.type === "content_block_delta") {
            const d = event.delta;
            if (d.type === "input_json_delta") {
              accumulatedJson += d.partial_json;
              send("progress", {
                chars: accumulatedJson.length,
                tail: accumulatedJson.slice(-120),
              });
            }
          }
        }

        let parsed: Partial<WriteUp>;
        try {
          parsed = JSON.parse(accumulatedJson) as Partial<WriteUp>;
        } catch (e) {
          throw new Error(
            `Model returned malformed JSON: ${(e as Error).message}. Raw tail: ${accumulatedJson.slice(-200)}`,
          );
        }

        const validated = validateWriteUp(parsed);

        let finalWriteup: WriteUp = validated;
        if (body.mode === "section" && sectionKey && body.previousWriteup) {
          finalWriteup = applySection(body.previousWriteup, validated, sectionKey);
        }

        send("done", { writeup: finalWriteup, sectionKey: sectionKey ?? null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function validateWriteUp(p: Partial<WriteUp>): WriteUp {
  if (!p || typeof p !== "object") throw new Error("WriteUp is not an object");

  const mustStr = (v: unknown, name: string): string => {
    if (typeof v !== "string" || !v.trim())
      throw new Error(`WriteUp.${name} must be a non-empty string`);
    return v;
  };
  const mustArr = <T,>(v: unknown, name: string): T[] => {
    if (!Array.isArray(v)) throw new Error(`WriteUp.${name} must be an array`);
    return v as T[];
  };

  const title = mustStr(p.title, "title");
  const problem = mustStr(p.problem, "problem");
  const valueProp = mustStr(p.valueProp, "valueProp");
  const copyDirection = mustStr(p.copyDirection, "copyDirection");
  const visualDirection = mustStr(p.visualDirection, "visualDirection");

  const rawUsers = mustArr<unknown>(p.users, "users");
  const users = rawUsers.map((u, i) => {
    if (typeof u !== "object" || u === null)
      throw new Error(`WriteUp.users[${i}] is not an object`);
    const uu = u as { persona?: unknown; jobToBeDone?: unknown };
    return {
      persona: mustStr(uu.persona, `users[${i}].persona`),
      jobToBeDone: mustStr(uu.jobToBeDone, `users[${i}].jobToBeDone`),
    };
  });

  if (typeof p.features !== "object" || p.features === null)
    throw new Error("WriteUp.features must be an object");
  const f = p.features as {
    mustHave?: unknown;
    shouldHave?: unknown;
    couldHave?: unknown;
  };
  const mustHave = mustArr<unknown>(f.mustHave, "features.mustHave").map(
    (s, i) => mustStr(s, `features.mustHave[${i}]`),
  );
  const shouldHave = mustArr<unknown>(f.shouldHave, "features.shouldHave").map(
    (s, i) => mustStr(s, `features.shouldHave[${i}]`),
  );
  const couldHave = mustArr<unknown>(f.couldHave, "features.couldHave").map(
    (s, i) => mustStr(s, `features.couldHave[${i}]`),
  );

  const rawPages = mustArr<unknown>(p.pages, "pages");
  const pages = rawPages.map((pg, i) => {
    if (typeof pg !== "object" || pg === null)
      throw new Error(`WriteUp.pages[${i}] is not an object`);
    const pp = pg as {
      name?: unknown;
      purpose?: unknown;
      keyElements?: unknown;
    };
    return {
      name: mustStr(pp.name, `pages[${i}].name`),
      purpose: mustStr(pp.purpose, `pages[${i}].purpose`),
      keyElements: mustArr<unknown>(
        pp.keyElements,
        `pages[${i}].keyElements`,
      ).map((s, j) => mustStr(s, `pages[${i}].keyElements[${j}]`)),
    };
  });

  const risks = mustArr<unknown>(p.risks, "risks").map((s, i) =>
    mustStr(s, `risks[${i}]`),
  );

  const projectStructure = coerceProjectStructure(p.projectStructure);

  return {
    title,
    problem,
    users,
    valueProp,
    features: { mustHave, shouldHave, couldHave },
    pages,
    ...(projectStructure ? { projectStructure } : {}),
    copyDirection,
    visualDirection,
    risks,
  };
}

function coerceTreeNode(raw: unknown, depth = 0): ProjectTreeNode | null {
  if (!raw || typeof raw !== "object" || depth > 3) return null;
  const r = raw as {
    name?: unknown;
    kind?: unknown;
    purpose?: unknown;
    children?: unknown;
  };
  if (typeof r.name !== "string" || !r.name.trim()) return null;
  const kind: ProjectTreeNode["kind"] =
    r.kind === "directory" || r.kind === "route" || r.kind === "component"
      ? r.kind
      : "file";
  const node: ProjectTreeNode = { name: r.name, kind };
  if (typeof r.purpose === "string" && r.purpose.trim()) node.purpose = r.purpose;
  if (Array.isArray(r.children)) {
    const children = r.children
      .map((c) => coerceTreeNode(c, depth + 1))
      .filter((c): c is ProjectTreeNode => c !== null);
    if (children.length > 0) node.children = children;
  }
  return node;
}

function coerceProjectStructure(raw: unknown): ProjectStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { entryPoint?: unknown; tree?: unknown };
  const entryPoint =
    typeof r.entryPoint === "string" && r.entryPoint.trim()
      ? r.entryPoint
      : "/App.tsx";
  if (!Array.isArray(r.tree)) return null;
  const tree = r.tree
    .map((n) => coerceTreeNode(n))
    .filter((n): n is ProjectTreeNode => n !== null);
  if (tree.length === 0) return null;
  return { entryPoint, tree };
}

function applySection(
  prev: WriteUp,
  next: WriteUp,
  key: WriteUpSectionKey,
): WriteUp {
  // Preserve prev, replace only the named section.
  return { ...prev, [key]: next[key] } as WriteUp;
}
