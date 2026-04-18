"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Preview } from "./Preview";
import { PromptBar, type Status } from "./PromptBar";
import { BrainstormPane } from "./BrainstormPane";
import { streamGenerate } from "@/lib/generate-client";
import { DEFAULT_APP } from "@/lib/default-app";
import { EMPTY_USAGE, accumulateUsage } from "@/lib/env-usage";
import { emojiFaviconDataUri } from "@/lib/export-templates";
import { setEphemeral as setSnapshotsEphemeral } from "@/lib/snapshots";
import { LanguageProvider, SUPPORTED_LANGS, type SupportedLang } from "@/lib/i18n";
import { detectLanguage, isRTL } from "@/lib/language";
import type { FeatureInventory, FileMap, SessionUsage, Snapshot, WriteUp } from "@/lib/types";

interface Props {
  sessionId: string;
  initialSnapshots: Snapshot[];
  persistEnabled: boolean;
}

type Mode = "build" | "brainstorm";

const MAX_RETRIES = 2;
const COMPILE_GRACE_MS = 1500;

const LS_KEY = (id: string) => `prism:session:${id}`;
const ENV_KEY = (id: string) => `prism:env:${id}`;
const REFS_KEY = (id: string) => `prism:refs:${id}`;
const WRITEUP_KEY = (id: string) => `prism:writeup:${id}`;
const MODE_KEY = (id: string) => `prism:mode:${id}`;
const EPHEMERAL_KEY = "prism:ephemeral";
const LANG_KEY = "prism:lang";

function readJson<T>(key: string, storage: Storage): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, storage: Storage): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function Prism({ sessionId, initialSnapshots, persistEnabled }: Props) {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialSnapshots);
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(initialSnapshots.length - 1, 0),
  );
  const [hydrated, setHydrated] = useState(false);

  const [ephemeral, setEphemeral] = useState(false);
  const [mode, setMode] = useState<Mode>("build");
  const [lang, setLang] = useState<SupportedLang>("en");
  const [references, setReferences] = useState<FeatureInventory[]>([]);
  const [writeup, setWriteup] = useState<WriteUp | null>(null);

  // Hydrate user prefs + session storage on mount.
  useEffect(() => {
    if (hydrated) return;
    if (typeof window === "undefined") return;

    const persistedEphemeral = window.localStorage.getItem(EPHEMERAL_KEY) === "1";
    setEphemeral(persistedEphemeral);
    setSnapshotsEphemeral(persistedEphemeral);

    const persistedLang = window.localStorage.getItem(LANG_KEY) as SupportedLang | null;
    if (persistedLang && SUPPORTED_LANGS.includes(persistedLang)) {
      setLang(persistedLang);
    } else {
      setLang(detectLanguage());
    }

    const storage: Storage = persistedEphemeral ? window.sessionStorage : window.localStorage;

    const persistedMode = storage.getItem(MODE_KEY(sessionId));
    if (persistedMode === "brainstorm" || persistedMode === "build") setMode(persistedMode);

    if (!persistedEphemeral) {
      const local = readJson<Snapshot[]>(LS_KEY(sessionId), window.localStorage);
      if (local && Array.isArray(local) && local.length > 0) {
        setSnapshots(local);
        setCurrentIndex(local.length - 1);
      }
    }

    const refs = readJson<FeatureInventory[]>(REFS_KEY(sessionId), storage);
    if (refs && Array.isArray(refs)) setReferences(refs);
    const w = readJson<WriteUp>(WRITEUP_KEY(sessionId), storage);
    if (w) setWriteup(w);

    setHydrated(true);
  }, [sessionId, hydrated]);

  // Keep snapshots writer gated by ephemeral.
  useEffect(() => {
    if (!hydrated) return;
    if (ephemeral) return;
    if (snapshots.length > 1 || snapshots[0]?.id !== "origin") {
      writeJson(LS_KEY(sessionId), snapshots, window.localStorage);
    }
  }, [sessionId, snapshots, hydrated, ephemeral]);

  // Refs + writeup + mode persistence honors ephemeral choice.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const storage = ephemeral ? window.sessionStorage : window.localStorage;
    writeJson(REFS_KEY(sessionId), references, storage);
  }, [sessionId, references, hydrated, ephemeral]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const storage = ephemeral ? window.sessionStorage : window.localStorage;
    if (writeup) writeJson(WRITEUP_KEY(sessionId), writeup, storage);
    else storage.removeItem(WRITEUP_KEY(sessionId));
  }, [sessionId, writeup, hydrated, ephemeral]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const storage = ephemeral ? window.sessionStorage : window.localStorage;
    storage.setItem(MODE_KEY(sessionId), mode);
  }, [sessionId, mode, hydrated, ephemeral]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    if (ephemeral) window.localStorage.setItem(EPHEMERAL_KEY, "1");
    else window.localStorage.removeItem(EPHEMERAL_KEY);
    setSnapshotsEphemeral(ephemeral);
  }, [ephemeral, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL(lang) ? "rtl" : "ltr";
  }, [lang, hydrated]);

  const [sessionUsage, setSessionUsage] = useState<SessionUsage>(EMPTY_USAGE);
  const [usageHydrated, setUsageHydrated] = useState(false);

  useEffect(() => {
    if (usageHydrated) return;
    if (typeof window === "undefined") {
      setUsageHydrated(true);
      return;
    }
    if (!ephemeral) {
      const existing = readJson<SessionUsage>(ENV_KEY(sessionId), window.localStorage);
      if (existing && typeof existing.inputTokens === "number") setSessionUsage(existing);
    }
    setUsageHydrated(true);
  }, [sessionId, usageHydrated, ephemeral]);

  useEffect(() => {
    if (!usageHydrated || typeof window === "undefined") return;
    if (ephemeral) return;
    writeJson(ENV_KEY(sessionId), sessionUsage, window.localStorage);
  }, [sessionId, sessionUsage, usageHydrated, ephemeral]);

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
  const nextWriteupRef = useRef<WriteUp | null>(null);

  const currentFiles: FileMap = useMemo(() => {
    if (pendingFiles) return pendingFiles;
    return snapshots[currentIndex]?.files ?? DEFAULT_APP;
  }, [pendingFiles, snapshots, currentIndex]);

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
      const truncated = snapshots.slice(0, currentIndex + 1);
      const next = [...truncated, committedSnap];
      setSnapshots(next);
      setCurrentIndex(next.length - 1);
      setPendingFiles(null);
      lastGoodFilesRef.current = files;
      if (persistEnabled && !ephemeral) {
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
    [sessionId, snapshots, currentIndex, persistEnabled, ephemeral],
  );

  const runGeneration = useCallback(
    async (
      prompt: string,
      baseFiles: FileMap,
      errorContext: string | null,
      attempt: number,
      opts?: { translate?: { toLanguage: string }; writeup?: WriteUp },
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
        {
          prompt,
          currentFiles: baseFiles,
          errorContext: errorContext ?? undefined,
          translate: opts?.translate,
          writeup: opts?.writeup,
        },
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

      setPendingFiles(gotFiles);
      setVersionKey((k) => k + 1);
      lastSummaryRef.current = gotSummary;

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

      const useWriteup = mode === "brainstorm" && writeup ? writeup : undefined;
      nextWriteupRef.current = useWriteup ?? null;

      await runGeneration(prompt, base, null, 0, useWriteup ? { writeup: useWriteup } : undefined);

      if (useWriteup) setMode("build");
    },
    [status, currentFiles, runGeneration, mode, writeup],
  );

  const submitTranslate = useCallback(
    async (toLanguage: string) => {
      if (status.kind === "generating" || status.kind === "fixing") return;
      retryCountRef.current = 0;
      await runGeneration(
        `Translate all user-visible text to ${toLanguage}.`,
        currentFiles,
        null,
        0,
        { translate: { toLanguage } },
      );
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

    const seedSnapshot: Snapshot = {
      id: crypto.randomUUID(),
      sessionId: newSessionId,
      parentId: null,
      createdAt: new Date().toISOString(),
      prompt: "Forked",
      summary: parentSnapshot?.summary || "Forked",
      files: currentFiles,
    };
    if (!ephemeral) {
      writeJson(LS_KEY(newSessionId), [seedSnapshot], window.localStorage);
    }

    if (persistEnabled && !ephemeral) {
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
  }, [snapshots, currentIndex, currentFiles, persistEnabled, router, ephemeral]);

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
  const onBlankCanvas = snapshots.length <= 1 && status.kind === "idle" && mode === "build";

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
    <LanguageProvider initialLang={lang} onLangChange={setLang}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0a0a0a",
          overflow: "hidden",
        }}
      >
        {mode === "build" ? (
          <Preview
            versionKey={`v-${versionKey}`}
            files={currentFiles}
            onReady={handleSandpackReady}
            onError={handleSandpackError}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, paddingBottom: 120 }}>
            <BrainstormPane
              references={references}
              writeup={writeup}
              onReferencesChange={setReferences}
              onWriteupChange={setWriteup}
            />
          </div>
        )}

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

        <TopBar
          mode={mode}
          onModeChange={setMode}
          ephemeral={ephemeral}
          onEphemeralChange={setEphemeral}
          lang={lang}
          onLangChange={setLang}
          hasWriteup={!!writeup}
        />

        {ephemeral && <EphemeralBadge />}

        {onBlankCanvas && <OnboardingHint />}

        <PromptBar
          onSubmit={submit}
          onTranslate={submitTranslate}
          status={status}
          disabled={busy}
          usage={sessionUsage}
          snapshots={snapshots}
          currentIndex={currentIndex}
          onScrub={scrub}
          onFork={handleFork}
          currentFiles={currentFiles}
          lang={lang}
          mode={mode}
          writeup={writeup}
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
    </LanguageProvider>
  );
}

interface TopBarProps {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  ephemeral: boolean;
  onEphemeralChange: (e: boolean) => void;
  lang: SupportedLang;
  onLangChange: (l: SupportedLang) => void;
  hasWriteup: boolean;
}

const LANG_LABELS: Record<SupportedLang, string> = {
  en: "English",
  es: "Español",
  ht: "Kreyòl",
  zh: "中文",
  ar: "العربية",
  bn: "বাংলা",
  fr: "Français",
  ru: "Русский",
};

function TopBar({ mode, onModeChange, ephemeral, onEphemeralChange, lang, onLangChange, hasWriteup }: TopBarProps) {
  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    fontSize: 11,
    fontFamily: "ui-monospace, monospace",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    background: active ? "rgba(255,255,255,0.14)" : "transparent",
    color: active ? "#fff" : "rgba(255,255,255,0.6)",
    border: "none",
    cursor: active ? "default" : "pointer",
    borderRadius: 999,
  });

  return (
    <div style={{ position: "fixed", top: 14, left: 16, zIndex: 55, display: "flex", gap: 8, alignItems: "center" }}>
      <div
        role="tablist"
        aria-label="Mode"
        style={{
          display: "inline-flex",
          background: "rgba(18,18,22,0.78)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
          padding: 3,
        }}
      >
        <button
          role="tab"
          aria-selected={mode === "build"}
          onClick={() => onModeChange("build")}
          style={pillStyle(mode === "build")}
        >
          Build
        </button>
        <button
          role="tab"
          aria-selected={mode === "brainstorm"}
          onClick={() => onModeChange("brainstorm")}
          style={pillStyle(mode === "brainstorm")}
          title={hasWriteup ? "Continue brainstorming — you have a draft" : "Plan before building"}
        >
          Brainstorm{hasWriteup ? " •" : ""}
        </button>
      </div>

      <button
        onClick={() => onEphemeralChange(!ephemeral)}
        aria-pressed={ephemeral}
        title={ephemeral ? "Ephemeral is ON — nothing is being saved" : "Turn on ephemeral mode"}
        style={{
          padding: "8px 14px",
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          background: ephemeral ? "rgba(247,185,85,0.2)" : "rgba(18,18,22,0.78)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          color: ephemeral ? "#f7b955" : "rgba(255,255,255,0.6)",
          border: `1px solid ${ephemeral ? "rgba(247,185,85,0.4)" : "rgba(255,255,255,0.12)"}`,
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        {ephemeral ? "● Ephemeral" : "Ephemeral"}
      </button>

      <select
        value={lang}
        onChange={(e) => onLangChange(e.target.value as SupportedLang)}
        aria-label="Interface language"
        style={{
          padding: "8px 12px",
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          background: "rgba(18,18,22,0.78)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          color: "rgba(255,255,255,0.8)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
          cursor: "pointer",
          appearance: "none",
        }}
      >
        {SUPPORTED_LANGS.map((code) => (
          <option key={code} value={code} style={{ background: "#0a0a0a", color: "#fff" }}>
            {LANG_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}

function EphemeralBadge() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 54,
        padding: "6px 14px",
        fontSize: 10,
        fontFamily: "ui-monospace, monospace",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: "#f7b955",
        background: "rgba(247,185,85,0.1)",
        border: "1px solid rgba(247,185,85,0.3)",
        borderRadius: 999,
        pointerEvents: "none",
      }}
    >
      Ephemeral — nothing is being saved
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
