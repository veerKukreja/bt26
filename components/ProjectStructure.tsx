"use client";

import { useState } from "react";
import { ChevronRight, File, Folder, Route, Box } from "lucide-react";
import type { ProjectStructure, ProjectTreeNode } from "@/lib/types";

function iconFor(kind: ProjectTreeNode["kind"]) {
  const common = { size: 13, strokeWidth: 1.6 };
  switch (kind) {
    case "directory":
      return <Folder {...common} color="rgba(230, 200, 120, 0.9)" />;
    case "route":
      return <Route {...common} color="rgba(140, 200, 255, 0.9)" />;
    case "component":
      return <Box {...common} color="rgba(190, 150, 255, 0.9)" />;
    case "file":
    default:
      return <File {...common} color="rgba(255, 255, 255, 0.55)" />;
  }
}

function TreeNodeView({
  node,
  depth,
  defaultOpen,
}: {
  node: ProjectTreeNode;
  depth: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => (hasChildren ? setOpen((o) => !o) : undefined)}
        disabled={!hasChildren}
        aria-label={
          hasChildren
            ? `${open ? "Collapse" : "Expand"} ${node.name}`
            : node.name
        }
        aria-expanded={hasChildren ? open : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          textAlign: "left",
          padding: `3px 6px 3px ${6 + depth * 14}px`,
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.88)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12.5,
          cursor: hasChildren ? "pointer" : "default",
          borderRadius: 4,
          lineHeight: 1.5,
        }}
      >
        <ChevronRight
          size={12}
          strokeWidth={1.6}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 120ms ease",
            opacity: hasChildren ? 0.7 : 0,
            flexShrink: 0,
          }}
        />
        {iconFor(node.kind)}
        <span style={{ color: "#fff" }}>{node.name}</span>
        {node.purpose && (
          <span
            style={{
              color: "rgba(255,255,255,0.38)",
              fontStyle: "italic",
              fontSize: 11.5,
              marginLeft: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {node.purpose}
          </span>
        )}
      </button>
      {hasChildren && open && node.children!.map((child, i) => (
        <TreeNodeView
          key={`${node.name}-${child.name}-${i}`}
          node={child}
          depth={depth + 1}
          defaultOpen={depth < 1}
        />
      ))}
    </div>
  );
}

export interface ProjectStructureViewProps {
  structure: ProjectStructure;
}

export function ProjectStructureView({ structure }: ProjectStructureViewProps) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        padding: "8px 4px",
      }}
    >
      <div
        style={{
          padding: "0 10px 6px 10px",
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        Entry: <span style={{ color: "rgba(255,255,255,0.72)" }}>{structure.entryPoint}</span>
      </div>
      {structure.tree.map((node, i) => (
        <TreeNodeView
          key={`${node.name}-${i}`}
          node={node}
          depth={0}
          defaultOpen={true}
        />
      ))}
    </div>
  );
}
