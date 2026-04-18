import type { NextRequest } from "next/server";
import { loadSession } from "@/lib/snapshots";
import { supabaseConfigured } from "@/lib/supabase";
import type { Snapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prism OG card renderer.
//
// Size: 1200x630 (standard OG).
// Output: image/svg+xml. We deliberately serve SVG rather than PNG because:
//   - @vercel/og is not installed and the plan forbids adding heavyweight deps.
//   - sharp / resvg-js are also not direct deps of this app.
// Twitter / X prefers PNG but accepts SVG; LinkedIn / Slack / Discord accept both.
// See PR notes for the documented tradeoff.

const WIDTH = 1200;
const HEIGHT = 630;

// HTML-escape a string so it's safe to embed inside SVG text nodes
// (same escape set used by app/api/export style templates).
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Very simple greedy character-count wrapper. Not font-metric aware —
// good enough for an OG card at a fixed width.
function wrap(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (lines.length >= maxLines) break;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // Word itself too long — hard-break it.
      if (word.length > maxCharsPerLine) {
        let rest = word;
        while (rest.length > maxCharsPerLine && lines.length < maxLines - 1) {
          lines.push(rest.slice(0, maxCharsPerLine));
          rest = rest.slice(maxCharsPerLine);
        }
        current = rest;
      } else {
        current = word;
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Ellipsis if we truncated.
  if (lines.length === maxLines) {
    const lastIdx = maxLines - 1;
    const joined = lines.slice(0, maxLines).join(" ");
    if (joined.length < text.length) {
      lines[lastIdx] = (lines[lastIdx] ?? "").replace(/.{0,3}$/, "…");
    }
  }
  return lines;
}

function tspans(lines: string[], x: number, startY: number, lineHeight: number): string {
  return lines
    .map(
      (ln, i) =>
        `<tspan x="${x}" y="${startY + i * lineHeight}">${escapeXml(ln)}</tspan>`,
    )
    .join("");
}

interface CardData {
  idShort: string;
  firstPrompt: string | null;
  latestPrompt: string | null;
  snapshotCount: number;
}

function renderSvg(data: CardData): string {
  const { idShort, firstPrompt, latestPrompt, snapshotCount } = data;

  const titleText = `Prism — ${idShort}`;
  const subtitle =
    snapshotCount > 0
      ? `${snapshotCount} snapshot${snapshotCount === 1 ? "" : "s"}`
      : "A website that becomes what you tell it to";

  // Content blocks — omit cleanly if empty.
  const firstLines = firstPrompt
    ? wrap(firstPrompt, 58, 3)
    : [];
  const latestLines =
    latestPrompt && latestPrompt !== firstPrompt
      ? wrap(latestPrompt, 58, 3)
      : [];

  const firstBlock = firstLines.length
    ? `
    <text x="80" y="310" fill="#9ca3af" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="22" font-weight="500" letter-spacing="2">
      FIRST PROMPT
    </text>
    <text fill="#f3f4f6" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="34" font-weight="500">
      ${tspans(firstLines, 80, 355, 46)}
    </text>`
    : "";

  const latestBlockY = firstLines.length ? 355 + firstLines.length * 46 + 40 : 310;
  const latestBlock = latestLines.length
    ? `
    <text x="80" y="${latestBlockY}" fill="#9ca3af" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="22" font-weight="500" letter-spacing="2">
      LATEST PROMPT
    </text>
    <text fill="#f3f4f6" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="34" font-weight="500">
      ${tspans(latestLines, 80, latestBlockY + 45, 46)}
    </text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#1a1a2e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a855f7"/>
      <stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="url(#accent)"/>

  <g transform="translate(80, 110)">
    <rect x="0" y="0" width="56" height="56" rx="12" fill="url(#accent)"/>
    <text x="76" y="42" fill="#f3f4f6" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="44" font-weight="700">
      ${escapeXml(titleText)}
    </text>
  </g>

  <text x="80" y="240" fill="#9ca3af" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="26" font-weight="400">
    ${escapeXml(subtitle)}
  </text>

  ${firstBlock}
  ${latestBlock}

  <text x="80" y="${HEIGHT - 60}" fill="#6b7280" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="22">
    prism
  </text>
  <text x="${WIDTH - 80}" y="${HEIGHT - 60}" text-anchor="end" fill="#6b7280" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="22">
    a website that becomes what you tell it to
  </text>
</svg>`;
}

function pickPrompt(snaps: Snapshot[], which: "first" | "latest"): string | null {
  // Skip the synthetic "origin" snapshot with empty prompt, and any empty prompts.
  const withPrompts = snaps.filter((s) => s.prompt && s.prompt.trim().length > 0);
  if (withPrompts.length === 0) return null;
  const pick =
    which === "first" ? withPrompts[0] : withPrompts[withPrompts.length - 1];
  return pick.prompt.trim();
}

async function buildCard(sessionId: string): Promise<CardData> {
  const safeId = typeof sessionId === "string" ? sessionId : "";
  const idShort = safeId.slice(0, 8) || "unknown";

  const fallback: CardData = {
    idShort,
    firstPrompt: null,
    latestPrompt: null,
    snapshotCount: 0,
  };

  if (!supabaseConfigured() || !safeId) return fallback;

  try {
    const loaded = await loadSession(safeId);
    if (!loaded) return fallback;
    return {
      idShort,
      firstPrompt: pickPrompt(loaded.snapshots, "first"),
      latestPrompt: pickPrompt(loaded.snapshots, "latest"),
      snapshotCount: loaded.snapshots.length,
    };
  } catch {
    return fallback;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  let sessionId = "";
  try {
    const p = await params;
    sessionId = p?.sessionId ?? "";
  } catch {
    sessionId = "";
  }

  let svg: string;
  try {
    const card = await buildCard(sessionId);
    svg = renderSvg(card);
  } catch {
    // Last-ditch fallback — never 500.
    svg = renderSvg({
      idShort: (sessionId || "unknown").slice(0, 8),
      firstPrompt: null,
      latestPrompt: null,
      snapshotCount: 0,
    });
  }

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
