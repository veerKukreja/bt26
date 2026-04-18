/**
 * Snapshot persistence layer.
 *
 * Ephemeral contract
 * ------------------
 * This module supports an "ephemeral" mode (toggled via `setEphemeral(true)`).
 * When ephemeral is on, every write path (`createSession`, `appendSnapshot`)
 * becomes a no-op: no Supabase client is touched, no network request is issued,
 * no I/O of any kind. The function returns a sensible default (`null`) so call
 * sites that already tolerate a null return (e.g. when Supabase is
 * unconfigured) continue to work without modification. Read paths
 * (`loadSession`, `loadSnapshot`) still query Supabase when a client is
 * available — ephemeral mode is about write suppression, not read suppression.
 * This lets the app run entirely from in-memory / localStorage history while
 * leaving any fallback read of an existing server-persisted session possible.
 *
 * Design choice: option (a) from the plan — a single module-level
 * `ephemeralState` guard flipped by `setEphemeral(flag)`. Chosen because every
 * existing call site (app/page.tsx, app/api/fork/route.ts,
 * app/api/snapshots/route.ts, app/s/[sessionId]/page.tsx) calls these
 * functions with their current signatures; threading an extra flag through
 * each would churn all of them. A module-level switch is set once at boot and
 * keeps the public API unchanged.
 */
import { getSupabase } from "./supabase";
import type { FileMap, Snapshot, Session } from "./types";

let ephemeralState = false;

export function setEphemeral(flag: boolean): void {
  ephemeralState = flag;
}

export function isEphemeral(): boolean {
  return ephemeralState;
}

// Test-only hook: allow injecting a supabase client so tests do not need a
// real network or full module-mocking harness. When `__client` is non-null, it
// replaces `getSupabase()` for the duration of the test. Not part of the
// public API — production code should never call this.
type SupabaseLike = ReturnType<typeof getSupabase>;
let __injectedClient: SupabaseLike | null = null;
export function __setSupabaseForTests(client: SupabaseLike): void {
  __injectedClient = client;
}
function resolveClient(): SupabaseLike {
  return __injectedClient ?? getSupabase();
}

export async function createSession(
  parentSnapshotId: string | null = null,
): Promise<Session | null> {
  if (ephemeralState) return null;
  const sb = resolveClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sessions")
    .insert({ parent_snapshot_id: parentSnapshotId })
    .select()
    .single();
  if (error) {
    console.error("createSession", error);
    return null;
  }
  return {
    id: data.id,
    createdAt: data.created_at,
    parentSnapshotId: data.parent_snapshot_id,
  };
}

export async function appendSnapshot(args: {
  sessionId: string;
  parentId: string | null;
  prompt: string;
  summary: string;
  files: FileMap;
}): Promise<Snapshot | null> {
  if (ephemeralState) return null;
  const sb = resolveClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("snapshots")
    .insert({
      session_id: args.sessionId,
      parent_id: args.parentId,
      prompt: args.prompt,
      summary: args.summary,
      files: args.files,
    })
    .select()
    .single();
  if (error) {
    console.error("appendSnapshot", error);
    return null;
  }
  return rowToSnapshot(data);
}

export async function loadSession(
  sessionId: string,
): Promise<{ session: Session; snapshots: Snapshot[] } | null> {
  const sb = resolveClient();
  if (!sb) return null;
  const [{ data: sess, error: se }, { data: snaps, error: sne }] =
    await Promise.all([
      sb.from("sessions").select("*").eq("id", sessionId).single(),
      sb
        .from("snapshots")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true }),
    ]);
  if (se || sne || !sess) return null;
  return {
    session: {
      id: sess.id,
      createdAt: sess.created_at,
      parentSnapshotId: sess.parent_snapshot_id,
    },
    snapshots: (snaps ?? []).map(rowToSnapshot),
  };
}

export async function loadSnapshot(
  snapshotId: string,
): Promise<Snapshot | null> {
  const sb = resolveClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("snapshots")
    .select("*")
    .eq("id", snapshotId)
    .single();
  if (error || !data) return null;
  return rowToSnapshot(data);
}

function rowToSnapshot(row: {
  id: string;
  session_id: string;
  parent_id: string | null;
  created_at: string;
  prompt: string | null;
  summary: string | null;
  files: FileMap;
}): Snapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    createdAt: row.created_at,
    prompt: row.prompt ?? "",
    summary: row.summary ?? "",
    files: row.files,
  };
}
