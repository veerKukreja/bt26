"use client";

import { useEffect, useRef, useState } from "react";
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
import type { FileMap, SessionUsage, Snapshot, WriteUp } from "@/lib/types";

export type Status =
  | { kind: "idle" }
  | { kind: "generating"; chars: number }
  | { kind: "fixing"; attempt: number }
  | { kind: "rolledback" }
  | { kind: "error"; message: string };

interface Props {
  onSubmit: (prompt: string) => void;
  onTranslate?: (toLanguage: string) => void;
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
}: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!exportOpen && !versionsOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideExport =
        (exportRef.current && exportRef.current.contains(target)) ||
        (exportPanelRef.current && exportPanelRef.current.contains(target));
      const insideVersions =
        (versionsRef.current && versionsRef.current.contains(target)) ||
        (versionsPanelRef.current && versionsPanelRef.current.contains(target));
      if (!insideExport) setExportOpen(false);
      if (!insideVersions) setVersionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (exportOpen) exportRef.current?.focus();
        if (versionsOpen) versionsRef.current?.focus();
        setExportOpen(false);
        setVersionsOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen, versionsOpen]);

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
    rec.continuous = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleStop = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => rec.stop(), 1500);
    };
    rec.onresult = (e: SpeechRecognitionEventLike) => {
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
      scheduleStop();
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      scheduleStop();
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

  const statusLabel = (() => {
    switch (status.kind) {
      case "generating":
        return `thinking · ${Math.floor(status.chars / 4)} tokens`;
      case "fixing":
        return `fixing · attempt ${status.attempt}`;
      case "rolledback":
        return "rolled back";
      case "error":
        return `error: ${status.message.slice(0, 80)}`;
      default:
        return null;
    }
  })();

  const busy = status.kind === "generating" || status.kind === "fixing";

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
      {statusLabel && (
        <div
          role="status"
          aria-live={status.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          style={{
            textAlign: "center",
            marginBottom: 10,
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
            color:
              status.kind === "error"
                ? "#ff6b6b"
                : status.kind === "rolledback"
                  ? "#f7b955"
                  : "rgba(255,255,255,0.7)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            textShadow: "0 1px 8px rgba(0,0,0,0.5)",
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
                marginRight: 8,
                verticalAlign: "middle",
                animation: "prism-pulse 1.2s ease-in-out infinite",
              }}
            />
          )}
          {statusLabel}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "rgba(18,18,22,0.78)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
          padding: "6px 8px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {usage && !isZeroUsage(usage) && (() => {
          const { energyWh, waterMl } = computeUsage(usage);
          return (
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
          );
        })()}

        {snapshots.length > 1 && (
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
        )}

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            disabled
              ? "Generating…"
              : "Tell this page what to become. Try: a Tokyo coffee shop at 3am"
          }
          disabled={disabled}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#fff",
            fontSize: 15,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            padding: "8px 12px",
            letterSpacing: "-0.01em",
            minWidth: 0,
          }}
        />

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

        {onTranslate && (
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
            title="Translate generated page"
          >
            <Languages size={16} />
          </button>
        )}

        <button
          type="button"
          onClick={handlePrint}
          disabled={disabled || printing}
          aria-label={printing ? "Preparing print…" : "Print"}
          style={iconBtn()}
          title="Print this page"
        >
          {printing ? <Loader2 size={15} className="spin" /> : <Printer size={15} />}
        </button>

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
          title={
            forkState === "forking"
              ? "forking…"
              : forkState === "copied"
                ? "URL copied"
                : "Fork to new URL"
          }
        >
          {forkState === "forking" ? (
            <Loader2 size={15} className="spin" />
          ) : forkState === "copied" ? (
            <Check size={15} />
          ) : (
            <GitFork size={15} />
          )}
        </button>

        {speechAvailable && (
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
            title={listening ? "Recording — click to stop" : "Voice input"}
          >
            {listening ? <Mic size={16} className="pulse" /> : <MicOff size={16} />}
          </button>
        )}

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
      {versionsOpen && snapshots.length > 1 && (
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
                  <button
                    type="button"
                    onClick={() => doZip(snap.files, snapSummary, snap.id)}
                    title="Download .zip"
                    style={{
                      width: 32, height: 32, border: "none", background: "transparent",
                      color: "rgba(255,255,255,0.6)", cursor: "pointer", borderRadius: 4,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <FileArchive size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => doHtml(snap.files, snapSummary, snap.id)}
                    title="Download .html"
                    style={{
                      width: 32, height: 32, border: "none", background: "transparent",
                      color: "rgba(255,255,255,0.6)", cursor: "pointer", borderRadius: 4,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <FileCode size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => doCsb(snap.files, snapSummary, snap.id)}
                    title="Copy CodeSandbox link"
                    style={{
                      width: 32, height: 32, border: "none", background: "transparent",
                      color: "rgba(255,255,255,0.6)", cursor: "pointer", borderRadius: 4,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <LinkIcon size={13} />
                  </button>
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
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        @keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .pulse { animation: mic-pulse 1.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
