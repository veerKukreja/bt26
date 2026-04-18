import { NextRequest, NextResponse } from "next/server";
import { createSession, appendSnapshot } from "@/lib/snapshots";
import { supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "persistence disabled" },
      { status: 400 },
    );
  }
  const body = (await req.json()) as {
    parentSnapshotId: string | null;
    files: Record<string, string>;
    summary: string;
  };
  const session = await createSession(body.parentSnapshotId);
  if (!session) {
    return NextResponse.json(
      { error: "failed to create session" },
      { status: 500 },
    );
  }
  await appendSnapshot({
    sessionId: session.id,
    parentId: null,
    prompt: "Forked",
    summary: body.summary || "Forked",
    files: body.files,
  });
  return NextResponse.json({ sessionId: session.id });
}
