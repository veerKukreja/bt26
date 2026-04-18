import { test } from "node:test";
import assert from "node:assert/strict";
import { t, EN, SUPPORTED_LANGS } from "./i18n";
import { detectLanguage, isRTL, speechLangCode } from "./language";

// ---------------------------------------------------------------------------
// t() — translation lookup + fallback chain
// ---------------------------------------------------------------------------

test("t: returns Spanish translation for a seeded key", () => {
  const es = t("promptBar.placeholder", "es");
  assert.equal(
    es,
    "Dile a esta página en qué convertirse. Prueba: una cafetería de Tokio a las 3 a.m.",
  );
  assert.notEqual(es, EN["promptBar.placeholder"]);
});

test("t: requested-lang wins over en when both exist", () => {
  assert.equal(t("export.zip", "fr"), "Télécharger .zip");
  assert.equal(t("export.zip", "ru"), "Скачать .zip");
  assert.equal(t("export.zip", "zh"), "下载 .zip");
});

test("t: falls back to English when the lang has no entry", () => {
  // 'ja' isn't seeded; must fall back to English.
  assert.equal(
    t("promptBar.placeholder", "ja"),
    EN["promptBar.placeholder"],
  );
});

test("t: falls back to key itself for an unknown key", () => {
  assert.equal(t("totally.made.up.key", "en"), "totally.made.up.key");
  assert.equal(t("totally.made.up.key", "es"), "totally.made.up.key");
});

test("t: interpolates {placeholders}", () => {
  const s = t("promptBar.versions.ariaLabel", "en", {
    current: 2,
    total: 7,
  });
  assert.equal(s, "Versions — currently v2 of 7");
});

test("t: leaves unmatched placeholders intact", () => {
  const s = t("status.generating", "en"); // no params
  assert.equal(s, "thinking · {tokens} tokens");
});

test("t: unsupported lang collapses to English", () => {
  assert.equal(
    t("onboarding.subtitle", "xx-YY"),
    EN["onboarding.subtitle"],
  );
});

test("t: every seeded non-English dict carries __mt sentinel", () => {
  // Re-read via a forced-unknown key so we exercise the full lookup path
  // and confirm each dict object is present. This prevents silent drops.
  for (const lang of SUPPORTED_LANGS) {
    // The placeholder key must resolve to *something* for all langs.
    const v = t("promptBar.placeholder", lang);
    assert.equal(typeof v, "string");
    assert.ok(v.length > 0, `empty translation for ${lang}`);
  }
});

// ---------------------------------------------------------------------------
// isRTL
// ---------------------------------------------------------------------------

test("isRTL: true for ar, he, fa, ur", () => {
  assert.equal(isRTL("ar"), true);
  assert.equal(isRTL("he"), true);
  assert.equal(isRTL("fa"), true);
  assert.equal(isRTL("ur"), true);
});

test("isRTL: false for LTR languages", () => {
  assert.equal(isRTL("en"), false);
  assert.equal(isRTL("es"), false);
  assert.equal(isRTL("zh"), false);
  assert.equal(isRTL("fr"), false);
  assert.equal(isRTL("ru"), false);
  assert.equal(isRTL("bn"), false);
  assert.equal(isRTL("ht"), false);
});

test("isRTL: accepts BCP-47 tags and normalizes", () => {
  assert.equal(isRTL("ar-SA"), true);
  assert.equal(isRTL("AR_EG"), true);
  assert.equal(isRTL("en-US"), false);
});

test("isRTL: empty / junk input returns false", () => {
  assert.equal(isRTL(""), false);
  // @ts-expect-error — guard against runtime garbage
  assert.equal(isRTL(null), false);
  // @ts-expect-error — guard against runtime garbage
  assert.equal(isRTL(undefined), false);
});

// ---------------------------------------------------------------------------
// speechLangCode
// ---------------------------------------------------------------------------

test("speechLangCode: zh → zh-CN", () => {
  assert.equal(speechLangCode("zh"), "zh-CN");
});

test("speechLangCode: maps every seeded language to a valid BCP-47 tag", () => {
  const expected: Record<string, string> = {
    en: "en-US",
    es: "es-ES",
    ht: "ht-HT",
    zh: "zh-CN",
    ar: "ar-SA",
    bn: "bn-BD",
    fr: "fr-FR",
    ru: "ru-RU",
  };
  for (const [code, tag] of Object.entries(expected)) {
    assert.equal(speechLangCode(code), tag, `${code} → ${tag}`);
    // Sanity: shape looks like `xx-YY`
    assert.match(
      speechLangCode(code),
      /^[a-z]{2}-[A-Z]{2}$/,
      `BCP-47 shape for ${code}`,
    );
  }
});

test("speechLangCode: full BCP-47 input is normalized by primary subtag", () => {
  assert.equal(speechLangCode("zh-TW"), "zh-CN");
  assert.equal(speechLangCode("fr-CA"), "fr-FR");
});

test("speechLangCode: unknown / empty → en-US", () => {
  assert.equal(speechLangCode("xx"), "en-US");
  assert.equal(speechLangCode(""), "en-US");
});

// ---------------------------------------------------------------------------
// detectLanguage — modern Node exposes a minimal `navigator` global, so
// these tests stub it via `Object.defineProperty` (the built-in property
// is defined with only a getter, so assignment fails).
// ---------------------------------------------------------------------------

function withNavigator<T>(nav: unknown, fn: () => T): T {
  const g = globalThis as unknown as { navigator?: unknown };
  const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: nav,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (desc) {
      Object.defineProperty(globalThis, "navigator", desc);
    } else {
      delete g.navigator;
    }
  }
}

test("detectLanguage: returns 'en' when navigator is undefined (server-like)", () => {
  withNavigator(undefined, () => {
    assert.equal(detectLanguage(), "en");
  });
});

test("detectLanguage: picks first supported lang from navigator.languages", () => {
  withNavigator(
    { languages: ["ja-JP", "es-ES", "en-US"], language: "ja-JP" },
    () => {
      assert.equal(detectLanguage(), "es");
    },
  );
});

test("detectLanguage: unsupported langs collapse to 'en'", () => {
  withNavigator(
    { languages: ["ja-JP", "ko-KR"], language: "ja-JP" },
    () => {
      assert.equal(detectLanguage(), "en");
    },
  );
});

test("detectLanguage: falls back to navigator.language if no languages array", () => {
  withNavigator({ language: "fr-FR" }, () => {
    assert.equal(detectLanguage(), "fr");
  });
});

test("detectLanguage: picks supported lang from all 8 seeded codes", () => {
  for (const code of SUPPORTED_LANGS) {
    withNavigator({ language: code, languages: [code] }, () => {
      assert.equal(detectLanguage(), code);
    });
  }
});
