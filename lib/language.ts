/**
 * Prism language detection + locale utilities.
 *
 * Pairs with `lib/i18n.ts` — this module is import-safe on the server
 * (no React, no DOM types beyond typeof-guards) so `app/page.tsx` or
 * any server component can call `detectLanguage()` without SSR hazards.
 */

import { SUPPORTED_LANGS, type SupportedLang } from "./i18n";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Best-effort language pick:
 *   - Client: first supported entry from `navigator.languages`, then
 *     `navigator.language`, normalized to the 2-letter primary tag.
 *   - Server / unknown: `"en"`.
 *
 * Anything outside the P4 safelist collapses to `"en"` so we never
 * surface an untranslated locale. Callers get a concrete
 * `SupportedLang` — no `string | undefined` to handle.
 */
export function detectLanguage(): SupportedLang {
  if (typeof navigator === "undefined") return "en";

  const candidates: string[] = [];
  const nav = navigator as Navigator & { languages?: readonly string[] };

  if (Array.isArray(nav.languages)) {
    for (const l of nav.languages) {
      if (typeof l === "string" && l.length > 0) candidates.push(l);
    }
  }
  if (typeof nav.language === "string" && nav.language.length > 0) {
    candidates.push(nav.language);
  }

  for (const raw of candidates) {
    const primary = raw.toLowerCase().split(/[-_]/)[0];
    if ((SUPPORTED_LANGS as readonly string[]).includes(primary)) {
      return primary as SupportedLang;
    }
  }
  return "en";
}

// ---------------------------------------------------------------------------
// Directionality
// ---------------------------------------------------------------------------

const RTL_LANGS = new Set(["ar", "he", "fa", "ur"]);

/**
 * `true` for right-to-left scripts. Accepts full BCP-47 tags
 * (e.g. `"ar-SA"`) and normalizes to the 2-letter primary subtag.
 */
export function isRTL(lang: string): boolean {
  if (typeof lang !== "string" || lang.length === 0) return false;
  const primary = lang.toLowerCase().split(/[-_]/)[0];
  return RTL_LANGS.has(primary);
}

// ---------------------------------------------------------------------------
// Web Speech API locale mapping
// ---------------------------------------------------------------------------

/**
 * Map a 2-letter primary language code to a BCP-47 locale suitable
 * for `SpeechRecognition.lang` / `SpeechSynthesisUtterance.lang`.
 *
 * Choices target the most widely available voices per language:
 *   - `zh` → `zh-CN` (Mandarin, Simplified)
 *   - `ar` → `ar-SA` (Modern Standard Arabic)
 *   - `bn` → `bn-BD` (Bangladesh)
 *   - `ht` → `ht-HT` (Haiti)
 *   - `es` → `es-ES`, `fr` → `fr-FR`, `ru` → `ru-RU`, `en` → `en-US`
 *
 * Unknown codes fall back to `en-US` so downstream consumers always
 * get a valid tag. Full BCP-47 inputs (e.g. `"pt-BR"`) are reduced
 * to their primary tag before lookup.
 */
export function speechLangCode(lang: string): string {
  const primary =
    typeof lang === "string" && lang.length > 0
      ? lang.toLowerCase().split(/[-_]/)[0]
      : "en";

  switch (primary) {
    case "en":
      return "en-US";
    case "es":
      return "es-ES";
    case "ht":
      return "ht-HT";
    case "zh":
      return "zh-CN";
    case "ar":
      return "ar-SA";
    case "bn":
      return "bn-BD";
    case "fr":
      return "fr-FR";
    case "ru":
      return "ru-RU";
    default:
      return "en-US";
  }
}
