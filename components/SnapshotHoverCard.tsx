"use client";

import { useRef, useState } from "react";
import { FileArchive, FileCode, Link as LinkIcon, Loader2, Check } from "lucide-react";
import { HoverCard } from "./HoverCard";
import {
  buildZip,
  buildCodeSandboxUrl,
  requestHtmlBundle,
  triggerDownload,
  copyToClipboard,
  exportFilename,
} from "@/lib/export";
import type { Snapshot } from "@/lib/types";

interface Props {
  snapshot: Snapshot;
  index: number;
  total: number;
  active: boolean;
  onScrub: () => void;
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

type BusyKey = "zip" | "html" | "csb" | null;

export function SnapshotHoverCard({ snapshot, index, active, onScrub }: Props) {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<BusyKey>(null);
  const [done, setDone] = useState<BusyKey>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const onEnter = () => {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), 150);
  };

  const onLeave = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  const summary = snapshot.summary || snapshot.prompt || "Untitled";

  const runZip = async () => {
    setBusy("zip");
    try {
      const blob = await buildZip(snapshot.files, { summary, id: snapshot.id });
      triggerDownload(blob, exportFilename({ summary, id: snapshot.id }, "zip"));
    } finally { setBusy(null); }
  };

  const runHtml = async () => {
    setBusy("html");
    try {
      const blob = await requestHtmlBundle(snapshot.files, summary);
      triggerDownload(blob, exportFilename({ summary, id: snapshot.id }, "html"));
    } catch { /* swallow for per-snapshot; primary button surfaces toast */ }
    finally { setBusy(null); }
  };

  const runCsb = async () => {
    setBusy("csb");
    const { url, overflow } = buildCodeSandboxUrl(snapshot.files);
    if (overflow) {
      await runZip();
    } else {
      if (await copyToClipboard(url)) {
        setDone("csb");
        setTimeout(() => setDone(null), 1500);
      }
    }
    setBusy(null);
  };

  const iconBtn = (active: boolean): React.CSSProperties => ({
    width: 26,
    height: 26,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: active ? "#fff" : "rgba(255,255,255,0.7)",
    cursor: active ? "default" : "pointer",
  });

  return (
    <>
      <div
        ref={dotRef}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onScrub}
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: active ? 10 : 6,
          height: active ? 10 : 6,
          borderRadius: "50%",
          background: active ? "#fff" : "rgba(255,255,255,0.4)",
          cursor: "pointer",
          transition: "all 150ms ease",
          boxShadow: active ? "0 0 12px rgba(255,255,255,0.6)" : "none",
          pointerEvents: "auto",
        }}
      />
      <HoverCard anchorRef={dotRef} open={open} placement="top" onRequestClose={() => setOpen(false)}>
        <div
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          style={{ minWidth: 220, color: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          <div style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}>
            v{index + 1} · {relativeTime(snapshot.createdAt)}
          </div>
          <div style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.8)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 260,
            marginBottom: 8,
          }}>
            {summary}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={runZip} disabled={busy !== null} style={iconBtn(busy === "zip")} title="Download .zip">
              {busy === "zip" ? <Loader2 size={14} className="spin" /> : <FileArchive size={14} />}
            </button>
            <button onClick={runHtml} disabled={busy !== null} style={iconBtn(busy === "html")} title="Download .html">
              {busy === "html" ? <Loader2 size={14} className="spin" /> : <FileCode size={14} />}
            </button>
            <button onClick={runCsb} disabled={busy !== null} style={iconBtn(busy === "csb" || done === "csb")} title="Copy CodeSandbox link">
              {busy === "csb" ? <Loader2 size={14} className="spin" /> : done === "csb" ? <Check size={14} /> : <LinkIcon size={14} />}
            </button>
          </div>
        </div>
      </HoverCard>
    </>
  );
}
