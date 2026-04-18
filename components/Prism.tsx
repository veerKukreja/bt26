"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Preview } from "./Preview";
import { PromptBar, type Status } from "./PromptBar";
import { streamGenerate } from "@/lib/generate-client";
import { DEFAULT_APP } from "@/lib/default-app";
import { EMPTY_USAGE, accumulateUsage } from "@/lib/env-usage";
import { emojiFaviconDataUri } from "@/lib/export-templates";
import type { FileMap, SessionUsage, Snapshot } from "@/lib/types";

interface Props {
  sessionId: string;
  initialSnapshots: Snapshot[];
  persistEnabled: boolean;
}

const MAX_RETRIES = 2;
const COMPILE_GRACE_MS = 1500;

const LS_KEY = (id: string) => `prism:session:${id}`;
const ENV_KEY = (id: string) => `prism:env:${id}`;

function loadUsage(sessionId: string): SessionUsage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ENV_KEY(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUsage;
    if (typeof parsed?.inputTokens !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveUsage(sessionId: string, usage: SessionUsage): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ENV_KEY(sessionId), JSON.stringify(usage));
  } catch {
    /* ignore */
  }
}

function loadLocal(sessionId: string): Snapshot[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocal(sessionId: string, snapshots: Snapshot[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY(sessionId), JSON.stringify(snapshots));
  } catch {
    /* quota exceeded; ignore */
  }
}

export function Prism({ sessionId, initialSnapshots, persistEnabled }: Props) {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialSnapshots);
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(initialSnapshots.length - 1, 0),
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    const local = loadLocal(sessionId);
    if (local && local.length > 0) {
      setSnapshots(local);
      setCurrentIndex(local.length - 1);
    }
    setHydrated(true);
  }, [sessionId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (snapshots.length > 1 || snapshots[0]?.id !== "origin") {
      saveLocal(sessionId, snapshots);
    }
  }, [sessionId, snapshots, hydrated]);

  const [sessionUsage, setSessionUsage] = useState<SessionUsage>(EMPTY_USAGE);
  const [usageHydrated, setUsageHydrated] = useState(false);

  useEffect(() => {
    if (usageHydrated) return;
    const existing = loadUsage(sessionId);
    if (existing) setSessionUsage(existing);
    setUsageHydrated(true);
  }, [sessionId, usageHydrated]);

  useEffect(() => {
    if (!usageHydrated) return;
    saveUsage(sessionId, sessionUsage);
  }, [sessionId, sessionUsage, usageHydrated]);
  const [pendingFiles, setPendingFiles] = useState<FileMap | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [versionKey, setVersionKey] = useState(0);

  const lastGoodFilesRef = useRef<FileMap>(
    initialSnapshots[initialSnapshots.length - 1]?.files ?? DEFAULT_APP,
  );
  const retryCountRef = useRef(0);
  const lastPromptRef = useRef<string>("");
  const lastSummaryRef = useRef<string>("");
  const compileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedThisCycleRef = useRef(false);

  const currentFiles: FileMap = useMemo(() => {
    if (pendingFiles) return pendingFiles;
    return snapshots[currentIndex]?.files ?? DEFAULT_APP;
  }, [pendingFiles, snapshots, currentIndex]);

  // Listen for postMessage from the sandbox (favicon/title updates)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "prism:meta") return;
      if (typeof data.title === "string" && data.title.length > 0) {
        document.title = data.title;
      }
      if (typeof data.favicon === "string" && data.favicon.length > 0) {
        const href = data.favicon.startsWith("data:")
          ? data.favicon
          : emojiFaviconDataUri(data.favicon);
        let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
        if (!link) {
          link = document.createElement("link");
          link.rel = "icon";
          document.head.appendChild(link);
        }
        link.href = href;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const commitSnapshot = useCallback(
    async (prompt: string, summary: string, files: FileMap) => {
      const committedSnap: Snapshot = {
        id: crypto.randomUUID(),
        sessionId,
        parentId: snapshots[currentIndex]?.id ?? null,
        createdAt: new Date().toISOString(),
        prompt,
        summary,
        files,
      };
      // Truncate any snapshots after current if user branched off a scrubbed state
      const truncated = snapshots.slice(0, currentIndex + 1);
      const next = [...truncated, committedSnap];
      setSnapshots(next);
      setCurrentIndex(next.length - 1);
      setPendingFiles(null);
      lastGoodFilesRef.current = files;
      if (persistEnabled) {
        fetch("/api/snapshots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            parentId: committedSnap.parentId,
            prompt,
            summary,
            files,
          }),
        }).catch(() => {});
      }
    },
    [sessionId, snapshots, currentIndex, persistEnabled],
  );

  const runGeneration = useCallback(
    async (
      prompt: string,
      baseFiles: FileMap,
      errorContext: string | null,
      attempt: number,
    ) => {
      lastPromptRef.current = prompt;
      committedThisCycleRef.current = false;
      setStatus(
        errorContext
          ? { kind: "fixing", attempt }
          : { kind: "generating", chars: 0 },
      );
      let gotFiles: FileMap | null = null;
      let gotSummary = "";
      await streamGenerate(
        { prompt, currentFiles: baseFiles, errorContext: errorContext ?? undefined },
        {
          onProgress: (chars) => {
            if (!errorContext) setStatus({ kind: "generating", chars });
          },
          onUsage: (usage) => {
            setSessionUsage((prev) => accumulateUsage(prev, usage));
          },
          onDone: (files, summary) => {
            gotFiles = files;
            gotSummary = summary;
          },
          onError: (message) => {
            setStatus({ kind: "error", message });
            setTimeout(() => setStatus({ kind: "idle" }), 4000);
          },
        },
      );
      if (!gotFiles) return;

      // Install as pending; Sandpack will attempt to compile.
      setPendingFiles(gotFiles);
      setVersionKey((k) => k + 1);
      lastSummaryRef.current = gotSummary;

      // Schedule a commit after grace period if Sandpack reports success OR is silent.
      if (compileTimerRef.current) clearTimeout(compileTimerRef.current);
      const files = gotFiles;
      const summary = gotSummary;
      compileTimerRef.current = setTimeout(() => {
        if (committedThisCycleRef.current) return;
        committedThisCycleRef.current = true;
        void commitSnapshot(prompt, summary, files);
        retryCountRef.current = 0;
        setStatus({ kind: "idle" });
      }, COMPILE_GRACE_MS);
    },
    [commitSnapshot],
  );

  const submit = useCallback(
    async (prompt: string) => {
      if (status.kind === "generating" || status.kind === "fixing") return;
      retryCountRef.current = 0;
      const base = currentFiles;
      await runGeneration(prompt, base, null, 0);
    },
    [status, currentFiles, runGeneration],
  );

  const handleSandpackReady = useCallback(() => {
    if (!pendingFiles) return;
    if (committedThisCycleRef.current) return;
    committedThisCycleRef.current = true;
    if (compileTimerRef.current) clearTimeout(compileTimerRef.current);
    void commitSnapshot(lastPromptRef.current, lastSummaryRef.current, pendingFiles);
    retryCountRef.current = 0;
    setStatus({ kind: "idle" });
  }, [pendingFiles, commitSnapshot]);

  const handleSandpackError = useCallback(
    (message: string) => {
      if (!pendingFiles) return;
      if (committedThisCycleRef.current) return;
      if (compileTimerRef.current) clearTimeout(compileTimerRef.current);

      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1;
        void runGeneration(
          lastPromptRef.current,
          lastGoodFilesRef.current,
          message,
          retryCountRef.current,
        );
      } else {
        // Revert to last-good
        setPendingFiles(null);
        setVersionKey((k) => k + 1);
        setStatus({ kind: "rolledback" });
        committedThisCycleRef.current = true;
        setTimeout(() => setStatus({ kind: "idle" }), 2500);
      }
    },
    [pendingFiles, runGeneration],
  );

  const handleFork = useCallback(async (): Promise<string | null> => {
    const parentSnapshot = snapshots[currentIndex];
    const newSessionId = crypto.randomUUID();

    // Seed the new session's history with the current snapshot as its origin.
    const seedSnapshot: Snapshot = {
      id: crypto.randomUUID(),
      sessionId: newSessionId,
      parentId: null,
      createdAt: new Date().toISOString(),
      prompt: "Forked",
      summary: parentSnapshot?.summary || "Forked",
      files: currentFiles,
    };
    saveLocal(newSessionId, [seedSnapshot]);

    if (persistEnabled) {
      try {
        await fetch("/api/fork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentSnapshotId: parentSnapshot?.id ?? null,
            files: currentFiles,
            summary: parentSnapshot?.summary ?? "Forked",
          }),
        });
      } catch {
        /* non-fatal */
      }
    }

    const url = `${window.location.origin}/s/${newSessionId}`;
    router.push(`/s/${newSessionId}`);
    return url;
  }, [snapshots, currentIndex, currentFiles, persistEnabled, router]);

  const scrub = useCallback(
    (index: number) => {
      if (index === currentIndex) return;
      setPendingFiles(null);
      setCurrentIndex(index);
      setVersionKey((k) => k + 1);
      lastGoodFilesRef.current = snapshots[index]?.files ?? DEFAULT_APP;
    },
    [currentIndex, snapshots],
  );

  const busy = status.kind === "generating" || status.kind === "fixing";
  const onBlankCanvas = snapshots.length <= 1 && status.kind === "idle";

  // Keyboard shortcuts: Cmd/Ctrl+Z = step back, Shift+Cmd/Ctrl+Z = step forward
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        e.preventDefault();
        if (busy) return;
        if (e.shiftKey) {
          scrub(Math.min(currentIndex + 1, snapshots.length - 1));
        } else {
          scrub(Math.max(currentIndex - 1, 0));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentIndex, snapshots.length, busy, scrub]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0a0a",
        overflow: "hidden",
      }}
    >
      <Preview
        versionKey={`v-${versionKey}`}
        files={currentFiles}
        onReady={handleSandpackReady}
        onError={handleSandpackError}
      />
      {/* Generation dim + shimmer */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 30,
          pointerEvents: "none",
          background: busy
            ? "radial-gradient(circle at 50% 120%, rgba(34,211,238,0.12), rgba(0,0,0,0.35) 60%)"
            : "transparent",
          transition: "background 400ms ease",
          mixBlendMode: "multiply",
        }}
      />
      {busy && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 31,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)",
            backgroundSize: "200% 100%",
            animation: "prism-shimmer 2.4s linear infinite",
          }}
        />
      )}
      {onBlankCanvas && <OnboardingHint />}
      <PromptBar
        onSubmit={submit}
        status={status}
        disabled={busy}
        usage={sessionUsage}
        snapshots={snapshots}
        currentIndex={currentIndex}
        onScrub={scrub}
        onFork={handleFork}
        currentFiles={currentFiles}
      />
      <style>{`
        @keyframes prism-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes prism-rise {
          0% { opacity: 0; transform: translate(-50%, 10px); }
          100% { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

function OnboardingHint() {
  return (
    <div
      style={{
        position: "fixed",
        top: "42%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 20,
        pointerEvents: "none",
        textAlign: "center",
        animation: "prism-rise 600ms ease-out both",
      }}
    >
      <div
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 48,
          fontWeight: 300,
          letterSpacing: "-0.03em",
          color: "#111",
          lineHeight: 1.05,
          mixBlendMode: "difference",
        }}
      >
        Prism
      </div>
      <div
        style={{
          marginTop: 16,
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(30,30,30,0.55)",
          mixBlendMode: "difference",
        }}
      >
        tell this page what to become
      </div>
    </div>
  );
}
