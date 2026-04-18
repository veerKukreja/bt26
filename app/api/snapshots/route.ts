import { NextRequest, NextResponse } from "next/server";
import { appendSnapshot } from "@/lib/snapshots";
import { supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "persistence disabled" }, { status: 200 });
  }
  const body = (await req.json()) as {
    sessionId: string;
    parentId: string | null;
    prompt: string;
    summary: string;
    files: Record<string, string>;
  };
  const saved = await appendSnapshot(body);
  return NextResponse.json({ ok: Boolean(saved), snapshot: saved });
}
