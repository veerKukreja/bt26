import { requestHtmlBundle } from "./export";
import type { FileMap } from "./types";

/**
 * Build the print-optimized <style> tag. Injected into the standalone HTML
 * from /api/export/html so we don't need a parallel print renderer.
 */
function buildPrintStyle(paperSize: "letter" | "a4"): string {
  const size = paperSize === "a4" ? "a4" : "letter";
  return `<style data-prism-print="1">
@page { size: ${size}; margin: 0.5in; }
@media print {
  /* Hide interactive/navigation elements - the generated page may contain buttons, inputs */
  button, input, nav, .no-print { display: none !important; }
  body { font-size: 12pt; line-height: 1.5; color: black; background: white; }
  img { max-width: 100% !important; page-break-inside: avoid; }
  h1, h2, h3, h4, h5 { page-break-after: avoid; }
  p, li, blockquote { break-inside: avoid; }
  /* contact info shouldn't clip across page breaks */
  address, tel, .contact { page-break-inside: avoid; }
}
</style>`;
}

/**
 * Inject the print stylesheet into an HTML document string. Prefers inserting
 * just before </head>; falls back to prepending so the style still applies.
 */
export function injectPrintStyle(
  html: string,
  paperSize: "letter" | "a4" = "letter",
): string {
  const style = buildPrintStyle(paperSize);
  const headClose = /<\/head>/i;
  if (headClose.test(html)) {
    return html.replace(headClose, `${style}</head>`);
  }
  return style + html;
}

/**
 * Run the current VFS through /api/export/html and open the print dialog
 * in a hidden iframe. The iframe is removed after the dialog closes; modern
 * browsers block on window.print(), so the cleanup timeout fires once the
 * user dismisses (or confirms) the dialog.
 */
export async function printCurrentSession(
  vfs: FileMap,
  options?: { paperSize?: "letter" | "a4" },
): Promise<void> {
  const paperSize = options?.paperSize ?? "letter";

  const blob = await requestHtmlBundle(vfs, "Prism print");
  const rawHtml = await blob.text();
  const html = injectPrintStyle(rawHtml, paperSize);

  if (typeof document === "undefined") {
    throw new Error("printCurrentSession requires a DOM");
  }

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    throw new Error("printCurrentSession: iframe contentDocument unavailable");
  }

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    try {
      win.focus();
      win.print();
    } finally {
      // Modern browsers block on window.print() until the user dismisses
      // the dialog, so this timeout effectively fires post-dialog.
      setTimeout(() => iframe.remove(), 1000);
    }
  };

  // Fire on load when possible; fall back to a 100ms timer for browsers
  // where the load event doesn't fire for document.write'd content.
  let fired = false;
  const fireOnce = () => {
    if (fired) return;
    fired = true;
    triggerPrint();
  };
  iframe.addEventListener("load", fireOnce);
  setTimeout(fireOnce, 100);

  doc.open();
  doc.write(html);
  doc.close();
}
