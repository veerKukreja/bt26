import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";
import type { WriteUp } from "../../../lib/types";

function mockReq(body: unknown): Request {
  return new Request("http://localhost/api/brainstorm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function collectSse(
  res: Response,
): Promise<Array<{ event: string; data: unknown }>> {
  assert.ok(res.body, "response must have a body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ event: string; data: unknown }> = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
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
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        /* skip */
      }
    }
  }
  return events;
}

const HAS_REAL_KEY = !!(
  process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 10
);

test("POST returns 400 when intent missing", async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-key";
  const res = await POST(mockReq({ mode: "full" }) as never);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /intent/);
});

test("POST returns 400 when mode invalid", async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-key";
  const res = await POST(mockReq({ intent: "hi", mode: "weird" }) as never);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /mode/);
});

test("POST returns 400 when section mode has invalid sectionKey", async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-key";
  const res = await POST(
    mockReq({
      intent: "a tracker",
      mode: "section",
      sectionKey: "notARealKey",
    }) as never,
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /sectionKey/);
});

test("POST returns 400 when section mode omits sectionKey", async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-key";
  const res = await POST(
    mockReq({ intent: "a tracker", mode: "section" }) as never,
  );
  assert.equal(res.status, 400);
});

test("POST returns 500 when API key missing", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = await POST(mockReq({ intent: "a", mode: "full" }) as never);
    assert.equal(res.status, 500);
  } finally {
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// --- End-to-end tests, gated on a real API key. ---

test("full mode streams a valid WriteUp with progress + done", { skip: !HAS_REAL_KEY }, async () => {
  const started = Date.now();
  const res = await POST(
    mockReq({
      intent: "a minimalist dashboard for tracking indoor houseplants",
      mode: "full",
    }) as never,
  );
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("Content-Type") ?? "",
    /text\/event-stream/,
  );

  const events = await collectSse(res);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 30_000, `streamed in ${elapsed}ms (should be <30s)`);

  const progress = events.filter((e) => e.event === "progress");
  const done = events.filter((e) => e.event === "done");
  const errors = events.filter((e) => e.event === "error");

  assert.equal(errors.length, 0, `got errors: ${JSON.stringify(errors)}`);
  assert.ok(
    progress.length > 0,
    "expected at least one progress event during streaming",
  );
  assert.equal(done.length, 1, "expected exactly one done event");

  const writeup = (done[0].data as { writeup: WriteUp }).writeup;
  assert.ok(typeof writeup.title === "string" && writeup.title.length > 0);
  assert.ok(typeof writeup.problem === "string");
  assert.ok(Array.isArray(writeup.users) && writeup.users.length > 0);
  assert.ok(typeof writeup.valueProp === "string");
  assert.ok(Array.isArray(writeup.features.mustHave));
  assert.ok(Array.isArray(writeup.features.shouldHave));
  assert.ok(Array.isArray(writeup.features.couldHave));
  assert.ok(Array.isArray(writeup.pages) && writeup.pages.length > 0);
  assert.ok(typeof writeup.copyDirection === "string");
  assert.ok(typeof writeup.visualDirection === "string");
  assert.ok(Array.isArray(writeup.risks) && writeup.risks.length > 0);
});

test(
  "section mode rewrites only the named section when previousWriteup given",
  { skip: !HAS_REAL_KEY },
  async () => {
    const previousWriteup: WriteUp = {
      title: "PlantPal",
      problem: "Houseplants die from forgotten watering.",
      users: [
        {
          persona: "Busy urban professional",
          jobToBeDone: "Keep a handful of plants alive with minimal effort.",
        },
      ],
      valueProp: "For plant owners who forget, we send the right reminder.",
      features: {
        mustHave: ["add plant", "watering reminder"],
        shouldHave: ["species lookup"],
        couldHave: ["community feed"],
      },
      pages: [
        {
          name: "Dashboard",
          purpose: "See today's watering tasks.",
          keyElements: ["task list", "add plant button"],
        },
      ],
      copyDirection: "Warm, second-person, low-jargon.",
      visualDirection: "Earthy neutrals with soft greens.",
      risks: ["Users ignore notifications"],
    };

    const res = await POST(
      mockReq({
        intent: previousWriteup.problem,
        mode: "section",
        sectionKey: "risks",
        previousWriteup,
      }) as never,
    );
    assert.equal(res.status, 200);
    const events = await collectSse(res);
    const done = events.find((e) => e.event === "done");
    assert.ok(done, "expected done event");
    const data = done!.data as {
      writeup: WriteUp;
      sectionKey: string | null;
    };
    assert.equal(data.sectionKey, "risks");
    // Everything except risks should be byte-identical to previousWriteup.
    assert.equal(data.writeup.title, previousWriteup.title);
    assert.equal(data.writeup.problem, previousWriteup.problem);
    assert.deepEqual(data.writeup.users, previousWriteup.users);
    assert.equal(data.writeup.valueProp, previousWriteup.valueProp);
    assert.deepEqual(data.writeup.features, previousWriteup.features);
    assert.deepEqual(data.writeup.pages, previousWriteup.pages);
    assert.equal(data.writeup.copyDirection, previousWriteup.copyDirection);
    assert.equal(data.writeup.visualDirection, previousWriteup.visualDirection);
    assert.ok(
      Array.isArray(data.writeup.risks) && data.writeup.risks.length > 0,
      "risks array should be present and non-empty",
    );
  },
);
