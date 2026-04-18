"use client";

// TODO-for-integration: replace local FeatureInventory alias with the real
// `FeatureInventory` type from `lib/types.ts` once P1 lands it. Keep the prop
// shape identical so no call-site changes are needed.
type FeatureInventory = {
  id?: string;
  title?: string;
  [key: string]: unknown;
};

export interface ReferencesPanelProps {
  references: FeatureInventory[];
  onChange: (next: FeatureInventory[]) => void;
}

export function ReferencesPanel({ references, onChange }: ReferencesPanelProps) {
  // `onChange` is accepted now so P13 can wire it in Phase 3 without a
  // breaking prop change. Reference it here to silence unused-var warnings.
  void onChange;

  const isEmpty = references.length === 0;

  return (
    <section
      aria-label="References panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "rgba(18,18,22,0.78)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        boxShadow:
          "0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
        padding: 20,
        color: "#fff",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          color: "rgba(255,255,255,0.6)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        References
      </header>

      {isEmpty ? (
        <div
          role="note"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 24,
            fontSize: 14,
            color: "rgba(255,255,255,0.55)",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            letterSpacing: "-0.01em",
            border: "1px dashed rgba(255,255,255,0.12)",
            borderRadius: 12,
          }}
        >
          Drop a URL or image to start.
        </div>
      ) : (
        <ul
          aria-label="Reference list"
          style={{
            flex: 1,
            listStyle: "none",
            margin: 0,
            padding: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {references.map((ref, i) => {
            const key =
              typeof ref.id === "string" && ref.id.length > 0
                ? ref.id
                : `ref-${i}`;
            const label =
              typeof ref.title === "string" && ref.title.length > 0
                ? ref.title
                : JSON.stringify(ref);
            return (
              <li
                key={key}
                style={{
                  fontSize: 13,
                  fontFamily: "ui-monospace, monospace",
                  color: "rgba(255,255,255,0.8)",
                  padding: "8px 10px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={label}
              >
                {label}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
