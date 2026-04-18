"use client";

import { useEffect, useRef, useState } from "react";

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
}

export function PromptBar({ onSubmit, status, disabled }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
      <style>{`
        @keyframes prism-pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
