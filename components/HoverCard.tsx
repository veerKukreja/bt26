"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  placement?: "top" | "bottom";
  gap?: number;
  onRequestClose?: () => void;
  children: ReactNode;
}

export function HoverCard({
  anchorRef,
  open,
  placement = "top",
  gap = 12,
  onRequestClose,
  children,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const anchorRect = anchor.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const centerX = anchorRect.left + anchorRect.width / 2;
    let left = centerX - cardRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - cardRect.width - 8));
    const top =
      placement === "top"
        ? anchorRect.top - cardRect.height - gap
        : anchorRect.bottom + gap;
    setPos({ left, top });
  }, [open, anchorRef, placement, gap]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRequestClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onRequestClose]);

  if (!open) return null;

  const style: CSSProperties = {
    position: "fixed",
    left: pos?.left ?? -9999,
    top: pos?.top ?? -9999,
    zIndex: 41,
    pointerEvents: "auto",
    background: "rgba(20,20,20,0.85)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 10px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    visibility: pos ? "visible" : "hidden",
  };

  return (
    <div ref={cardRef} style={style}>
      {children}
    </div>
  );
}
