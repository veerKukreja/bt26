import type { FileMap } from "./types";

export const DEFAULT_APP: FileMap = {
  "/App.tsx": `import { useEffect, useState } from "react";

export default function App() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), 50);
    return () => clearInterval(id);
  }, []);
  const s = 1 + Math.sin(t / 10) * 0.15;
  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#fafafa", color: "#111",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: "#111", transform: \`scale(\${s})\`,
        boxShadow: "0 0 40px rgba(0,0,0,0.1)",
      }} />
    </div>
  );
}
`,
  "/index.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const el = document.getElementById("root")!;
createRoot(el).render(<App />);
`,
  "/public/index.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Prism</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0"><div id="root"></div></body>
</html>
`,
  "/package.json": JSON.stringify(
    {
      name: "prism-app",
      main: "/index.tsx",
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
    },
    null,
    2,
  ),
};
