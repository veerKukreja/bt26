import type { WriteUp } from "./types";

// Loose shape local to this module; the canonical FeatureInventory is
// owned by P1 in lib/types.ts. We accept anything with these fields.
export type FeatureInventoryLike = {
  source?: string;
  summary?: string;
  features?: Array<{ name?: string; description?: string }>;
  [key: string]: unknown;
};

export const BRAINSTORM_SYSTEM_PROMPT = `You are the product-brainstorming engine of Prism, a self-modifying website.

A user gives you a short intent ("a dashboard for tracking house plants", "a landing page for my wedding"). You return a tight, opinionated product write-up as a single structured JSON object via the \`write_writeup\` tool.

# Output contract

Call the \`write_writeup\` tool EXACTLY ONCE. All fields are required, none may be empty. Keep it punchy and specific — this write-up is a spec that later stages of Prism will turn into code. Vague boilerplate is worse than no write-up.

Fields:
- \`title\`: a short product name or headline (2–6 words).
- \`problem\`: one or two sentences stating the concrete pain the product relieves.
- \`users\`: 1–3 distinct personas, each with \`persona\` (who, in a phrase) and \`jobToBeDone\` (the one task they hire this product for).
- \`valueProp\`: a single sentence of the form "For X who Y, we Z." — crisp, no hedging.
- \`features\`: MoSCoW split. \`mustHave\` = 3–6 items, table-stakes for the first working version. \`shouldHave\` = 2–5 items, high-value but deferrable. \`couldHave\` = 1–4 items, delight/growth. Each feature is a short noun phrase, not a sentence.
- \`pages\`: 2–5 pages/screens. Each has \`name\` (e.g. "Landing", "Plant detail"), \`purpose\` (one sentence), \`keyElements\` (2–5 short strings naming UI pieces — "hero with CTA", "stats row", "add-plant button").
- \`projectStructure\`: a realistic file/folder tree the developer will produce. \`entryPoint\` is the main file path (e.g. "/App.tsx" or "/index.tsx"). \`tree\` is an array of \`ProjectTreeNode\` objects. Each node has \`name\` (file or folder label), \`kind\` (one of "file" | "directory" | "route" | "component"), optional \`purpose\` (one short phrase saying what it does), and optional \`children\` (nested nodes). Keep the tree shallow and realistic for a small React app: typically 6–12 leaf nodes across at most 2 levels. Don't invent elaborate monorepo layouts; a flat \`/App.tsx\`, \`/components/*\`, \`/lib/*\` shape is usually right.
- \`copyDirection\`: 1–2 sentences describing voice/tone ("playful and direct, second-person, no jargon").
- \`visualDirection\`: 1–2 sentences describing look/feel ("soft neutrals, generous whitespace, hand-drawn iconography").
- \`risks\`: 2–4 short strings, each a real risk to shipping or adoption (not filler like "competition").

# Style

- Concrete over generic. "Add plant with photo and species" beats "plant management".
- Opinionated. Pick one interpretation and commit; do not list alternatives.
- No hedging words: "maybe", "could", "perhaps". State things.
- No invented technical dependencies (databases, auth providers). Stay at the product layer.
- If references are provided (feature inventories from other sites), extract the best ideas and adapt them to this intent. Do not copy verbatim. Credit is implicit.

# Section mode

If the user message says "Rewrite section: <key>" at the top, rewrite ONLY that section while keeping the rest of the WriteUp consistent with the supplied previous version. Still return the FULL WriteUp object — the server compares and applies only the named section. Valid keys: title, problem, users, valueProp, features, pages, copyDirection, visualDirection, risks.

# Hard rules

1. Call \`write_writeup\` exactly once. Never respond in plain text.
2. All fields present and non-empty. Arrays within bounds above.
3. No markdown formatting inside string fields. Plain prose only.
4. No URLs, no emoji inside strings (titles of pages are fine as plain words).
`;

export const WRITE_WRITEUP_TOOL = {
  name: "write_writeup",
  description:
    "Write the complete structured product WriteUp. All fields required. Used by Prism's brainstorm stage.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string" },
      problem: { type: "string" },
      users: {
        type: "array",
        items: {
          type: "object",
          properties: {
            persona: { type: "string" },
            jobToBeDone: { type: "string" },
          },
          required: ["persona", "jobToBeDone"],
        },
      },
      valueProp: { type: "string" },
      features: {
        type: "object",
        properties: {
          mustHave: { type: "array", items: { type: "string" } },
          shouldHave: { type: "array", items: { type: "string" } },
          couldHave: { type: "array", items: { type: "string" } },
        },
        required: ["mustHave", "shouldHave", "couldHave"],
      },
      pages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            keyElements: { type: "array", items: { type: "string" } },
          },
          required: ["name", "purpose", "keyElements"],
        },
      },
      projectStructure: {
        type: "object",
        properties: {
          entryPoint: { type: "string" },
          tree: {
            type: "array",
            items: {
              $ref: "#/$defs/treeNode",
            },
          },
        },
        required: ["entryPoint", "tree"],
      },
      copyDirection: { type: "string" },
      visualDirection: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
    },
    required: [
      "title",
      "problem",
      "users",
      "valueProp",
      "features",
      "pages",
      "projectStructure",
      "copyDirection",
      "visualDirection",
      "risks",
    ],
    $defs: {
      treeNode: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          kind: {
            type: "string",
            enum: ["file", "directory", "route", "component"],
          },
          purpose: { type: "string" },
          children: {
            type: "array",
            items: { $ref: "#/$defs/treeNode" },
          },
        },
        required: ["name", "kind"],
      },
    },
  },
};

export const WRITEUP_SECTION_KEYS = [
  "title",
  "problem",
  "users",
  "valueProp",
  "features",
  "pages",
  "projectStructure",
  "copyDirection",
  "visualDirection",
  "risks",
] as const;

export type WriteUpSectionKey = (typeof WRITEUP_SECTION_KEYS)[number];

export function isWriteUpSectionKey(x: unknown): x is WriteUpSectionKey {
  return (
    typeof x === "string" &&
    (WRITEUP_SECTION_KEYS as readonly string[]).includes(x)
  );
}

export function buildUserMessage(args: {
  intent: string;
  references?: FeatureInventoryLike[];
  mode: "full" | "section";
  sectionKey?: WriteUpSectionKey;
  previousWriteup?: WriteUp;
}): string {
  const parts: string[] = [];

  if (args.mode === "section" && args.sectionKey) {
    parts.push(`Rewrite section: ${args.sectionKey}`);
    if (args.previousWriteup) {
      parts.push(
        `Previous WriteUp (keep all other sections consistent with this):\n${JSON.stringify(
          args.previousWriteup,
          null,
          2,
        )}`,
      );
    }
  }

  parts.push(`Intent: ${args.intent}`);

  if (args.references && args.references.length > 0) {
    const refText = args.references
      .map((r, i) => {
        const source = typeof r.source === "string" ? r.source : `ref-${i + 1}`;
        const summary = typeof r.summary === "string" ? r.summary : "";
        const featureList = Array.isArray(r.features)
          ? r.features
              .map((f) => {
                const name = typeof f?.name === "string" ? f.name : "";
                const desc =
                  typeof f?.description === "string" ? f.description : "";
                return name ? `- ${name}${desc ? `: ${desc}` : ""}` : "";
              })
              .filter(Boolean)
              .join("\n")
          : "";
        return [`Reference: ${source}`, summary, featureList]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    parts.push(`References (incorporate the best ideas):\n\n${refText}`);
  }

  return parts.join("\n\n");
}
