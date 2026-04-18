import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendSnapshot,
  createSession,
  isEphemeral,
  loadSession,
  loadSnapshot,
  setEphemeral,
  __setSupabaseForTests,
} from "./snapshots";

// ---------------------------------------------------------------------------
// Tiny in-file supabase stub. Records every method call so tests can assert
// that the ephemeral path makes NO calls.
// ---------------------------------------------------------------------------
type Call = { method: string; args: unknown[] };

function makeStub(
  responders: Record<
    string,
    { data: unknown; error: unknown } | ((args: unknown[]) => { data: unknown; error: unknown })
  >,
) {
  const calls: Call[] = [];

  // Build a query-builder-ish chain. Each call pushes into `calls`; terminal
  // ops (`.single()` or awaiting the chain) resolve with the canned response
  // keyed by the top-level table name from `.from(<table>)`.
  function chain(table: string): any {
    const self: any = {
      insert(...a: unknown[]) {
        calls.push({ method: `from(${table}).insert`, args: a });
        return self;
      },
      select(...a: unknown[]) {
        calls.push({ method: `from(${table}).select`, args: a });
        return self;
      },
      eq(...a: unknown[]) {
        calls.push({ method: `from(${table}).eq`, args: a });
        return self;
      },
      order(...a: unknown[]) {
        calls.push({ method: `from(${table}).order`, args: a });
        return Promise.resolve(
          typeof responders[table] === "function"
            ? (responders[table] as (args: unknown[]) => { data: unknown; error: unknown })(a)
            : responders[table] ?? { data: null, error: null },
        );
      },
      single() {
        calls.push({ method: `from(${table}).single`, args: [] });
        return Promise.resolve(
          typeof responders[table] === "function"
            ? (responders[table] as (args: unknown[]) => { data: unknown; error: unknown })([])
            : responders[table] ?? { data: null, error: null },
        );
      },
    };
    return self;
  }

  const client = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      return chain(table);
    },
  };

  return { client, calls };
}

// ---------------------------------------------------------------------------
// Ephemeral write path: createSession + appendSnapshot must NOT touch supabase.
// ---------------------------------------------------------------------------
test("ephemeral=true: createSession returns null and does not touch supabase", async () => {
  const { client, calls } = makeStub({});
  __setSupabaseForTests(client as any);
  setEphemeral(true);

  try {
    assert.equal(isEphemeral(), true);
    const result = await createSession(null);
    assert.equal(result, null, "createSession should return null in ephemeral mode");
    assert.equal(calls.length, 0, "no supabase calls should have been made");
  } finally {
    setEphemeral(false);
    __setSupabaseForTests(null);
  }
});

test("ephemeral=true: appendSnapshot returns null and does not touch supabase", async () => {
  const { client, calls } = makeStub({});
  __setSupabaseForTests(client as any);
  setEphemeral(true);

  try {
    const result = await appendSnapshot({
      sessionId: "s1",
      parentId: null,
      prompt: "p",
      summary: "sum",
      files: { "index.html": "<!DOCTYPE html>" },
    });
    assert.equal(result, null, "appendSnapshot should return null in ephemeral mode");
    assert.equal(calls.length, 0, "no supabase calls should have been made");
  } finally {
    setEphemeral(false);
    __setSupabaseForTests(null);
  }
});

// ---------------------------------------------------------------------------
// Non-ephemeral write path: uses the injected client and returns a snapshot.
// ---------------------------------------------------------------------------
test("ephemeral=false: createSession hits supabase and returns a Session", async () => {
  const { client, calls } = makeStub({
    sessions: {
      data: {
        id: "sess-1",
        created_at: "2026-04-18T00:00:00Z",
        parent_snapshot_id: null,
      },
      error: null,
    },
  });
  __setSupabaseForTests(client as any);
  setEphemeral(false);

  try {
    const result = await createSession(null);
    assert.ok(result, "expected a Session back");
    assert.equal(result?.id, "sess-1");
    assert.equal(result?.parentSnapshotId, null);
    // Confirm the expected Supabase method chain was exercised.
    const methods = calls.map((c) => c.method);
    assert.deepEqual(
      methods,
      [
        "from",
        "from(sessions).insert",
        "from(sessions).select",
        "from(sessions).single",
      ],
      "expected the insert/select/single chain",
    );
  } finally {
    __setSupabaseForTests(null);
  }
});

test("ephemeral=false: appendSnapshot hits supabase and returns a Snapshot", async () => {
  const { client, calls } = makeStub({
    snapshots: {
      data: {
        id: "snap-1",
        session_id: "sess-1",
        parent_id: null,
        created_at: "2026-04-18T00:00:00Z",
        prompt: "hello",
        summary: "first",
        files: { "index.html": "<!DOCTYPE html>" },
      },
      error: null,
    },
  });
  __setSupabaseForTests(client as any);
  setEphemeral(false);

  try {
    const result = await appendSnapshot({
      sessionId: "sess-1",
      parentId: null,
      prompt: "hello",
      summary: "first",
      files: { "index.html": "<!DOCTYPE html>" },
    });
    assert.ok(result, "expected a Snapshot back");
    assert.equal(result?.id, "snap-1");
    assert.equal(result?.sessionId, "sess-1");
    assert.equal(result?.prompt, "hello");
    assert.ok(calls.length > 0, "supabase should have been called");
  } finally {
    __setSupabaseForTests(null);
  }
});

// ---------------------------------------------------------------------------
// Read paths still work regardless of ephemeral flag (contract: reads are
// allowed). Toggle ephemeral on and confirm loadSession + loadSnapshot still
// call the injected client.
// ---------------------------------------------------------------------------
test("ephemeral=true: reads (loadSession) still hit supabase", async () => {
  const { client, calls } = makeStub({
    sessions: {
      data: {
        id: "sess-1",
        created_at: "2026-04-18T00:00:00Z",
        parent_snapshot_id: null,
      },
      error: null,
    },
    snapshots: {
      data: [],
      error: null,
    },
  });
  __setSupabaseForTests(client as any);
  setEphemeral(true);

  try {
    const result = await loadSession("sess-1");
    assert.ok(result, "expected loadSession to succeed in ephemeral mode");
    assert.equal(result?.session.id, "sess-1");
    assert.ok(calls.length > 0, "loadSession should call supabase");
  } finally {
    setEphemeral(false);
    __setSupabaseForTests(null);
  }
});

test("ephemeral=true: reads (loadSnapshot) still hit supabase", async () => {
  const { client, calls } = makeStub({
    snapshots: {
      data: {
        id: "snap-1",
        session_id: "sess-1",
        parent_id: null,
        created_at: "2026-04-18T00:00:00Z",
        prompt: "x",
        summary: "y",
        files: {},
      },
      error: null,
    },
  });
  __setSupabaseForTests(client as any);
  setEphemeral(true);

  try {
    const result = await loadSnapshot("snap-1");
    assert.ok(result, "expected loadSnapshot to succeed in ephemeral mode");
    assert.equal(result?.id, "snap-1");
    assert.ok(calls.length > 0, "loadSnapshot should call supabase");
  } finally {
    setEphemeral(false);
    __setSupabaseForTests(null);
  }
});
