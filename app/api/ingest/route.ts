import { NextRequest } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import type { FeatureInventory } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_INPUT_BYTES = 2_000_000;
const MAX_PAGE_TEXT_CHARS = 40_000;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 4_000_000;
const FETCH_TIMEOUT_MS = 15_000;

type Body =
  | { kind: "url"; url: string }
  | { kind: "images"; images: string[] };

function isValidBody(v: unknown): v is Body {
  if (!v || typeof v !== "object") return false;
  const b = v as { kind?: unknown; url?: unknown; images?: unknown };
  if (b.kind === "url") {
    if (typeof b.url !== "string" || b.url.length === 0) return false;
    try {
      const u = new URL(b.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    } catch {
      return false;
    }
    return true;
  }
  if (b.kind === "images") {
    if (!Array.isArray(b.images) || b.images.length === 0) return false;
    if (b.images.length > MAX_IMAGES) return false;
    for (const img of b.images) {
      if (typeof img !== "string") return false;
      if (!img.startsWith("data:image/")) return false;
    }
    return true;
  }
  return false;
}

function stripHtmlToText(html: string): { text: string; title: string | null } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = noScript
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { text, title };
}

function extractImageUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (!src) continue;
    if (src.startsWith("data:")) continue;
    try {
      const resolved = new URL(src, baseUrl).toString();
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      urls.push(resolved);
      if (urls.length >= MAX_IMAGES) break;
    } catch {
      /* skip */
    }
  }
  return urls;
}

type Base64Image = {
  data: string;
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

function parseDataUri(uri: string): Base64Image | null {
  const match = uri.match(/^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,(.+)$/);
  if (!match) return null;
  let mediaType = match[1].toLowerCase();
  if (mediaType === "image/jpg") mediaType = "image/jpeg";
  const data = match[2];
  const approxBytes = Math.floor(data.length * 0.75);
  if (approxBytes > MAX_IMAGE_BYTES) return null;
  return {
    data,
    media_type: mediaType as Base64Image["media_type"],
  };
}

async function fetchAsBase64Image(url: string): Promise<Base64Image | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "PrismIngest/1.0" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(contentType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return {
      data: buf.toString("base64"),
      media_type: contentType as Base64Image["media_type"],
    };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You are a product analyst extracting a compact, faithful feature inventory of a website or UI.

Given the page text and any screenshots, identify:
- A one-sentence summary of what the site does.
- Its distinct features, each tagged by priority: "table-stakes" (expected baseline), "differentiator" (what makes this one interesting), or "nice-to-have" (delightful extras).
- The main user flows as ordered step lists.
- The design language: dominant palette (as hex codes where confident, or named colors), typography style, and overall vibe in 3-8 words.
- A handful of representative copy snippets (headings, CTAs, microcopy) from the source.

Be concrete and concise. Prefer evidence from the source over speculation. If a category is unknowable from the input, return an empty array or a brief "unknown" string — do not invent.

You MUST call the emit_inventory tool exactly once with the complete inventory. Do not write any prose outside the tool call.`;

const EMIT_INVENTORY_TOOL = {
  name: "emit_inventory",
  description: "Emit the structured feature inventory for the analyzed source.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string" },
      features: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            priority: {
              type: "string",
              enum: ["table-stakes", "differentiator", "nice-to-have"],
            },
          },
          required: ["name", "description", "priority"],
        },
      },
      userFlows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            steps: { type: "array", items: { type: "string" } },
          },
          required: ["name", "steps"],
        },
      },
      designLanguage: {
        type: "object",
        properties: {
          palette: { type: "array", items: { type: "string" } },
          typography: { type: "string" },
          vibe: { type: "string" },
        },
        required: ["palette", "typography", "vibe"],
      },
      copyExamples: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "features", "userFlows", "designLanguage", "copyExamples"],
  },
};

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: Base64Image["media_type"]; data: string };
    };

function coerceInventory(raw: unknown): FeatureInventory {
  const r = (raw ?? {}) as Partial<FeatureInventory>;
  const features: FeatureInventory["features"] = Array.isArray(r.features)
    ? r.features.map((f) => {
        const priority: FeatureInventory["features"][number]["priority"] =
          f?.priority === "differentiator" || f?.priority === "nice-to-have"
            ? f.priority
            : "table-stakes";
        return {
          name: String(f?.name ?? ""),
          description: String(f?.description ?? ""),
          priority,
        };
      })
    : [];
  const userFlows = Array.isArray(r.userFlows)
    ? r.userFlows.map((f) => ({
        name: String(f?.name ?? ""),
        steps: Array.isArray(f?.steps) ? f.steps.map((s) => String(s)) : [],
      }))
    : [];
  const dl = r.designLanguage ?? { palette: [], typography: "", vibe: "" };
  const designLanguage = {
    palette: Array.isArray(dl.palette) ? dl.palette.map((p) => String(p)) : [],
    typography: String(dl.typography ?? ""),
    vibe: String(dl.vibe ?? ""),
  };
  const copyExamples = Array.isArray(r.copyExamples) ? r.copyExamples.map((s) => String(s)) : [];
  return {
    summary: String(r.summary ?? ""),
    features,
    userFlows,
    designLanguage,
    copyExamples,
  };
}

async function buildUrlContent(url: string): Promise<ContentBlock[] | { error: string }> {
  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "PrismIngest/1.0 (+hackathon)" },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { error: `Upstream fetch failed: ${res.status} ${res.statusText}` };
    }
    html = await res.text();
  } catch (e) {
    return { error: `Upstream fetch failed: ${(e as Error).message}` };
  }

  const { text, title } = stripHtmlToText(html);
  const truncated = text.slice(0, MAX_PAGE_TEXT_CHARS);
  const header = `Source URL: ${url}\nPage title: ${title ?? "(none)"}\n\nPage text (truncated to ${MAX_PAGE_TEXT_CHARS} chars):\n${truncated}`;

  const blocks: ContentBlock[] = [{ type: "text", text: header }];

  const imageUrls = extractImageUrls(html, url);
  if (imageUrls.length > 0) {
    const fetched = await Promise.all(imageUrls.slice(0, MAX_IMAGES).map(fetchAsBase64Image));
    const attached: Base64Image[] = fetched.filter((x): x is Base64Image => x !== null);
    if (attached.length > 0) {
      blocks.push({
        type: "text",
        text: `Inline images extracted from the page (${attached.length}):`,
      });
      for (const img of attached) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        });
      }
    }
  }
  return blocks;
}

function buildImageContent(images: string[]): ContentBlock[] | { error: string } {
  const parsed: Base64Image[] = [];
  for (const uri of images.slice(0, MAX_IMAGES)) {
    const p = parseDataUri(uri);
    if (!p) return { error: "One or more images could not be parsed or exceed size limits" };
    parsed.push(p);
  }
  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: `Analyze the following ${parsed.length} screenshot(s) of a website or UI. Extract a complete feature inventory.`,
    },
  ];
  for (const img of parsed) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: img.media_type, data: img.data },
    });
  }
  return blocks;
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_INPUT_BYTES) {
    return new Response(JSON.stringify({ error: "Input too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!isValidBody(raw)) {
    return new Response(
      JSON.stringify({
        error:
          "Malformed request. Expected { kind: 'url', url: string } or { kind: 'images', images: string[] } (images as data URIs).",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let content: ContentBlock[];
  if (raw.kind === "url") {
    const built = await buildUrlContent(raw.url);
    if ("error" in built) {
      return new Response(JSON.stringify({ error: built.error }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    content = built;
  } else {
    const built = buildImageContent(raw.images);
    if ("error" in built) {
      return new Response(JSON.stringify({ error: built.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    content = built;
  }

  let inventory: FeatureInventory;
  try {
    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [EMIT_INVENTORY_TOOL],
      tool_choice: { type: "tool", name: "emit_inventory" },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: content as never,
        },
      ],
    });

    const toolBlock = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    if (!toolBlock) {
      throw new Error("Model did not return a tool_use block");
    }
    inventory = coerceInventory(toolBlock.input);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: `Claude call failed: ${message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(inventory), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
