"use client";

import {
  SandpackProvider,
  SandpackPreview,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { useEffect, useRef } from "react";
import type { FileMap } from "@/lib/types";

interface PreviewProps {
  files: FileMap;
  versionKey: string;
  onError: (message: string) => void;
  onReady: () => void;
}

function ErrorBridge({
  onError,
  onReady,
}: {
  onError: (m: string) => void;
  onReady: () => void;
}) {
  const { sandpack } = useSandpack();
  const readyRef = useRef(false);
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const attach = () => {
      const ids = Object.keys(sandpack.clients);
      for (const id of ids) {
        const client = sandpack.clients[id];
        if (!client) continue;
        const u = client.listen((msg: { type: string; action?: string; payload?: unknown }) => {
          if (msg.type === "action" && msg.action === "show-error") {
            const payload = msg.payload as { message?: string; title?: string };
            onError(payload?.message ?? payload?.title ?? "Unknown error");
          } else if (msg.type === "done") {
            if (!readyRef.current) {
              readyRef.current = true;
              onReady();
            }
          }
        });
        unsubs.push(u);
      }
    };
    attach();
    const interval = setInterval(() => {
      if (unsubs.length === 0) attach();
    }, 200);
    return () => {
      clearInterval(interval);
      unsubs.forEach((u) => u());
    };
  }, [sandpack, onError, onReady]);
  return null;
}

export function Preview({ files, versionKey, onError, onReady }: PreviewProps) {
  const sandpackFiles: Record<string, { code: string }> = {};
  for (const [path, code] of Object.entries(files)) {
    sandpackFiles[path] = { code };
  }

  return (
    <SandpackProvider
      key={versionKey}
      template="react-ts"
      files={sandpackFiles}
      customSetup={{
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "framer-motion": "^12.0.0",
          "lucide-react": "^0.468.0",
        },
      }}
      options={{
        recompileMode: "immediate",
        classes: {
          "sp-wrapper": "prism-sp-wrapper",
          "sp-preview-container": "prism-sp-container",
          "sp-preview-iframe": "prism-sp-iframe",
        },
      }}
      style={{ height: "100%", width: "100%" } as React.CSSProperties}
    >
      <div style={{ position: "absolute", inset: 0 }}>
        <SandpackPreview
          showOpenInCodeSandbox={false}
          showRefreshButton={false}
          showRestartButton={false}
          showNavigator={false}
          showSandpackErrorOverlay={false}
          style={{ height: "100%", width: "100%", border: "none" }}
        />
        <ErrorBridge onError={onError} onReady={onReady} />
      </div>
    </SandpackProvider>
  );
}
