"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Trash2, Copy, Pencil, X } from "lucide-react";

export interface EditorTarget {
  selector: string;
  tag: string;
  text: string;
  outerHTMLExcerpt: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface EditorEvent {
  event: "click" | "contextmenu";
  x: number;
  y: number;
  target: EditorTarget;
}

interface Props {
  event: EditorEvent | null;
  onClose: () => void;
  onSubmitEdit: (instruction: string, target: EditorTarget) => void;
}

export function ElementEditor({ event, onClose, onSubmitEdit }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!event) return;
    setValue("");
    if (event.event === "click") {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [event]);

  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [event, onClose]);

  if (!event) return null;

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmitEdit(v, event.target);
    onClose();
  };

  const anchor = clampAnchor(event.x, event.y);

  const sharedKeyframes = (
    <style>{`
      @keyframes prism-ee-in {
        from { opacity: 0; transform: translate3d(0, 6px, 0) scale(0.96); }
        to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
      }
      .prism-ee-row { transition: background 90ms ease, color 90ms ease; }
      .prism-ee-row:hover:not([disabled]) { background: rgba(255,255,255,0.08) !important; color: #fff !important; }
      .prism-ee-row:active:not([disabled]) { background: rgba(255,255,255,0.14) !important; }
      .prism-ee-btn { transition: all 120ms ease; }
      .prism-ee-btn:hover:not([disabled]) { transform: translateY(-1px); }
      .prism-ee-btn:active:not([disabled]) { transform: translateY(0); }
    `}</style>
  );

  if (event.event === "contextmenu") {
    return (
      <>
        {sharedKeyframes}
      <div
        ref={rootRef}
        role="menu"
        aria-label="Element actions"
        style={popoverBase(anchor.x, anchor.y, 220)}
      >
        <MenuRow
          icon={<Pencil size={14} />}
          label="Edit this element…"
          onClick={() => {
            onSubmitEdit("", event.target);
            setValue("");
            // Reopen as comment popover at same spot by relying on parent state switch
          }}
        />
        <MenuRow
          icon={<Trash2 size={14} />}
          label="Delete this element"
          onClick={() => {
            onSubmitEdit(`Delete this element from the page.`, event.target);
            onClose();
          }}
        />
        <MenuRow
          icon={<Copy size={14} />}
          label="Copy text"
          disabled={!event.target.text}
          onClick={async () => {
            try { await navigator.clipboard.writeText(event.target.text); } catch { /* ignore */ }
            onClose();
          }}
        />
        <MenuRow
          icon={<MessageSquare size={14} />}
          label="Describe a change…"
          onClick={() => {
            // Switch to comment mode inline: keep same popover, but turn
            // into a textarea input. Easiest: close and ask parent to
            // re-open as a click event.
            window.dispatchEvent(new CustomEvent("prism:reopen-as-click", {
              detail: event,
            }));
            onClose();
          }}
        />
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "4px 0" }} />
        <MenuRow icon={<X size={14} />} label="Close" onClick={onClose} />
      </div>
      </>
    );
  }

  // click — comment / describe popover
  return (
    <>
      {sharedKeyframes}
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Suggest an edit"
      style={popoverBase(anchor.x, anchor.y, 280)}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "ui-monospace, monospace",
          color: "rgba(255,255,255,0.45)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span>{event.target.tag ? `<${event.target.tag.toLowerCase()}>` : "locating…"}</span>
        <span style={{ opacity: 0.5 }}>click / right-click</span>
      </div>
      {event.target.text && (
        <div
          style={{
            fontSize: 11,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            color: "rgba(255,255,255,0.6)",
            marginBottom: 8,
            maxHeight: 42,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={event.target.text}
        >
          “{event.target.text.slice(0, 80)}{event.target.text.length > 80 ? "…" : ""}”
        </div>
      )}
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Describe the change — e.g. make it bigger, change the copy, use a darker color"
        rows={3}
        style={{
          width: "100%",
          resize: "vertical",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          color: "#fff",
          padding: 8,
          fontSize: 13,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          lineHeight: 1.4,
          outline: "none",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button type="button" className="prism-ee-btn" onClick={onClose} style={btnStyle(false)}>Cancel</button>
        <button type="button" className="prism-ee-btn" onClick={submit} disabled={!value.trim()} style={btnStyle(true, !value.trim())}>Apply</button>
      </div>
    </div>
    </>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="prism-ee-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        background: "transparent",
        border: "none",
        color: disabled ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.85)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        textAlign: "left",
        borderRadius: 4,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function popoverBase(x: number, y: number, minWidth: number): React.CSSProperties {
  return {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 70,
    minWidth,
    background: "rgba(18,18,22,0.96)",
    backdropFilter: "blur(24px) saturate(180%)",
    WebkitBackdropFilter: "blur(24px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    padding: 8,
    boxShadow: "0 18px 48px rgba(0,0,0,0.6)",
    color: "#fff",
    animation: "prism-ee-in 140ms cubic-bezier(0.16, 1, 0.3, 1) both",
    transformOrigin: "top left",
    willChange: "transform, opacity",
  };
}

function clampAnchor(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  const maxX = window.innerWidth - 300;
  const maxY = window.innerHeight - 220;
  return {
    x: Math.max(8, Math.min(x, maxX)),
    y: Math.max(8, Math.min(y, maxY)),
  };
}

function btnStyle(primary: boolean, disabled?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 11,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontWeight: 500,
    borderRadius: 6,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    background: primary
      ? disabled
        ? "rgba(255,255,255,0.08)"
        : "linear-gradient(135deg,#fff,#d8d8d8)"
      : "transparent",
    color: primary
      ? disabled
        ? "rgba(255,255,255,0.4)"
        : "#000"
      : "rgba(255,255,255,0.7)",
  };
}
