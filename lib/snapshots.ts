import { getSupabase } from "./supabase";
import type { FileMap, Snapshot, Session } from "./types";

export async function createSession(
  parentSnapshotId: string | null = null,
): Promise<Session | null> {
  const sb = getSupabase();
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
  const sb = getSupabase();
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
  const sb = getSupabase();
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
  const sb = getSupabase();
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
