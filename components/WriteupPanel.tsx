"use client";

import { useRef, useState } from "react";
import { Loader2, RefreshCw, Copy, Check, FileText, GitBranch, Braces, ClipboardPaste, Trash2 } from "lucide-react";
import { streamBrainstorm } from "@/lib/brainstorm-client";
import { copyToClipboard } from "@/lib/export";
import { writeupToMarkdown, writeupToGithubIssue } from "@/lib/writeup-export";
import { ProjectStructureView } from "./ProjectStructure";
import type { FeatureInventory, WriteUp } from "@/lib/types";

export interface WriteupPanelProps {
  writeup: WriteUp | null;
  onChange: (next: WriteUp | null) => void;
  references?: FeatureInventory[];
}

const SECTION_KEYS: Array<{ key: keyof WriteUp; label: string }> = [
  { key: "title", label: "Title" },
  { key: "problem", label: "Problem" },
  { key: "users", label: "Users" },
  { key: "valueProp", label: "Value proposition" },
  { key: "features", label: "Features" },
  { key: "pages", label: "Pages" },
  { key: "projectStructure", label: "Project structure" },
  { key: "copyDirection", label: "Copy direction" },
  { key: "visualDirection", label: "Visual direction" },
  { key: "risks", label: "Risks" },
];

export function WriteupPanel({ writeup, onChange, references }: WriteupPanelProps) {
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState<null | "full" | string>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<"md" | "gh" | "json" | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const runFull = () => {
    if (!intent.trim() || busy) return;
    abortRef.current = new AbortController();
    setBusy("full");
    void streamBrainstorm(
      {
        intent: intent.trim(),
        references: (references ?? []) as unknown as [],
        mode: "full",
        signal: abortRef.current.signal,
      },
      {
        onDone: (w) => {
          onChange(w);
          setBusy(null);
        },
        onError: (m) => {
          showToast(`Brainstorm failed: ${m}`);
          setBusy(null);
        },
      },
    );
  };

  const regenSection = (key: keyof WriteUp) => {
    if (!writeup || busy) return;
    abortRef.current = new AbortController();
    setBusy(String(key));
    void streamBrainstorm(
      {
        intent: intent.trim() || writeup.title || "continue",
        references: (references ?? []) as unknown as [],
        mode: "section",
        sectionKey: String(key),
        previousWriteup: writeup,
        signal: abortRef.current.signal,
      },
      {
        onDone: (w) => {
          onChange(w);
          setBusy(null);
        },
        onError: (m) => {
          showToast(`Regenerate failed: ${m}`);
          setBusy(null);
        },
      },
    );
  };

  const setField = <K extends keyof WriteUp>(key: K, value: WriteUp[K]) => {
    if (!writeup) return;
    onChange({ ...writeup, [key]: value });
  };

  const copyAs = async (kind: "md" | "gh" | "json") => {
    if (!writeup) return;
    const text =
      kind === "md"
        ? writeupToMarkdown(writeup)
        : kind === "gh"
          ? writeupToGithubIssue(writeup)
          : JSON.stringify(writeup, null, 2);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } else {
      showToast("Couldn't copy — clipboard denied.");
    }
  };

  const regenerateAll = () => {
    if (!writeup || busy) return;
    abortRef.current = new AbortController();
    setBusy("full");
    void streamBrainstorm(
      {
        intent: intent.trim() || writeup.title || "regenerate",
        references: (references ?? []) as unknown as [],
        mode: "full",
        signal: abortRef.current.signal,
      },
      {
        onDone: (w) => {
          onChange(w);
          setBusy(null);
        },
        onError: (m) => {
          showToast(`Regenerate failed: ${m}`);
          setBusy(null);
        },
      },
    );
  };

  const clearAll = () => {
    if (busy) return;
    onChange(null);
    setIntent("");
  };

  const pasteJson = async () => {
    if (busy) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      showToast("Clipboard access denied. Copy a WriteUp JSON first, then click Paste.");
      return;
    }
    if (!text || !text.trim()) {
      showToast("Clipboard is empty.");
      return;
    }
    // Extract the first {...} block so users can paste from messy sources
    // (dev logs, code blocks with prose around them, etc.).
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const payload = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      showToast("Clipboard doesn't contain a WriteUp JSON. Use Copy JSON in another Prism first.");
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      showToast("Pasted content isn't a JSON object.");
      return;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.title !== "string") {
      showToast("JSON is missing a WriteUp 'title' field.");
      return;
    }
    onChange(obj as unknown as WriteUp);
    showToast("Pasted.");
  };

  return (
    <section
      aria-label="Writeup panel"
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
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
      }}>
        <span style={{
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          color: "rgba(255,255,255,0.6)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}>Writeup</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {writeup && (
            <>
              <button type="button" onClick={() => copyAs("md")} style={smallBtn()} title="Copy as Markdown">
                {copied === "md" ? <Check size={13} /> : <Copy size={13} />} MD
              </button>
              <button type="button" onClick={() => copyAs("gh")} style={smallBtn()} title="Copy as GitHub issue">
                {copied === "gh" ? <Check size={13} /> : <GitBranch size={13} />} Issue
              </button>
              <button type="button" onClick={() => copyAs("json")} style={smallBtn()} title="Copy schema as JSON (paste into another Prism)">
                {copied === "json" ? <Check size={13} /> : <Braces size={13} />} JSON
              </button>
              <button type="button" onClick={regenerateAll} style={smallBtn()} disabled={busy !== null} title="Regenerate the whole spec from your intent">
                {busy === "full" ? <Loader2 size={13} className="wu-spin" /> : <RefreshCw size={13} />} Regen all
              </button>
              <button type="button" onClick={clearAll} style={smallBtn({ danger: true })} disabled={busy !== null} title="Clear the brainstorm and start over">
                <Trash2 size={13} /> Clear
              </button>
            </>
          )}
          <button type="button" onClick={pasteJson} style={smallBtn()} disabled={busy !== null} title="Paste a WriteUp JSON from clipboard">
            <ClipboardPaste size={13} /> Paste
          </button>
        </div>
      </header>

      {!writeup ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Describe what you want to build. A sentence or a paragraph."
            disabled={busy !== null}
            rows={6}
            style={{
              width: "100%",
              resize: "vertical",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              color: "#fff",
              padding: 12,
              fontSize: 14,
              lineHeight: 1.5,
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
            }}
          />
          <button
            type="button"
            onClick={runFull}
            disabled={busy !== null || !intent.trim()}
            style={{
              alignSelf: "flex-start",
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: busy ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,#fff,#d8d8d8)",
              color: busy ? "rgba(255,255,255,0.6)" : "#000",
              fontSize: 13,
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {busy === "full" ? <Loader2 size={14} className="wu-spin" /> : <FileText size={14} />}
            Brainstorm
          </button>
          {busy === "full" && (
            <div style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.55)",
              fontFamily: "ui-monospace, monospace",
            }}>
              drafting your spec…
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <EditableRow
            label="Title"
            value={writeup.title}
            onSave={(v) => setField("title", v)}
            regen={() => regenSection("title")}
            busy={busy === "title"}
          />
          <EditableRow
            label="Problem"
            multiline
            value={writeup.problem}
            onSave={(v) => setField("problem", v)}
            regen={() => regenSection("problem")}
            busy={busy === "problem"}
          />
          <SectionBlock label="Users" regen={() => regenSection("users")} busy={busy === "users"}>
            {writeup.users.map((u, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <strong>{u.persona}</strong> — {u.jobToBeDone}
              </div>
            ))}
          </SectionBlock>
          <EditableRow
            label="Value proposition"
            multiline
            value={writeup.valueProp}
            onSave={(v) => setField("valueProp", v)}
            regen={() => regenSection("valueProp")}
            busy={busy === "valueProp"}
          />
          <SectionBlock label="Features" regen={() => regenSection("features")} busy={busy === "features"}>
            <FeatureColumn label="Must have" items={writeup.features.mustHave} />
            <FeatureColumn label="Should have" items={writeup.features.shouldHave} />
            <FeatureColumn label="Could have" items={writeup.features.couldHave} />
          </SectionBlock>
          <SectionBlock label="Pages" regen={() => regenSection("pages")} busy={busy === "pages"}>
            {writeup.pages.map((p, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <strong>{p.name}</strong>: {p.purpose}
                {p.keyElements.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {p.keyElements.map((e, j) => <li key={j}>{e}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </SectionBlock>
          {writeup.projectStructure && (
            <SectionBlock
              label="Project structure"
              regen={() => regenSection("projectStructure")}
              busy={busy === "projectStructure"}
            >
              <ProjectStructureView structure={writeup.projectStructure} />
            </SectionBlock>
          )}
          <EditableRow
            label="Copy direction"
            multiline
            value={writeup.copyDirection}
            onSave={(v) => setField("copyDirection", v)}
            regen={() => regenSection("copyDirection")}
            busy={busy === "copyDirection"}
          />
          <EditableRow
            label="Visual direction"
            multiline
            value={writeup.visualDirection}
            onSave={(v) => setField("visualDirection", v)}
            regen={() => regenSection("visualDirection")}
            busy={busy === "visualDirection"}
          />
          {writeup.risks.length > 0 && (
            <SectionBlock label="Risks" regen={() => regenSection("risks")} busy={busy === "risks"}>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {writeup.risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </SectionBlock>
          )}
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setIntent("");
            }}
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "rgba(255,255,255,0.55)",
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              cursor: "pointer",
            }}
          >
            Start over
          </button>
        </div>
      )}

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
          }}
        >
          {toast}
        </div>
      )}

      <style>{`@keyframes wu-spin{to{transform:rotate(360deg)}}.wu-spin{animation:wu-spin 0.9s linear infinite}@keyframes wu-shimmer{0%{opacity:0.4}50%{opacity:1}100%{opacity:0.4}}.wu-shimmer{animation:wu-shimmer 1.4s ease-in-out infinite}`}</style>
    </section>
  );
}

function SectionBlock({
  label,
  regen,
  busy,
  children,
}: {
  label: string;
  regen: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ opacity: busy ? 0.55 : 1 }} className={busy ? "wu-shimmer" : ""}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
        color: "rgba(255,255,255,0.5)", marginBottom: 6,
      }}>
        <span>{label}</span>
        <button type="button" onClick={regen} disabled={busy} style={regenStyle()} aria-label={`Regenerate ${label}`}>
          {busy ? <Loader2 size={12} className="wu-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      <div style={{
        fontSize: 13,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        color: "rgba(255,255,255,0.85)",
        lineHeight: 1.5,
      }}>
        {children}
      </div>
    </div>
  );
}

function EditableRow({
  label,
  value,
  multiline,
  onSave,
  regen,
  busy,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (v: string) => void;
  regen: () => void;
  busy: boolean;
}) {
  const [local, setLocal] = useState(value);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div style={{ opacity: busy ? 0.55 : 1 }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.5)", marginBottom: 6,
        }}>
          <span>{label}</span>
        </div>
        {multiline ? (
          <textarea
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
              onSave(local);
              setEditing(false);
            }}
            autoFocus
            rows={3}
            style={inputStyle(true)}
          />
        ) : (
          <input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
              onSave(local);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSave(local);
                setEditing(false);
              }
            }}
            autoFocus
            style={inputStyle(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ opacity: busy ? 0.55 : 1 }} className={busy ? "wu-shimmer" : ""}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
        color: "rgba(255,255,255,0.5)", marginBottom: 6,
      }}>
        <span>{label}</span>
        <button type="button" onClick={regen} disabled={busy} style={regenStyle()} aria-label={`Regenerate ${label}`}>
          {busy ? <Loader2 size={12} className="wu-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          setLocal(value);
          setEditing(true);
        }}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.85)",
          fontSize: label === "Title" ? 18 : 13,
          fontWeight: label === "Title" ? 600 : 400,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          lineHeight: 1.5,
          padding: 0,
          cursor: "text",
        }}
        aria-label={`Edit ${label}`}
      >
        {value || <span style={{ color: "rgba(255,255,255,0.4)" }}>(empty)</span>}
      </button>
    </div>
  );
}

function FeatureColumn({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
    </div>
  );
}

function regenStyle(): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 4,
    color: "rgba(255,255,255,0.6)",
    cursor: "pointer",
  };
}

function smallBtn(opts?: { danger?: boolean }): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    fontSize: 11,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    background: opts?.danger ? "rgba(180,40,40,0.12)" : "rgba(255,255,255,0.04)",
    border: `1px solid ${opts?.danger ? "rgba(180,40,40,0.35)" : "rgba(255,255,255,0.1)"}`,
    borderRadius: 8,
    color: opts?.danger ? "#ff8080" : "rgba(255,255,255,0.8)",
    cursor: "pointer",
  };
}

function inputStyle(multi: boolean): React.CSSProperties {
  return {
    width: "100%",
    resize: multi ? "vertical" : "none",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    color: "#fff",
    padding: 10,
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  };
}
