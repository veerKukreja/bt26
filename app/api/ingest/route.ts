import { NextRequest } from "next/server";
import * as cheerio from "cheerio";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { gatherContext } from "@/lib/prism-core";
import { getAllClients } from "@/lib/mcp-clients";
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

interface PageScrape {
  title: string | null;
  description: string | null;
  ogImage: string | null;
  ogDescription: string | null;
  headings: string[];
  bodyText: string;
  palette: string[];
  imageUrls: string[];
  linkCount: number;
}

function scrapeHtml(html: string, baseUrl: string): PageScrape {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || $("meta[property='og:title']").attr("content") || null;
  const description =
    $("meta[name='description']").attr("content") ||
    $("meta[property='og:description']").attr("content") ||
    null;
  const ogDescription = $("meta[property='og:description']").attr("content") ?? null;

  let ogImage: string | null = null;
  const ogImageSrc =
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    null;
  if (ogImageSrc) {
    try {
      ogImage = new URL(ogImageSrc, baseUrl).toString();
    } catch {
      /* skip */
    }
  }

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (text && text.length < 200 && headings.length < 30) headings.push(text);
  });

  $("script, style, noscript, svg").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  const palette = extractPalette(html);

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  if (ogImage) {
    imageUrls.push(ogImage);
    seen.add(ogImage);
  }
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    try {
      const resolved = new URL(src, baseUrl).toString();
      if (seen.has(resolved)) return;
      seen.add(resolved);
      imageUrls.push(resolved);
    } catch {
      /* skip */
    }
  });

  const linkCount = $("a[href]").length;

  return {
    title,
    description,
    ogImage,
    ogDescription,
    headings,
    bodyText,
    palette,
    imageUrls: imageUrls.slice(0, MAX_IMAGES),
    linkCount,
  };
}

type EnrichedHost = "figma" | "github" | null;

function classifyHost(url: string): EnrichedHost {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === "figma.com" || h.endsWith(".figma.com")) return "figma";
    if (h === "github.com" || h.endsWith(".github.com")) return "github";
    return null;
  } catch {
    return null;
  }
}

function pickMcpServer(
  kind: "figma" | "github",
  available: Record<string, unknown>,
): string | null {
  const keys = Object.keys(available);
  const lowered = keys.map((k) => ({ name: k, lower: k.toLowerCase() }));
  const match = lowered.find((k) => k.lower.includes(kind));
  return match?.name ?? null;
}

async function enrichViaMcp(
  url: string,
  kind: "figma" | "github",
): Promise<string | null> {
  let clients: Awaited<ReturnType<typeof getAllClients>>;
  try {
    clients = await getAllClients();
  } catch {
    return null;
  }
  const serverName = pickMcpServer(kind, clients);
  if (!serverName) return null;
  const client = clients[serverName];
  try {
    const prompt =
      kind === "figma"
        ? `Fetch the Figma file at ${url}. Return its title, node hierarchy, visible text, colors, typography, and any design tokens you can extract. Be thorough — a downstream analyst needs to catalog features and design language.`
        : `Fetch the GitHub repository at ${url}. Return the README, package.json contents, top-level folder structure, and the repository description. Be thorough — a downstream analyst needs to catalog features.`;
    const result = await gatherContext({
      client: getAnthropic(),
      model: MODEL,
      userPrompt: prompt,
      mcpClients: { [serverName]: client },
      maxToolCalls: 4,
      timeoutMs: 20_000,
    });
    if (result.summary && result.toolCallCount > 0 && !result.timedOut) {
      return result.summary;
    }
    return null;
  } catch {
    return null;
  }
}

function extractPalette(html: string): string[] {
  const hexSeen = new Set<string>();
  const palette: string[] = [];
  const hexRe = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(html)) !== null) {
    const hex = `#${m[1].toLowerCase()}`;
    if (hexSeen.has(hex)) continue;
    hexSeen.add(hex);
    palette.push(hex);
    if (palette.length >= 12) break;
  }
  return palette;
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

async function buildUrlContent(
  url: string,
): Promise<{ blocks: ContentBlock[]; scrape: PageScrape } | { error: string }> {
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

  const scrape = scrapeHtml(html, url);
  const truncatedBody = scrape.bodyText.slice(0, MAX_PAGE_TEXT_CHARS);

  const headerLines: string[] = [
    `Source URL: ${url}`,
    `Page title: ${scrape.title ?? "(none)"}`,
  ];
  if (scrape.description) headerLines.push(`Meta description: ${scrape.description}`);
  if (scrape.headings.length > 0) {
    headerLines.push(`Headings:\n- ${scrape.headings.slice(0, 20).join("\n- ")}`);
  }
  if (scrape.palette.length > 0) {
    headerLines.push(`Hex colors found in source: ${scrape.palette.join(", ")}`);
  }
  headerLines.push(`Link count: ${scrape.linkCount}`);
  headerLines.push(
    `\nPage body text (truncated to ${MAX_PAGE_TEXT_CHARS} chars):\n${truncatedBody}`,
  );

  if (truncatedBody.length < 200) {
    headerLines.push(
      "\nNOTE: Body text is very short. This may be a JavaScript-rendered SPA that ships little server-side HTML. Analysis will rely primarily on meta tags and any og:image.",
    );
  }

  const blocks: ContentBlock[] = [{ type: "text", text: headerLines.join("\n") }];

  if (scrape.imageUrls.length > 0) {
    const fetched = await Promise.all(
      scrape.imageUrls.slice(0, MAX_IMAGES).map(fetchAsBase64Image),
    );
    const attached: Base64Image[] = fetched.filter((x): x is Base64Image => x !== null);
    if (attached.length > 0) {
      blocks.push({
        type: "text",
        text: `Images from the page (${attached.length}) — the first is the og:image if one was declared:`,
      });
      for (const img of attached) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        });
      }
    }
  }
  return { blocks, scrape };
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
  let urlScrape: PageScrape | null = null;
  let enrichedKind: EnrichedHost = null;
  if (raw.kind === "url") {
    const host = classifyHost(raw.url);
    if (host) {
      const enriched = await enrichViaMcp(raw.url, host);
      if (enriched) {
        enrichedKind = host;
        const header =
          host === "figma"
            ? `Source URL: ${raw.url}\n\nThis is a Figma file. The following data was fetched directly from Figma via MCP and is authoritative over any guesses:\n\n${enriched}`
            : `Source URL: ${raw.url}\n\nThis is a GitHub repository. The following data was fetched directly from GitHub via MCP and is authoritative over any guesses:\n\n${enriched}`;
        content = [{ type: "text", text: header }];
      } else {
        const built = await buildUrlContent(raw.url);
        if ("error" in built) {
          return new Response(JSON.stringify({ error: built.error }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }
        content = built.blocks;
        urlScrape = built.scrape;
        content.unshift({
          type: "text",
          text: `(Tip: this looks like a ${host === "figma" ? "Figma" : "GitHub"} URL. Configure a ${host === "figma" ? "Figma" : "GitHub"} MCP server in mcp.config.json to get richer data than a generic web scrape. See mcp/README.md.)`,
        });
      }
    } else {
      const built = await buildUrlContent(raw.url);
      if ("error" in built) {
        return new Response(JSON.stringify({ error: built.error }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      content = built.blocks;
      urlScrape = built.scrape;
    }
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

  if (raw.kind === "url") {
    inventory.source = {
      kind: enrichedKind ?? "url",
      refUrl: raw.url,
      title: urlScrape?.title ?? undefined,
      description: urlScrape?.description ?? undefined,
      ogImage: urlScrape?.ogImage ?? undefined,
    };
    if (urlScrape && inventory.designLanguage.palette.length === 0 && urlScrape.palette.length > 0) {
      inventory.designLanguage.palette = urlScrape.palette.slice(0, 6);
    }
  } else {
    inventory.source = { kind: "images" };
  }

  return new Response(JSON.stringify(inventory), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
