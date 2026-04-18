"use client";

// TODO-for-integration: replace local WriteUp alias with the real `WriteUp`
// type from `lib/types.ts` once P2 lands it. Keep the prop shape identical so
// no call-site changes are needed.
type WriteUp = {
  title?: string;
  body?: string;
  [key: string]: unknown;
};

export interface WriteupPanelProps {
  writeup: WriteUp | null;
  onChange: (next: WriteUp | null) => void;
}

export function WriteupPanel({ writeup, onChange }: WriteupPanelProps) {
  // `onChange` is accepted now so P14 can wire it in Phase 3 without a
  // breaking prop change. Reference it here to silence unused-var warnings.
  void onChange;

  const isEmpty = writeup === null;

  return (
    <section
      aria-label="Writeup panel"
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
        Writeup
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
          Describe what you want to build. We&apos;ll structure it into a spec.
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {typeof writeup.title === "string" && writeup.title.length > 0 && (
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#fff",
              }}
            >
              {writeup.title}
            </h2>
          )}
          <pre
            style={{
              margin: 0,
              flex: 1,
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              color: "rgba(255,255,255,0.75)",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "auto",
            }}
          >
            {JSON.stringify(writeup, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
