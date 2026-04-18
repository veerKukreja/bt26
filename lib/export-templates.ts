export const VITE_PACKAGE_JSON = `{
  "name": "prism-export",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5",
    "vite": "^5.4.0"
  }
}
`;

export const VITE_CONFIG_TS = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`;

export const VITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Prism Export</title>
  </head>
  <body style="margin:0;background:#0a0a0a">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

export const VITE_TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
`;

export const VITE_MAIN_TSX = `import "./index";\n`;

export const STANDALONE_HTML_TPL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{TITLE}}</title>
    <link rel="icon" href="{{FAVICON}}" />
  </head>
  <body style="margin:0;background:#0a0a0a">
    <div id="root"></div>
    <script>
{{BUNDLE_JS}}
    </script>
  </body>
</html>
`;

export function emojiFaviconDataUri(ch: string): string {
  return "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><text y='50' font-size='52'>${ch}</text></svg>`,
    );
}

export const DEFAULT_FAVICON_DATA_URI = emojiFaviconDataUri("◆");
