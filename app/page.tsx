import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { createSession } from "@/lib/snapshots";
import { supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (supabaseConfigured()) {
    const session = await createSession(null);
    if (session) redirect(`/s/${session.id}`);
  }
  redirect(`/s/${randomUUID()}`);
}
