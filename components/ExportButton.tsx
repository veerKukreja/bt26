"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileArchive, FileCode, Link as LinkIcon, Check, Loader2 } from "lucide-react";
import {
  buildZip,
  buildCodeSandboxUrl,
  requestHtmlBundle,
  triggerDownload,
  copyToClipboard,
  exportFilename,
} from "@/lib/export";
import type { FileMap } from "@/lib/types";

type BusyKey = "zip" | "html" | "csb" | null;

interface Props {
  files: FileMap;
  summary: string;
  snapshotId: string;
  disabled?: boolean;
}

export function ExportButton({ files, summary, snapshotId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<BusyKey>(null);
  const [done, setDone] = useState<BusyKey>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const doZip = async () => {
    setBusy("zip");
    try {
      const blob = await buildZip(files, { summary, id: snapshotId });
      triggerDownload(blob, exportFilename({ summary, id: snapshotId }, "zip"));
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const doHtml = async () => {
    setBusy("html");
    try {
      const blob = await requestHtmlBundle(files, summary);
      triggerDownload(blob, exportFilename({ summary, id: snapshotId }, "html"));
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const doCsb = async () => {
    setBusy("csb");
    try {
      const { url, overflow } = buildCodeSandboxUrl(files);
      if (overflow) {
        const blob = await buildZip(files, { summary, id: snapshotId });
        triggerDownload(blob, exportFilename({ summary, id: snapshotId }, "zip"));
        showToast("Too large for CodeSandbox — downloaded .zip instead.");
      } else {
        const ok = await copyToClipboard(url);
        if (ok) {
          setDone("csb");
          setTimeout(() => setDone(null), 1500);
        } else {
          showToast(`Couldn't copy — URL: ${url}`);
        }
      }
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      if (busy !== "csb") setOpen(false);
    }
  };

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 12px",
    background: "transparent",
    border: "none",
    color: active ? "#fff" : "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    cursor: active ? "default" : "pointer",
    textAlign: "left",
  });

  return (
    <>
      <div
        ref={rootRef}
        style={{ position: "fixed", top: 16, right: 92, zIndex: 50 }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={disabled}
          aria-label="Export"
          style={{
            width: 36,
            height: 36,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(20,20,20,0.85)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            color: "#fff",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Download size={16} />
        </button>
        {open && (
          <div
            style={{
              position: "absolute",
              top: 44,
              right: 0,
              minWidth: 220,
              background: "rgba(20,20,20,0.92)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: 4,
              boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
            }}
          >
            <button onClick={doZip} disabled={busy !== null} style={itemStyle(busy === "zip")}>
              {busy === "zip" ? <Loader2 size={14} className="spin" /> : <FileArchive size={14} />}
              Download .zip
            </button>
            <button onClick={doHtml} disabled={busy !== null} style={itemStyle(busy === "html")}>
              {busy === "html" ? <Loader2 size={14} className="spin" /> : <FileCode size={14} />}
              Download .html
            </button>
            <button onClick={doCsb} disabled={busy !== null} style={itemStyle(busy === "csb" || done === "csb")}>
              {busy === "csb" ? (
                <Loader2 size={14} className="spin" />
              ) : done === "csb" ? (
                <Check size={14} />
              ) : (
                <LinkIcon size={14} />
              )}
              {done === "csb" ? "Copied!" : "Copy CodeSandbox link"}
            </button>
          </div>
        )}
      </div>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 56,
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
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin 0.9s linear infinite}`}</style>
    </>
  );
}
