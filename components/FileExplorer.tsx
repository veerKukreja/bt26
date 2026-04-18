"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Save, RotateCcw, FileText, Folder, FolderOpen, GripHorizontal } from "lucide-react";
import type { FileMap } from "@/lib/types";

interface Props {
  files: FileMap;
  open: boolean;
  onClose: () => void;
  onSave: (next: FileMap) => void;
}

const PANEL_W = 560;
const PANEL_H = 520;
const POS_STORAGE_KEY = "prism:fileexplorer:pos";

interface Pos { x: number; y: number }

function loadPos(): Pos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x !== "number" || typeof p?.y !== "number") return null;
    return p;
  } catch { return null; }
}

function savePos(p: Pos) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

function clampPos(p: Pos, w: number, h: number): Pos {
  if (typeof window === "undefined") return p;
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return {
    x: Math.min(Math.max(8, p.x), maxX),
    y: Math.min(Math.max(8, p.y), maxY),
  };
}

function defaultPos(w: number): Pos {
  if (typeof window === "undefined") return { x: 16, y: 64 };
  return { x: Math.max(8, window.innerWidth - w - 16), y: 64 };
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: FileMap): TreeNode {
  const root: TreeNode = { name: "/", path: "/", isDir: true, children: [] };
  const sortedPaths = Object.keys(files).sort();
  for (const fullPath of sortedPaths) {
    const parts = fullPath.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLeaf = i === parts.length - 1;
      const subPath = "/" + parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === name);
      if (!child) {
        child = {
          name,
          path: subPath,
          isDir: !isLeaf,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }
  // Sort: directories first, then files, alpha within each
  const sortTree = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortTree);
  };
  sortTree(root);
  return root;
}

export function FileExplorer({ files, open, onClose, onSave }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["/"]));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [pos, setPos] = useState<Pos>(() => {
    const stored = typeof window !== "undefined" ? loadPos() : null;
    return clampPos(stored ?? defaultPos(PANEL_W), PANEL_W, PANEL_H);
  });
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPos((p) => clampPos(p, PANEL_W, PANEL_H));
    const onResize = () => setPos((p) => clampPos(p, PANEL_W, PANEL_H));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!dragStart.current) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const d = dragStart.current;
      const next = clampPos({ x: d.px + (e.clientX - d.mx), y: d.py + (e.clientY - d.my) }, PANEL_W, PANEL_H);
      setPos(next);
    };
    const onUp = () => {
      if (dragStart.current) savePos(pos);
      dragStart.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pos]);

  const startDrag = (e: React.MouseEvent) => {
    // Ignore drags that start on buttons in the header.
    if ((e.target as HTMLElement).closest("button")) return;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    document.body.style.userSelect = "none";
    e.preventDefault();
  };

  const tree = useMemo(() => buildTree(files), [files]);

  useEffect(() => {
    if (!open) return;
    // Auto-select first file if none selected yet.
    if (!selectedPath || !(selectedPath in files)) {
      const firstFile = Object.keys(files).sort()[0] ?? null;
      setSelectedPath(firstFile);
      if (firstFile) setEditingValue(files[firstFile]);
    } else {
      setEditingValue(files[selectedPath]);
    }
  }, [open, files, selectedPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selectFile = (path: string) => {
    setSelectedPath(path);
    setEditingValue(files[path] ?? "");
    setTimeout(() => textareaRef.current?.focus(), 30);
  };

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const isDirty = selectedPath ? editingValue !== (files[selectedPath] ?? "") : false;

  const save = () => {
    if (!selectedPath || !isDirty) return;
    onSave({ ...files, [selectedPath]: editingValue });
  };

  const revert = () => {
    if (!selectedPath) return;
    setEditingValue(files[selectedPath] ?? "");
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.path === "/" && depth === 0) {
      return (
        <div key="/">
          {node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    const indent = depth * 12;
    if (node.isDir) {
      const isOpen = expandedDirs.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            onClick={() => toggleDir(node.path)}
            style={{
              ...rowStyle(false),
              paddingLeft: indent + 8,
            }}
          >
            {isOpen ? <FolderOpen size={12} /> : <Folder size={12} />}
            <span>{node.name}</span>
          </button>
          {isOpen && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    const active = selectedPath === node.path;
    return (
      <button
        key={node.path}
        type="button"
        onClick={() => selectFile(node.path)}
        style={{
          ...rowStyle(active),
          paddingLeft: indent + 8,
        }}
        title={node.path}
      >
        <FileText size={12} />
        <span style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {node.name}
        </span>
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Project files"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: PANEL_W,
        height: PANEL_H,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 16px)",
        zIndex: 45,
        display: "flex",
        flexDirection: "column",
        background: "rgba(18,18,22,0.92)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 14,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        overflow: "hidden",
        color: "#fff",
        animation: "prism-fe-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
    >
      <header
        onMouseDown={startDrag}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.7)",
          cursor: dragStart.current ? "grabbing" : "grab",
          userSelect: "none",
        }}
        title="Drag to reposition"
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <GripHorizontal size={12} style={{ opacity: 0.45 }} />
          Files · {Object.keys(files).length}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {isDirty && (
            <>
              <button type="button" onClick={revert} style={hdrBtn()} title="Revert changes">
                <RotateCcw size={13} />
                Revert
              </button>
              <button type="button" onClick={save} style={hdrBtn(true)} title="Save (creates a new version)">
                <Save size={13} />
                Save
              </button>
            </>
          )}
          <button type="button" onClick={onClose} style={hdrBtn()} aria-label="Close" title="Close">
            <X size={13} />
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          aria-label="File tree"
          style={{
            width: 180,
            minWidth: 140,
            overflowY: "auto",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            padding: "6px 0",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
          }}
        >
          {renderNode(tree, 0)}
        </aside>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              padding: "6px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              color: isDirty ? "#f7b955" : "rgba(255,255,255,0.55)",
            }}
          >
            {selectedPath ? (isDirty ? `${selectedPath} · modified` : selectedPath) : "(no file selected)"}
          </div>
          <textarea
            ref={textareaRef}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            spellCheck={false}
            disabled={!selectedPath}
            style={{
              flex: 1,
              background: "rgba(0,0,0,0.25)",
              color: "rgba(255,255,255,0.92)",
              border: "none",
              outline: "none",
              padding: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              lineHeight: 1.55,
              resize: "none",
              tabSize: 2,
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                save();
              }
              if (e.key === "Tab" && !e.shiftKey && textareaRef.current) {
                e.preventDefault();
                const ta = textareaRef.current;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const before = editingValue.slice(0, start);
                const after = editingValue.slice(end);
                const next = before + "  " + after;
                setEditingValue(next);
                requestAnimationFrame(() => {
                  ta.selectionStart = ta.selectionEnd = start + 2;
                });
              }
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes prism-fe-in {
          from { opacity: 0; transform: translate3d(12px, 0, 0) scale(0.98); }
          to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "4px 8px",
    background: active ? "rgba(100,200,255,0.14)" : "transparent",
    border: "none",
    color: active ? "#fff" : "rgba(255,255,255,0.72)",
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    textAlign: "left",
    cursor: "pointer",
    transition: "background 90ms ease",
  };
}

function hdrBtn(primary?: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 9px",
    background: primary ? "rgba(100,200,255,0.18)" : "transparent",
    border: `1px solid ${primary ? "rgba(100,200,255,0.35)" : "rgba(255,255,255,0.1)"}`,
    color: primary ? "#64c8ff" : "rgba(255,255,255,0.72)",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "ui-monospace, monospace",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
}
