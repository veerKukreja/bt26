import { Prism } from "@/components/Prism";
import { DEFAULT_APP } from "@/lib/default-app";
import { loadSession } from "@/lib/snapshots";
import { supabaseConfigured } from "@/lib/supabase";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Params {
  sessionId: string;
}

export default async function SessionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { sessionId } = await params;
  const persistEnabled = supabaseConfigured();

  let snapshots: Snapshot[] = [];
  if (persistEnabled) {
    const loaded = await loadSession(sessionId);
    if (loaded) snapshots = loaded.snapshots;
  }

  if (snapshots.length === 0) {
    snapshots = [
      {
        id: "origin",
        sessionId,
        parentId: null,
        createdAt: new Date().toISOString(),
        prompt: "",
        summary: "Origin",
        files: DEFAULT_APP,
      },
    ];
  }

  return (
    <Prism
      sessionId={sessionId}
      initialSnapshots={snapshots}
      persistEnabled={persistEnabled}
    />
  );
}
