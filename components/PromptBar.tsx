"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Download,
  FileArchive,
  FileCode,
  Link as LinkIcon,
  Loader2,
  Check,
  GitFork,
  Layers,
  Mic,
  MicOff,
  Languages,
  Printer,
} from "lucide-react";
import { HoverCard } from "./HoverCard";
import { Tooltip } from "./Tooltip";
import { computeUsage, isZeroUsage } from "@/lib/env-usage";
import {
  buildZip,
  buildCodeSandboxUrl,
  requestHtmlBundle,
  triggerDownload,
  copyToClipboard,
  exportFilename,
} from "@/lib/export";
import { printCurrentSession } from "@/lib/print";
import { speechLangCode } from "@/lib/language";
import type { SupportedLang } from "@/lib/i18n";
import type { ActionEntry, FileMap, SessionUsage, Snapshot, WriteUp } from "@/lib/types";
import { derivePhase, estimateTokens, formatElapsed } from "@/lib/generate-status";

export type Status =
  | { kind: "idle" }
  | {
      kind: "generating";
      chars: number;
      startedAt: number;
      lastProgressAt: number;
      filesDone: number;
      currentFile: string | null;
      mcpLabel: string | null;
      toolStarted: boolean;
    }
  | { kind: "fixing"; attempt: number; startedAt: number; lastProgressAt: number }
  | { kind: "rolledback" }
  | { kind: "error"; message: string };

interface Props {
  onSubmit: (prompt: string) => void;
  onTranslate?: (toLanguage: string) => void;
  onCancel?: () => void;
  status: Status;
  disabled: boolean;
  usage?: SessionUsage;
  snapshots: Snapshot[];
  currentIndex: number;
  onScrub: (index: number) => void;
  onFork: () => Promise<string | null>;
  currentFiles: FileMap;
  lang?: SupportedLang;
  mode?: "build" | "brainstorm";
  writeup?: WriteUp | null;
  actions?: ActionEntry[];
  currentPrompt?: string | null;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { isFinal: boolean; [i: number]: { transcript: string } };
  };
}

const TRANSLATE_LANGS: Array<{ code: SupportedLang; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "ht", label: "Kreyòl" },
  { code: "zh", label: "中文" },
  { code: "ar", label: "العربية" },
  { code: "bn", label: "বাংলা" },
  { code: "fr", label: "Français" },
  { code: "ru", label: "Русский" },
];

type BusyKey = "zip" | "html" | "csb" | null;

function formatNumber(n: number): string {
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return Math.round(n).toString();
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const s = Math.max(1, Math.round((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export function PromptBar({
  onSubmit,
  onTranslate,
  status,
  disabled,
  usage,
  snapshots,
  currentIndex,
  onScrub,
  onFork,
  currentFiles,
  lang = "en",
  mode = "build",
  writeup,
  actions = [],
  currentPrompt = null,
  onCancel,
}: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const translateRef = useRef<HTMLButtonElement>(null);
  const [translateOpen, setTranslateOpen] = useState(false);

  const [printing, setPrinting] = useState(false);

  const trackerRef = useRef<HTMLButtonElement>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const versionsRef = useRef<HTMLButtonElement>(null);
  const versionsPanelRef = useRef<HTMLDivElement>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);

  const exportRef = useRef<HTMLButtonElement>(null);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<BusyKey>(null);
  const [exportDone, setExportDone] = useState<BusyKey>(null);

  const [forkState, setForkState] = useState<"idle" | "forking" | "copied">("idle");

  const historyRef = useRef<HTMLButtonElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const transientTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const scheduleTransient = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      transientTimersRef.current.delete(t);
      fn();
    }, ms);
    transientTimersRef.current.add(t);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSpeechAvailable(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    const timers = transientTimersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!exportOpen && !versionsOpen && !historyOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideExport =
        (exportRef.current && exportRef.current.contains(target)) ||
        (exportPanelRef.current && exportPanelRef.current.contains(target));
      const insideVersions =
        (versionsRef.current && versionsRef.current.contains(target)) ||
        (versionsPanelRef.current && versionsPanelRef.current.contains(target));
      const insideHistory =
        (historyRef.current && historyRef.current.contains(target)) ||
        (historyPanelRef.current && historyPanelRef.current.contains(target));
      if (!insideExport) setExportOpen(false);
      if (!insideVersions) setVersionsOpen(false);
      if (!insideHistory) setHistoryOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (exportOpen) exportRef.current?.focus();
        if (versionsOpen) versionsRef.current?.focus();
        if (historyOpen) historyRef.current?.focus();
        setExportOpen(false);
        setVersionsOpen(false);
        setHistoryOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen, versionsOpen, historyOpen]);

  const submit = () => {
    const v = value.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setValue("");
  };

  const showToast = (message: string) => {
    setToast(message);
    scheduleTransient(() => setToast(null), 4000);
  };

  const toggleMic = () => {
    if (!speechAvailable || typeof window === "undefined") return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = speechLangCode(lang);
    rec.interimResults = true;
    rec.continuous = true;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let sawFirstResult = false;
    let initialGrace: ReturnType<typeof setTimeout> | null = null;
    const scheduleStop = (ms: number) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        try { rec.stop(); } catch { /* already stopped */ }
      }, ms);
    };
    rec.onresult = (e: SpeechRecognitionEventLike) => {
      if (initialGrace) { clearTimeout(initialGrace); initialGrace = null; }
      sawFirstResult = true;
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setValue((prev) => {
        const base = prev.replace(/[\u0001]?$/, "");
        return final ? `${base}${final}`.trim() : `${base} ${interim}`.trim();
      });
      scheduleStop(1500);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (initialGrace) clearTimeout(initialGrace);
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      // Give up to 15s of initial silence before auto-stopping if the user never speaks.
      initialGrace = setTimeout(() => {
        if (!sawFirstResult) {
          try { rec.stop(); } catch { /* ignore */ }
        }
      }, 15_000);
    } catch {
      setListening(false);
    }
  };

  const handleTranslate = (toLanguage: string) => {
    setTranslateOpen(false);
    if (onTranslate) onTranslate(toLanguage);
  };

  const handlePrint = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      await printCurrentSession(currentFiles, { paperSize: "letter" });
    } catch (e) {
      showToast(`Print failed: ${(e as Error).message}`);
    } finally {
      setPrinting(false);
    }
  };

  const activeSnap = snapshots[currentIndex];
  const activeSummary = activeSnap?.summary || activeSnap?.prompt || "Prism";
  const activeId = activeSnap?.id ?? "origin";

  const doZip = async (files: FileMap, summary: string, id: string) => {
    setExportBusy("zip");
    try {
      const blob = await buildZip(files, { summary, id });
      triggerDownload(blob, exportFilename({ summary, id }, "zip"));
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
      setExportOpen(false);
    }
  };

  const doHtml = async (files: FileMap, summary: string, id: string) => {
    setExportBusy("html");
    try {
      const blob = await requestHtmlBundle(files, summary);
      triggerDownload(blob, exportFilename({ summary, id }, "html"));
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
      setExportOpen(false);
    }
  };

  const doCsb = async (files: FileMap, summary: string, id: string) => {
    setExportBusy("csb");
    try {
      const { url, overflow } = buildCodeSandboxUrl(files);
      if (overflow) {
        const blob = await buildZip(files, { summary, id });
        triggerDownload(blob, exportFilename({ summary, id }, "zip"));
        showToast("Too large for CodeSandbox — downloaded .zip instead.");
      } else {
        const ok = await copyToClipboard(url);
        if (ok) {
          setExportDone("csb");
          scheduleTransient(() => setExportDone(null), 1500);
        } else {
          showToast(`Couldn't copy — URL: ${url}`);
        }
      }
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setExportBusy(null);
    }
  };

  const handleFork = async () => {
    if (disabled || forkState !== "idle") return;
    setForkState("forking");
    const url = await onFork();
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
      setForkState("copied");
      scheduleTransient(() => setForkState("idle"), 1800);
    } else {
      setForkState("idle");
    }
  };

  const [heartbeat, setHeartbeat] = useState(0);
  const busy = status.kind === "generating" || status.kind === "fixing";
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setHeartbeat((n) => n + 1), 650);
    return () => clearInterval(id);
  }, [busy]);

  const STALL_THRESHOLD_MS = 8000;
  const statusView = (() => {
    void heartbeat;
    if (status.kind === "generating") {
      const now = Date.now();
      const elapsedMs = now - status.startedAt;
      const stallMs = now - status.lastProgressAt;
      const stalled = stallMs > STALL_THRESHOLD_MS;
      let phase: string;
      if (stalled) {
        phase = `waiting on API · ${formatElapsed(stallMs)} silent`;
      } else {
        phase = derivePhase({
          chars: status.chars,
          tail: "",
          elapsedMs,
          filesDone: status.filesDone,
          currentFile: status.currentFile,
          mcpLabel: status.mcpLabel,
          toolStarted: status.toolStarted,
        }).phase;
      }
      const pieces: string[] = [];
      if (status.filesDone > 0) pieces.push(`${status.filesDone} ${status.filesDone === 1 ? "file" : "files"}`);
      pieces.push(formatElapsed(elapsedMs));
      if (status.chars > 0) pieces.push(`${estimateTokens(status.chars)} tok`);
      return {
        primary: phase,
        meta: pieces.join(" · "),
        tone: stalled ? ("warn" as const) : ("busy" as const),
      };
    }
    if (status.kind === "fixing") {
      const elapsedMs = Date.now() - status.startedAt;
      return {
        primary: `fixing · attempt ${status.attempt}`,
        meta: formatElapsed(elapsedMs),
        tone: "busy" as const,
      };
    }
    if (status.kind === "rolledback") {
      return { primary: "rolled back", meta: "", tone: "warn" as const };
    }
    if (status.kind === "error") {
      return { primary: `error: ${status.message.slice(0, 80)}`, meta: "", tone: "error" as const };
    }
    return null;
  })();

  const pillBtn = (opts: { active?: boolean; muted?: boolean } = {}): React.CSSProperties => ({
    background: opts.active ? "rgba(255,255,255,0.08)" : "transparent",
    border: "none",
    cursor: "pointer",
    padding: "6px 10px",
    fontSize: 11,
    fontFamily: "ui-monospace, monospace",
    color: opts.muted ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.75)",
    whiteSpace: "nowrap",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    borderRadius: 6,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
  });

  const iconBtn = (opts: { active?: boolean } = {}): React.CSSProperties => ({
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: opts.active ? "rgba(255,255,255,0.08)" : "transparent",
    border: "none",
    borderRadius: 6,
    color: "rgba(255,255,255,0.75)",
    cursor: "pointer",
  });

  const dropdownItemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 12px",
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    border: "none",
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    cursor: "pointer",
    textAlign: "left",
    borderRadius: 6,
  });

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 28,
        transform: "translateX(-50%)",
        zIndex: 50,
        width: "min(880px, calc(100vw - 48px))",
      }}
    >
      {statusView && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 10,
            position: "relative",
          }}
        >
        <button
          ref={historyRef}
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          role="status"
          aria-live={status.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          aria-haspopup="dialog"
          aria-expanded={historyOpen}
          title="View history"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "6px 14px",
            borderRadius: 999,
            background: "rgba(15,15,18,0.82)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: historyOpen
              ? "1px solid rgba(255,255,255,0.22)"
              : "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
            color:
              statusView.tone === "error"
                ? "#ff8a8a"
                : statusView.tone === "warn"
                  ? "#ffcc70"
                  : "rgba(255,255,255,0.95)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {busy && (
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#fff",
                alignSelf: "center",
                animation: "prism-pulse 1.2s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
          )}
          <span
            key={statusView.primary}
            style={{
              animation: busy ? "prism-status-fade 400ms ease-out" : undefined,
            }}
          >
            {statusView.primary}
          </span>
          {statusView.meta && (
            <span
              style={{
                color: "rgba(255,255,255,0.55)",
                fontSize: 11,
                letterSpacing: "0.06em",
              }}
            >
              {statusView.meta}
            </span>
          )}
        </button>
        {historyOpen && (
          <HistoryPanel
            panelRef={historyPanelRef}
            currentPrompt={currentPrompt}
            status={status}
            actions={actions}
            onCancel={onCancel}
          />
        )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          background: "rgba(18,18,22,0.78)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 20,
          padding: "8px 10px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {usage && !isZeroUsage(usage) && (() => {
          const { energyWh, waterMl } = computeUsage(usage);
          return (
            <Tooltip label="Session energy & water · click for methodology">
              <button
                type="button"
                ref={trackerRef}
                onClick={() => setMethodologyOpen((o) => !o)}
                aria-label="Environmental usage — click for methodology"
                aria-haspopup="dialog"
                aria-expanded={methodologyOpen}
                aria-describedby={methodologyOpen ? "env-methodology" : undefined}
                style={pillBtn({ muted: true })}
              >
                {formatNumber(energyWh)} Wh · {formatNumber(waterMl)} mL
              </button>
            </Tooltip>
          );
        })()}

        {(snapshots.length > 1 || (snapshots.length === 1 && snapshots[0]?.id !== "origin")) && (
          <Tooltip label={`Version history · v${currentIndex + 1} of ${snapshots.length}`}>
            <button
              type="button"
              ref={versionsRef}
              onClick={() => {
                setVersionsOpen((o) => !o);
                setExportOpen(false);
              }}
              aria-label={`Versions — currently v${currentIndex + 1} of ${snapshots.length}`}
              aria-haspopup="menu"
              aria-expanded={versionsOpen}
              style={pillBtn({ active: versionsOpen })}
            >
              <Layers size={12} />
              v{currentIndex + 1}/{snapshots.length}
            </button>
          </Tooltip>
        )}

        <div style={{ flex: 1 }} />

        <Tooltip label="Export · .zip · .html · CodeSandbox">
          <button
            type="button"
            ref={exportRef}
            onClick={() => {
              setExportOpen((o) => !o);
              setVersionsOpen(false);
            }}
            disabled={disabled && !exportOpen}
            aria-label="Export"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            style={iconBtn({ active: exportOpen })}
          >
            <Download size={16} />
          </button>
        </Tooltip>

        {onTranslate && (
          <Tooltip label="Translate this page">
            <button
              type="button"
              ref={translateRef}
              onClick={() => {
                setTranslateOpen((o) => !o);
                setExportOpen(false);
                setVersionsOpen(false);
              }}
              disabled={disabled}
              aria-label="Translate"
              aria-haspopup="menu"
              aria-expanded={translateOpen}
              style={iconBtn({ active: translateOpen })}
            >
              <Languages size={16} />
            </button>
          </Tooltip>
        )}

        <Tooltip label={printing ? "Preparing print…" : "Print this page"}>
          <button
            type="button"
            onClick={handlePrint}
            disabled={disabled || printing}
            aria-label={printing ? "Preparing print…" : "Print"}
            style={iconBtn()}
          >
            {printing ? <Loader2 size={15} className="spin" /> : <Printer size={15} />}
          </button>
        </Tooltip>

        <Tooltip
          label={
            forkState === "forking"
              ? "Forking…"
              : forkState === "copied"
                ? "Fork URL copied to clipboard"
                : "Fork to a new URL"
          }
        >
          <button
            type="button"
            onClick={handleFork}
            disabled={disabled || forkState !== "idle"}
            aria-label={
              forkState === "forking"
                ? "Forking…"
                : forkState === "copied"
                  ? "Fork URL copied"
                  : "Fork to new URL"
            }
            style={{
              ...iconBtn(),
              color: forkState === "copied" ? "#8eff8e" : "rgba(255,255,255,0.75)",
            }}
          >
            {forkState === "forking" ? (
              <Loader2 size={15} className="spin" />
            ) : forkState === "copied" ? (
              <Check size={15} />
            ) : (
              <GitFork size={15} />
            )}
          </button>
        </Tooltip>

        {speechAvailable && (
          <Tooltip label={listening ? "Recording · click to stop" : "Voice input"}>
            <button
              type="button"
              onClick={toggleMic}
              disabled={disabled}
              aria-label={listening ? "Stop recording" : "Start voice input"}
              aria-pressed={listening}
              style={{
                ...iconBtn({ active: listening }),
                color: listening ? "#ff6b6b" : "rgba(255,255,255,0.75)",
              }}
            >
              {listening ? <Mic size={16} className="pulse" /> : <MicOff size={16} />}
            </button>
          </Tooltip>
        )}

        <Tooltip
          label={
            mode === "brainstorm" && writeup
              ? "Build from this brainstorm"
              : disabled
                ? "Generating…"
                : "Generate · Enter"
          }
        >
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            style={{
              border: "none",
              borderRadius: 999,
              background:
                !value.trim() || disabled
                  ? "rgba(255,255,255,0.1)"
                  : "linear-gradient(135deg, #fff 0%, #d8d8d8 100%)",
              color: !value.trim() || disabled ? "rgba(255,255,255,0.4)" : "#000",
              width: 40,
              height: 40,
              cursor: disabled ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 120ms ease",
              fontSize: 16,
              marginLeft: 4,
            }}
            aria-label={
              mode === "brainstorm" && writeup
                ? "Build from brainstorm"
                : disabled
                  ? "Generating"
                  : "Generate"
            }
          >
            ↑
          </button>
        </Tooltip>
        </div>
        <div style={{ position: "relative" }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!disabled && value.trim()) submit();
              }
            }}
            disabled={disabled}
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#fff",
              fontSize: 15,
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              padding: "6px 10px",
              letterSpacing: "-0.01em",
              lineHeight: 1.4,
              minWidth: 0,
              maxHeight: 200,
              resize: "none",
              overflowY: "auto",
              transition: "height 150ms ease",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: "6px 10px",
              pointerEvents: "none",
              color: "rgba(255,255,255,0.35)",
              fontSize: 15,
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              letterSpacing: "-0.01em",
              lineHeight: 1.4,
              opacity: value.trim() === "" ? 1 : 0,
              transform: value.trim() === "" ? "translateY(0)" : "translateY(-2px)",
              transition: "opacity 150ms ease, transform 150ms ease",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              userSelect: "none",
            }}
          >
            {disabled
              ? "Generating…"
              : "Tell this page what to become. Try: a Tokyo coffee shop at 3am"}
          </div>
        </div>
      </form>

      {/* Methodology popup */}
      {usage && !isZeroUsage(usage) && (
        <HoverCard
          anchorRef={trackerRef}
          open={methodologyOpen}
          placement="top"
          onRequestClose={() => setMethodologyOpen(false)}
        >
          <div
            id="env-methodology"
            role="dialog"
            aria-label="Environmental usage methodology"
            style={{
              minWidth: 280,
              color: "rgba(255,255,255,0.92)",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 8,
            }}>
              Session usage so far
            </div>
            <div style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              color: "rgba(255,255,255,0.8)",
              marginBottom: 10,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span>input</span><span>{usage.inputTokens.toLocaleString()} tokens</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span>output</span><span>{usage.outputTokens.toLocaleString()} tokens</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span>cache-read</span><span>{usage.cacheReadTokens.toLocaleString()} tokens</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span>cache-create</span><span>{usage.cacheCreationTokens.toLocaleString()} tokens</span>
              </div>
            </div>
            <div style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 10,
              color: "rgba(255,255,255,0.55)",
              paddingTop: 8,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              marginBottom: 8,
            }}>
              energy ≈ (input + output + cache-create<br />
              &nbsp;&nbsp;+ 0.1 × cache-read) × 0.3 Wh / 1k<br />
              water ≈ effective tokens × 0.5 mL / 1k
            </div>
            <div style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.4)",
              fontStyle: "italic",
            }}>
              Rough approximation from published inference estimates; not audited.
            </div>
          </div>
        </HoverCard>
      )}

      {/* Versions dropdown */}
      {versionsOpen && snapshots.length >= 1 && (
        <div
          ref={versionsPanelRef}
          role="menu"
          aria-label="Session versions"
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: 0,
            maxHeight: 320,
            overflowY: "auto",
            width: "min(560px, 100%)",
            background: "rgba(18,18,22,0.95)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: 6,
            boxShadow: "0 14px 40px rgba(0,0,0,0.6)",
          }}
        >
          {snapshots.map((snap, i) => {
            const isActive = i === currentIndex;
            const snapSummary = snap.summary || snap.prompt || "Untitled";
            return (
              <div
                key={snap.id}
                style={{
                  ...dropdownItemStyle(isActive),
                  justifyContent: "space-between",
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onScrub(i);
                    setVersionsOpen(false);
                    versionsRef.current?.focus();
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                    padding: 0,
                  }}
                >
                  <div style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isActive ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)",
                    marginBottom: 2,
                  }}>
                    v{i + 1} · {relativeTime(snap.createdAt)}
                    {isActive && <span style={{ marginLeft: 8 }}>· current</span>}
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.82)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {snapSummary}
                  </div>
                </button>
                <div style={{ display: "flex", gap: 2, flexShrink: 0, marginLeft: 10 }}>
                  <Tooltip label="Download .zip">
                    <button
                      type="button"
                      onClick={() => doZip(snap.files, snapSummary, snap.id)}
                      style={{
                        width: 32, height: 32, border: "none", background: "transparent",
                        color: "rgba(255,255,255,0.6)", cursor: "pointer", borderRadius: 4,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <FileArchive size={13} />
                    </button>
                  </Tooltip>
                  <Tooltip label="Download .html">
                    <button
                      type="button"
                      onClick={() => doHtml(snap.files, snapSummary, snap.id)}
                      style={{
                        width: 32, height: 32, border: "none", background: "transparent",
                        color: "rgba(255,255,255,0.6)", cursor: "pointer", borderRadius: 4,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <FileCode size={13} />
                    </button>
                  </Tooltip>
                  <Tooltip label="Copy CodeSandbox link">
                    <button
                      type="button"
                      onClick={() => doCsb(snap.files, snapSummary, snap.id)}
                      style={{
                        width: 32, height: 32, border: "none", background: "transparent",
                        color: "rgba(255,255,255,0.6)", cursor: "pointer", borderRadius: 4,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <LinkIcon size={13} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Export dropdown */}
      {exportOpen && (
        <div
          ref={exportPanelRef}
          role="menu"
          aria-label="Export current snapshot"
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            right: 88,
            minWidth: 220,
            background: "rgba(18,18,22,0.95)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: 6,
            boxShadow: "0 14px 40px rgba(0,0,0,0.6)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => doZip(currentFiles, activeSummary, activeId)}
            disabled={exportBusy !== null}
            style={dropdownItemStyle(exportBusy === "zip")}
          >
            {exportBusy === "zip" ? <Loader2 size={14} className="spin" /> : <FileArchive size={14} />}
            Download .zip
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => doHtml(currentFiles, activeSummary, activeId)}
            disabled={exportBusy !== null}
            style={dropdownItemStyle(exportBusy === "html")}
          >
            {exportBusy === "html" ? <Loader2 size={14} className="spin" /> : <FileCode size={14} />}
            Download .html
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => doCsb(currentFiles, activeSummary, activeId)}
            disabled={exportBusy !== null}
            style={dropdownItemStyle(exportBusy === "csb" || exportDone === "csb")}
          >
            {exportBusy === "csb" ? (
              <Loader2 size={14} className="spin" />
            ) : exportDone === "csb" ? (
              <Check size={14} />
            ) : (
              <LinkIcon size={14} />
            )}
            {exportDone === "csb" ? "Copied!" : "Copy CodeSandbox link"}
          </button>
        </div>
      )}

      {/* Translate dropdown */}
      {onTranslate && (
        <HoverCard
          anchorRef={translateRef}
          open={translateOpen}
          placement="top"
          onRequestClose={() => setTranslateOpen(false)}
        >
          <div role="menu" aria-label="Translate to" style={{ minWidth: 200, maxHeight: 320, overflowY: "auto" }}>
            <div style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 6,
              padding: "0 8px",
            }}>Translate to</div>
            {TRANSLATE_LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                role="menuitem"
                onClick={() => handleTranslate(l.label)}
                style={dropdownItemStyle(false)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </HoverCard>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: "fixed",
            bottom: 120,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            background: "rgba(180,40,40,0.95)",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes prism-pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes prism-status-fade {
          from { opacity: 0.35; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        @keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .pulse { animation: mic-pulse 1.2s ease-in-out infinite; }
        @keyframes prism-history-rise {
          from { opacity: 0; transform: translate(-50%, 6px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

function HistoryPanel({
  panelRef,
  currentPrompt,
  status,
  actions,
  onCancel,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  currentPrompt: string | null;
  status: Status;
  actions: ActionEntry[];
  onCancel?: () => void;
}) {
  const busy = status.kind === "generating" || status.kind === "fixing";
  const liveElapsed =
    (status.kind === "generating" || status.kind === "fixing") && status.startedAt
      ? Date.now() - status.startedAt
      : 0;
  const liveTokens = status.kind === "generating" ? estimateTokens(status.chars) : 0;
  const stallMs =
    status.kind === "generating" || status.kind === "fixing"
      ? Date.now() - status.lastProgressAt
      : 0;
  const stalled = busy && stallMs > 8000;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Generation history"
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(520px, calc(100vw - 48px))",
        maxHeight: "60vh",
        overflowY: "auto",
        background: "rgba(15,15,18,0.96)",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        padding: 12,
        fontFamily: "ui-monospace, monospace",
        color: "rgba(255,255,255,0.88)",
        fontSize: 12,
        animation: "prism-history-rise 180ms ease-out",
        textAlign: "left",
      }}
    >
      {busy && currentPrompt && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 10,
            borderRadius: 10,
            background: stalled ? "rgba(255,200,100,0.06)" : "rgba(120,170,255,0.08)",
            border: stalled
              ? "1px solid rgba(255,200,100,0.28)"
              : "1px solid rgba(120,170,255,0.22)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: stalled ? "rgba(255,210,140,0.9)" : "rgba(160,200,255,0.85)",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: stalled ? "#ffcc70" : "#7db3ff",
                animation: "prism-pulse 1.2s ease-in-out infinite",
              }}
            />
            {stalled ? `api quiet · ${formatElapsed(stallMs)}` : "in progress"} ·{" "}
            {formatElapsed(liveElapsed)}
            {liveTokens > 0 && ` · ${liveTokens} tok`}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "rgba(255,255,255,0.85)",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: "ui-monospace, monospace",
                  cursor: "pointer",
                }}
              >
                cancel
              </button>
            )}
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.95)",
              fontSize: 12.5,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {currentPrompt}
          </div>
          {stalled && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                lineHeight: 1.4,
                color: "rgba(255,210,140,0.75)",
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              no response from the API for {formatElapsed(stallMs)}. cancel &amp; retry often helps.
            </div>
          )}
        </div>
      )}

      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)",
          padding: "4px 4px 8px",
        }}
      >
        history {actions.length > 0 && `· ${actions.length}`}
      </div>

      {actions.length === 0 ? (
        <div
          style={{
            padding: "16px 12px",
            color: "rgba(255,255,255,0.5)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          no completed actions yet
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {actions.map((a) => (
            <li
              key={a.id}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: a.error ? "rgba(255,100,100,0.06)" : "rgba(255,255,255,0.035)",
                border: a.error
                  ? "1px solid rgba(255,100,100,0.2)"
                  : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 9.5,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: a.error ? "#ff8a8a" : "rgba(255,255,255,0.5)",
                  }}
                >
                  {a.error ? "error" : a.kind}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "rgba(255,255,255,0.5)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatElapsed(a.durationMs)} · {a.tokens.toLocaleString()} tok
                  {a.filesCount > 0 && ` · ${a.filesCount}f`}
                </span>
              </div>
              <div
                style={{
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                {a.prompt}
              </div>
              {a.summary && !a.error && (
                <div
                  style={{
                    marginTop: 4,
                    color: "rgba(255,255,255,0.55)",
                    fontSize: 11.5,
                    lineHeight: 1.4,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  {a.summary}
                </div>
              )}
              {a.error && (
                <div
                  style={{
                    marginTop: 4,
                    color: "#ff8a8a",
                    fontSize: 11.5,
                    lineHeight: 1.4,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  {a.error}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
