"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link as LinkIcon, Upload, X, GitCompare, Loader2 } from "lucide-react";
import type { FeatureInventory } from "@/lib/types";

export interface ReferencesPanelProps {
  references: FeatureInventory[];
  onChange: (next: FeatureInventory[]) => void;
}

interface CompareResult {
  intersection: string[];
  union: string[];
  gap: string[];
}

function readFilesAsDataUris(files: FileList | File[]): Promise<string[]> {
  return Promise.all(
    Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          }),
      ),
  );
}

export function ReferencesPanel({ references, onChange }: ReferencesPanelProps) {
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState<"url" | "images" | "compare" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [comparing, setComparing] = useState<CompareResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const ingestUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setBusy("url");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "url", url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "HTTP " + res.status }));
        throw new Error(err?.error ?? "Ingest failed");
      }
      const inv = (await res.json()) as FeatureInventory;
      onChange([...references, inv]);
      setUrlInput("");
    } catch (e) {
      showToast(`Ingest failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const ingestImages = async (files: FileList | File[]) => {
    setBusy("images");
    try {
      const images = await readFilesAsDataUris(files);
      if (images.length === 0) return;
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "images", images }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "HTTP " + res.status }));
        throw new Error(err?.error ?? "Ingest failed");
      }
      const inv = (await res.json()) as FeatureInventory;
      onChange([...references, inv]);
    } catch (e) {
      showToast(`Ingest failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!e.dataTransfer?.files?.length) return;
    void ingestImages(e.dataTransfer.files);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) void ingestImages(files);
    e.target.value = "";
  };

  const deleteRef = (i: number) => {
    onChange(references.filter((_, idx) => idx !== i));
    if (expanded === i) setExpanded(null);
    if (comparing) setComparing(null);
  };

  const compare = async () => {
    setBusy("compare");
    try {
      const res = await fetch("/api/ingest/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ references }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "HTTP " + res.status }));
        throw new Error(err?.error ?? "Compare failed");
      }
      const result = (await res.json()) as CompareResult;
      setComparing(result);
    } catch (e) {
      showToast(`Compare failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="References panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        width: "100%",
        background: "rgba(18,18,22,0.78)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        boxShadow: "0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
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
        }}
      >
        References
      </header>

      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://..."
          disabled={busy !== null}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void ingestUrl();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            color: "#fff",
            padding: "8px 10px",
            fontSize: 13,
            fontFamily: "ui-monospace, monospace",
          }}
        />
        <button
          type="button"
          onClick={ingestUrl}
          disabled={busy !== null || !urlInput.trim()}
          aria-label="Ingest URL"
          style={iconBtnStyle()}
        >
          {busy === "url" ? <Loader2 size={14} className="spin" /> : <LinkIcon size={14} />}
        </button>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        role="region"
        aria-label="Drop images to ingest"
        style={{
          padding: 14,
          border: "1px dashed rgba(255,255,255,0.15)",
          borderRadius: 10,
          textAlign: "center",
          cursor: busy ? "not-allowed" : "pointer",
          background: "rgba(255,255,255,0.02)",
          color: "rgba(255,255,255,0.55)",
          fontSize: 12,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
        onClick={() => !busy && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        {busy === "images" ? (
          <span>
            <Loader2 size={14} className="spin" style={{ verticalAlign: "middle", marginRight: 6 }} />
            analyzing…
          </span>
        ) : (
          <span>
            <Upload size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Drop screenshots or click to pick
          </span>
        )}
      </div>

      {references.length >= 2 && (
        <button
          type="button"
          onClick={compare}
          disabled={busy !== null}
          style={{
            ...iconBtnStyle({ wide: true }),
            justifyContent: "center",
          }}
        >
          {busy === "compare" ? (
            <Loader2 size={14} className="spin" style={{ verticalAlign: "middle", marginRight: 6 }} />
          ) : (
            <GitCompare size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          )}
          Compare {references.length} references
        </button>
      )}

      {comparing && (
        <div
          role="region"
          aria-label="Comparison result"
          style={{
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            color: "rgba(255,255,255,0.75)",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: 12,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          <CompareSection title="Intersection (table-stakes)" items={comparing.intersection} />
          <CompareSection title="Union (full set)" items={comparing.union} />
          <CompareSection title="Gap (opportunity)" items={comparing.gap} />
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {references.length === 0 ? (
          <div
            role="note"
            style={{
              padding: 20,
              textAlign: "center",
              color: "rgba(255,255,255,0.45)",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              fontSize: 13,
            }}
          >
            Drop a URL or image to start.
          </div>
        ) : (
          references.map((inv, i) => (
            <ReferenceCard
              key={i}
              inventory={inv}
              expanded={expanded === i}
              onToggle={() => setExpanded(expanded === i ? null : i)}
              onDelete={() => deleteRef(i)}
            />
          ))
        )}
      </div>

      {toast && (
        <div
          role="alert"
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            right: 20,
            padding: "8px 12px",
            background: "rgba(180,40,40,0.92)",
            color: "#fff",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          {toast}
        </div>
      )}
    </section>
  );
}

function CompareSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.5)",
        marginBottom: 4,
      }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}

function ReferenceCard({
  inventory,
  expanded,
  onToggle,
  onDelete,
}: {
  inventory: FeatureInventory;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", gap: 8 }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            background: "transparent",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <div style={{
            fontSize: 13,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            color: "rgba(255,255,255,0.85)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {inventory.summary}
          </div>
          <div style={{
            fontSize: 10,
            fontFamily: "ui-monospace, monospace",
            color: "rgba(255,255,255,0.45)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginTop: 2,
          }}>
            {inventory.features.length} features · {inventory.userFlows.length} flows
          </div>
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete reference"
          style={iconBtnStyle()}
        >
          <X size={14} />
        </button>
      </div>
      {expanded && (
        <div style={{
          padding: "10px 12px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          fontSize: 12,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          color: "rgba(255,255,255,0.75)",
          maxHeight: 300,
          overflowY: "auto",
        }}>
          <Section label="Features">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {inventory.features.map((f, i) => (
                <li key={i}>
                  <strong>{f.name}</strong> ({f.priority}): {f.description}
                </li>
              ))}
            </ul>
          </Section>
          <Section label="User flows">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {inventory.userFlows.map((f, i) => (
                <li key={i}>
                  <strong>{f.name}</strong>: {f.steps.join(" → ")}
                </li>
              ))}
            </ul>
          </Section>
          <Section label="Design language">
            {inventory.designLanguage.vibe} · {inventory.designLanguage.typography} · palette: {inventory.designLanguage.palette.join(", ")}
          </Section>
          {inventory.copyExamples.length > 0 && (
            <Section label="Copy examples">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {inventory.copyExamples.slice(0, 6).map((c, i) => (
                  <li key={i}>“{c}”</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.45)",
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function iconBtnStyle(opts: { wide?: boolean } = {}): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: opts.wide ? "8px 14px" : 8,
    width: opts.wide ? undefined : 32,
    height: 32,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    color: "rgba(255,255,255,0.8)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  };
}
