"use client";

import { ReferencesPanel } from "./ReferencesPanel";
import { WriteupPanel } from "./WriteupPanel";

// TODO-for-integration: replace local FeatureInventory / WriteUp aliases with
// the real types from `lib/types.ts` once P1 and P2 land them. Props shapes
// are stable so downstream call sites (P9) won't change.
type FeatureInventory = {
  id?: string;
  title?: string;
  [key: string]: unknown;
};

type WriteUp = {
  title?: string;
  body?: string;
  [key: string]: unknown;
};

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
      <WriteupPanel writeup={writeup} onChange={onWriteupChange} />
    </div>
  );
}
