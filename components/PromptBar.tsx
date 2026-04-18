"use client";

import { useEffect, useRef, useState } from "react";
import { HoverCard } from "./HoverCard";
import { computeUsage, isZeroUsage } from "@/lib/env-usage";
import type { SessionUsage } from "@/lib/types";

export type Status =
  | { kind: "idle" }
  | { kind: "generating"; chars: number }
  | { kind: "fixing"; attempt: number }
  | { kind: "rolledback" }
  | { kind: "error"; message: string };

interface Props {
  onSubmit: (prompt: string) => void;
  status: Status;
  disabled: boolean;
  usage?: SessionUsage;
}

function formatNumber(n: number): string {
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return Math.round(n).toString();
}

export function PromptBar({ onSubmit, status, disabled, usage }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trackerRef = useRef<HTMLButtonElement>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

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

  const submit = () => {
    const v = value.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setValue("");
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

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 28,
        transform: "translateX(-50%)",
        zIndex: 50,
        width: "min(720px, calc(100vw - 48px))",
      }}
    >
      {statusLabel && (
        <div
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
          background: "rgba(18,18,22,0.78)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
          padding: "6px 8px 6px 22px",
          boxShadow:
            "0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
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
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "0 12px 0 0",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                color: "rgba(255,255,255,0.45)",
                whiteSpace: "nowrap",
                letterSpacing: "0.04em",
                borderRight: "1px solid rgba(255,255,255,0.08)",
                marginRight: 10,
                alignSelf: "stretch",
                display: "flex",
                alignItems: "center",
              }}
            >
              {formatNumber(energyWh)} Wh · {formatNumber(waterMl)} mL
            </button>
          );
        })()}
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
            padding: "14px 12px 14px 0",
            letterSpacing: "-0.01em",
          }}
        />
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
          }}
          aria-label="Generate"
        >
          ↑
        </button>
      </form>
      {usage && !isZeroUsage(usage) && (
        <HoverCard
          anchorRef={trackerRef}
          open={methodologyOpen}
          placement="top"
          onRequestClose={() => setMethodologyOpen(false)}
        >
          <div
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
      <style>{`
        @keyframes prism-pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
