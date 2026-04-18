import { NextRequest } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import type { FeatureInventory } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_INPUT_BYTES = 2_000_000;

interface Body {
  references: FeatureInventory[];
}

interface CompareResult {
  intersection: string[];
  union: string[];
  gap: string[];
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidBody(v: unknown): v is Body {
  if (!v || typeof v !== "object") return false;
  const b = v as { references?: unknown };
  return Array.isArray(b.references) && b.references.length >= 2;
}

const SYSTEM = `You compare multiple feature inventories.

Given an array of FeatureInventory objects, extract three lists:
- "intersection": features present in MOST inventories (common table-stakes, the stuff every competitor has).
- "union": every distinct feature mentioned across all inventories (the full competitive surface).
- "gap": features a NEW product could differentiate on — things mentioned in few inventories, or natural extensions the existing set is missing.

Return STRICT JSON matching:
{
  "intersection": string[],
  "union": string[],
  "gap": string[]
}

No prose. No markdown fences. JSON only.`;

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_INPUT_BYTES) return json(413, { error: "Input too large" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Malformed JSON body." });
  }
  if (!isValidBody(body)) return json(400, { error: "Need at least 2 references." });

  const { references } = body;
  const userMsg = `Compare these ${references.length} inventories:\n\n${references
    .map((r, i) => `=== Inventory ${i + 1}: ${r.summary} ===\nFeatures:\n${r.features.map((f) => `- ${f.name}: ${f.description}`).join("\n")}`)
    .join("\n\n")}\n\nRespond with JSON only.`;

  try {
    const client = getAnthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
    });
    const text = res.content
      .filter((c) => c.type === "text")
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n")
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json(502, { error: "Model output missing JSON." });

    let parsed: CompareResult;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return json(502, { error: "Model output unparseable." });
    }
    if (
      !Array.isArray(parsed.intersection) ||
      !Array.isArray(parsed.union) ||
      !Array.isArray(parsed.gap)
    ) {
      return json(502, { error: "Model output missing fields." });
    }

    return json(200, {
      intersection: parsed.intersection.filter((s): s is string => typeof s === "string"),
      union: parsed.union.filter((s): s is string => typeof s === "string"),
      gap: parsed.gap.filter((s): s is string => typeof s === "string"),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("/api/ingest/compare failed:", raw);
    return json(500, { error: "Compare failed." });
  }
}
