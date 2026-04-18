"use client";

import { ReferencesPanel } from "./ReferencesPanel";
import { WriteupPanel } from "./WriteupPanel";
import type { FeatureInventory, WriteUp } from "@/lib/types";

export interface BrainstormPaneProps {
  references: FeatureInventory[];
  writeup: WriteUp | null;
  onReferencesChange: (next: FeatureInventory[]) => void;
  onWriteupChange: (next: WriteUp | null) => void;
}

export function BrainstormPane({
  references,
  writeup,
  onReferencesChange,
  onWriteupChange,
}: BrainstormPaneProps) {
  return (
    <div
      role="region"
      aria-label="Brainstorm workspace"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
        gap: 16,
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <ReferencesPanel
        references={references}
        onChange={onReferencesChange}
      />
      <WriteupPanel writeup={writeup} onChange={onWriteupChange} references={references} />
    </div>
  );
}
