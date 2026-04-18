"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

// Module-level group state. When any tooltip is visible or was visible within
// the last 300ms, subsequent tooltips open without the delay — so scanning a
// toolbar feels instant instead of flickering through delays.
let groupCount = 0;
let groupTimer: number | undefined;

function acquireGroup(): void {
  groupCount += 1;
  if (groupTimer !== undefined) {
    clearTimeout(groupTimer);
    groupTimer = undefined;
  }
}

function releaseGroup(): void {
  groupCount = Math.max(0, groupCount - 1);
  if (groupCount === 0) {
    groupTimer = window.setTimeout(() => {
      groupTimer = undefined;
    }, 300);
  }
}

function isGroupActive(): boolean {
  return groupCount > 0 || groupTimer !== undefined;
}

function composeRefs<T>(
  ...refs: Array<Ref<T> | undefined | null>
): (instance: T | null) => void {
  return (instance) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(instance);
      else (ref as MutableRefObject<T | null>).current = instance;
    }
  };
}

interface Props {
  label: string;
  placement?: "top" | "bottom";
  openDelay?: number;
  gap?: number;
  children: ReactElement;
}

export function Tooltip({
  label,
  placement = "top",
  openDelay = 400,
  gap = 8,
  children,
}: Props) {
  const childRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const acquiredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = childRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const centerX = a.left + a.width / 2;
    let left = centerX - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    let place: "top" | "bottom" = placement;
    if (place === "top" && a.top - t.height - gap < 4) place = "bottom";
    if (place === "bottom" && a.bottom + t.height + gap > window.innerHeight - 4) place = "top";
    const top = place === "top" ? a.top - t.height - gap : a.bottom + gap;
    setPos({ left, top });
  }, [open, placement, gap, label]);

  const show = (): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const doOpen = (): void => {
      if (!acquiredRef.current) {
        acquireGroup();
        acquiredRef.current = true;
      }
      setOpen(true);
    };
    if (isGroupActive()) {
      doOpen();
    } else {
      timerRef.current = window.setTimeout(doOpen, openDelay);
    }
  };

  const hide = (): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setOpen(false);
    if (acquiredRef.current) {
      releaseGroup();
      acquiredRef.current = false;
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      if (acquiredRef.current) {
        releaseGroup();
        acquiredRef.current = false;
      }
    };
  }, []);

  if (!isValidElement(children)) return children;

  const childProps = children.props as {
    ref?: Ref<HTMLElement>;
    onMouseEnter?: (e: ReactMouseEvent) => void;
    onMouseLeave?: (e: ReactMouseEvent) => void;
    onFocus?: (e: ReactFocusEvent) => void;
    onBlur?: (e: ReactFocusEvent) => void;
    "aria-describedby"?: string;
  };
  const existingRef =
    (childProps.ref as Ref<HTMLElement> | undefined) ??
    ((children as unknown as { ref?: Ref<HTMLElement> }).ref ?? undefined);

  const existingDescribedBy = childProps["aria-describedby"];
  const describedBy = open
    ? existingDescribedBy
      ? `${existingDescribedBy} ${id}`
      : id
    : existingDescribedBy;

  const clonedChild = cloneElement(children, {
    ref: composeRefs(childRef, existingRef),
    "aria-describedby": describedBy,
    onMouseEnter: (e: ReactMouseEvent) => {
      childProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: ReactMouseEvent) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: ReactFocusEvent) => {
      childProps.onFocus?.(e);
      show();
    },
    onBlur: (e: ReactFocusEvent) => {
      childProps.onBlur?.(e);
      hide();
    },
  } as Record<string, unknown>);

  const tipStyle: CSSProperties = {
    position: "fixed",
    left: pos?.left ?? -9999,
    top: pos?.top ?? -9999,
    zIndex: 50,
    pointerEvents: "none",
    background: "rgba(10,10,10,0.92)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    padding: "5px 8px",
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    visibility: pos ? "visible" : "hidden",
    letterSpacing: "-0.005em",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  };

  return (
    <>
      {clonedChild}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div ref={tipRef} id={id} role="tooltip" style={tipStyle}>
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
