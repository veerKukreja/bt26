"use client";

import { useState } from "react";

interface Props {
  onFork: () => Promise<string | null>;
  disabled?: boolean;
}

export function ForkButton({ onFork, disabled }: Props) {
  const [state, setState] = useState<"idle" | "forking" | "copied">("idle");

  const handle = async () => {
    if (disabled || state !== "idle") return;
    setState("forking");
    const url = await onFork();
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
      setState("copied");
      setTimeout(() => setState("idle"), 1800);
    } else {
      setState("idle");
    }
  };

  const label =
    state === "forking" ? "forking…" : state === "copied" ? "url copied" : "fork";

  return (
    <button
      onClick={handle}
      disabled={disabled || state !== "idle"}
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 50,
        background: "rgba(18,18,22,0.78)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.15)",
        color: "#fff",
        padding: "10px 18px",
        borderRadius: 999,
        fontSize: 12,
        fontFamily: "ui-monospace, monospace",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 150ms ease",
        boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
      }}
    >
      {label}
    </button>
  );
}
