"use client";

import type { Snapshot } from "@/lib/types";
import { SnapshotHoverCard } from "./SnapshotHoverCard";

interface Props {
  snapshots: Snapshot[];
  currentIndex: number;
  onScrub: (index: number) => void;
}

export function Timeline({ snapshots, currentIndex, onScrub }: Props) {
  if (snapshots.length <= 1) return null;
  const current = snapshots[currentIndex];

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: 40,
        zIndex: 40,
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        background:
          "linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%)",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          textShadow: "0 1px 4px rgba(0,0,0,0.8)",
        }}
      >
        v{currentIndex + 1}/{snapshots.length}
      </div>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: 2,
          background: "rgba(255,255,255,0.12)",
          borderRadius: 2,
          pointerEvents: "auto",
        }}
      >
        {snapshots.map((snap, i) => (
          <div
            key={snap.id}
            style={{
              position: "absolute",
              left: `${(i / Math.max(snapshots.length - 1, 1)) * 100}%`,
              top: "50%",
            }}
          >
            <SnapshotHoverCard
              snapshot={snap}
              index={i}
              total={snapshots.length}
              active={i === currentIndex}
              onScrub={() => onScrub(i)}
            />
          </div>
        ))}
        <input
          type="range"
          min={0}
          max={snapshots.length - 1}
          value={currentIndex}
          onChange={(e) => onScrub(Number(e.target.value))}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: 20,
            top: -9,
            opacity: 0,
            cursor: "pointer",
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 12,
          color: "rgba(255,255,255,0.7)",
          maxWidth: 360,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textShadow: "0 1px 4px rgba(0,0,0,0.8)",
        }}
      >
        {current?.summary || current?.prompt || ""}
      </div>
    </div>
  );
}
