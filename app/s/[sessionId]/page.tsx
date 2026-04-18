import type { Metadata } from "next";
import { Prism } from "@/components/Prism";
import { DEFAULT_APP } from "@/lib/default-app";
import { loadSession } from "@/lib/snapshots";
import { supabaseConfigured } from "@/lib/supabase";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Params {
  sessionId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { sessionId } = await params;
  const ogUrl = `/og/${sessionId}`;
  return {
    title: "Prism",
    description: "A self-modifying website. Tell this page what to become.",
    openGraph: {
      title: "Prism",
      description: "A self-modifying website. Tell this page what to become.",
      type: "website",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Prism",
      description: "A self-modifying website. Tell this page what to become.",
      images: [ogUrl],
    },
  };
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
