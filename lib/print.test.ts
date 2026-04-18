import { test } from "node:test";
import assert from "node:assert/strict";
import { injectPrintStyle, printCurrentSession } from "./print";
import type { FileMap } from "./types";

// ---------------------------------------------------------------------------
// Pure helpers (no DOM needed)
// ---------------------------------------------------------------------------

test("injectPrintStyle inserts letter @page rule by default", () => {
  const out = injectPrintStyle("<html><head><title>x</title></head><body>hi</body></html>");
  assert.ok(/@page\s*\{\s*size:\s*letter;/.test(out), "letter @page rule present");
  assert.ok(out.includes("</head>"), "</head> preserved");
  assert.ok(out.indexOf("<style") < out.indexOf("</head>"), "<style> injected before </head>");
});

test("injectPrintStyle inserts a4 @page rule when paperSize is 'a4'", () => {
  const out = injectPrintStyle("<html><head></head><body></body></html>", "a4");
  assert.ok(/@page\s*\{\s*size:\s*a4;/.test(out), "a4 @page rule present");
  assert.ok(!/size:\s*letter;/.test(out), "no leftover letter rule");
});

test("injectPrintStyle hides interactive selectors under @media print", () => {
  const out = injectPrintStyle("<html><head></head><body></body></html>");
  assert.ok(out.includes("@media print"));
  assert.ok(/button\s*,\s*input\s*,\s*nav\s*,\s*\.no-print/.test(out));
  assert.ok(out.includes("display: none !important"));
});

test("injectPrintStyle falls back to prepend when </head> missing", () => {
  const out = injectPrintStyle("<body>no head here</body>");
  assert.ok(out.startsWith("<style"), "style prepended");
  assert.ok(out.includes("@page"), "rules still present");
});

// ---------------------------------------------------------------------------
// printCurrentSession — exercised with a minimal DOM shim + stubbed fetch.
// Verifies the function completes without throwing and feeds the standalone
// HTML (with print CSS injected) into a hidden iframe.
// ---------------------------------------------------------------------------

type StubEl = {
  tagName: string;
  style: Record<string, string>;
  children: StubEl[];
  listeners: Record<string, Array<() => void>>;
  contentDocument: { open: () => void; write: (s: string) => void; close: () => void } | null;
  contentWindow: { focus: () => void; print: () => void } | null;
  written: string;
  printed: boolean;
  removed: boolean;
  addEventListener: (ev: string, fn: () => void) => void;
  remove: () => void;
};

function installDomShim(): {
  restore: () => void;
  iframes: StubEl[];
} {
  const iframes: StubEl[] = [];
  const originalDocument = (globalThis as { document?: unknown }).document;

  const makeIframe = (): StubEl => {
    const el: StubEl = {
      tagName: "iframe",
      style: {},
      children: [],
      listeners: {},
      contentDocument: null,
      contentWindow: null,
      written: "",
      printed: false,
      removed: false,
      addEventListener(ev, fn) {
        (this.listeners[ev] ||= []).push(fn);
      },
      remove() {
        this.removed = true;
      },
    };
    el.contentWindow = {
      focus() {
        /* noop */
      },
      print() {
        el.printed = true;
      },
    };
    el.contentDocument = {
      open() {
        /* noop */
      },
      write(s: string) {
        el.written += s;
      },
      close() {
        // Fire load listeners after close, mimicking browser behavior.
        for (const fn of el.listeners["load"] || []) fn();
      },
    };
    iframes.push(el);
    return el;
  };

  const fakeBody: { appendChild: (el: StubEl) => StubEl } = {
    appendChild(el) {
      return el;
    },
  };

  const fakeDocument = {
    createElement(tag: string) {
      if (tag === "iframe") return makeIframe();
      throw new Error(`unexpected createElement(${tag}) in test`);
    },
    body: fakeBody,
  };

  Object.defineProperty(globalThis, "document", {
    value: fakeDocument,
    configurable: true,
    writable: true,
  });

  return {
    iframes,
    restore() {
      if (originalDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        Object.defineProperty(globalThis, "document", {
          value: originalDocument,
          configurable: true,
          writable: true,
        });
      }
    },
  };
}

function stubFetch(body: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      async text() {
        return body;
      },
      async blob() {
        return {
          async text() {
            return body;
          },
        } as unknown as Blob;
      },
    } as unknown as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("printCurrentSession returns a Promise and completes with stub VFS (letter)", async () => {
  const dom = installDomShim();
  const restoreFetch = stubFetch("<html><head><title>t</title></head><body><h1>Hi</h1></body></html>");
  try {
    const vfs: FileMap = {
      "/App.tsx": "export default () => null;",
      "/package.json": JSON.stringify({ dependencies: { react: "19.2.4" } }),
    };
    const ret = printCurrentSession(vfs);
    assert.ok(ret instanceof Promise, "returns a Promise");
    await ret;

    assert.equal(dom.iframes.length, 1, "one iframe created");
    const f = dom.iframes[0];
    assert.equal(f.style.position, "fixed");
    assert.equal(f.style.left, "-10000px");
    assert.equal(f.style.width, "0");
    assert.equal(f.style.height, "0");
    assert.equal(f.style.border, "0");
    assert.ok(f.written.includes("<h1>Hi</h1>"), "body HTML written");
    assert.ok(/@page\s*\{\s*size:\s*letter;/.test(f.written), "letter @page rule injected");
    assert.equal(f.printed, true, "window.print() called");
  } finally {
    restoreFetch();
    dom.restore();
  }
});

test("printCurrentSession injects a4 @page rule when paperSize='a4'", async () => {
  const dom = installDomShim();
  const restoreFetch = stubFetch("<html><head></head><body>x</body></html>");
  try {
    const vfs: FileMap = { "/App.tsx": "" };
    await printCurrentSession(vfs, { paperSize: "a4" });
    assert.equal(dom.iframes.length, 1);
    const f = dom.iframes[0];
    assert.ok(/@page\s*\{\s*size:\s*a4;/.test(f.written), "a4 @page rule injected");
    assert.ok(!/size:\s*letter;/.test(f.written), "no leftover letter rule");
  } finally {
    restoreFetch();
    dom.restore();
  }
});

test("printCurrentSession propagates fetch failures", async () => {
  const dom = installDomShim();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 500,
    async text() {
      return "boom";
    },
  } as unknown as Response)) as typeof fetch;
  try {
    await assert.rejects(() => printCurrentSession({ "/App.tsx": "" }), /HTML export failed/);
  } finally {
    globalThis.fetch = original;
    dom.restore();
  }
});
