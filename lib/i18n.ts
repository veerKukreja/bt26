"use client";

/**
 * Prism i18n
 * ----------
 * Tiny, dependency-free string dictionary + React provider for the 8
 * seed languages. Non-English dictionaries are machine-translated and
 * marked with a `__mt: true` sentinel so future human contributors can
 * find and supersede them.
 *
 * Usage (from P9 and downstream):
 *
 *   import { LanguageProvider, useT, t } from "@/lib/i18n";
 *
 *   // In a client tree root:
 *   <LanguageProvider initialLang={detectLanguage()}>...</LanguageProvider>
 *
 *   // In any client component:
 *   const t = useT();
 *   <button aria-label={t("promptBar.export")}>...</button>
 *
 *   // Or, without a provider:
 *   t("promptBar.placeholder", "es");
 *
 * Fallback order for a lookup:
 *   requested-lang → en → key-as-string
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Supported languages
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGS = [
  "en",
  "es",
  "ht",
  "zh",
  "ar",
  "bn",
  "fr",
  "ru",
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

// ---------------------------------------------------------------------------
// English source-of-truth dictionary.
// Keys follow `namespace.what.variant` so consumers can grep by surface.
// ---------------------------------------------------------------------------

export const EN = {
  // Onboarding hint (Prism.tsx)
  "onboarding.title": "Prism",
  "onboarding.subtitle": "tell this page what to become",

  // Fork seed snapshot (Prism.tsx → handleFork)
  "fork.seedPrompt": "Forked",
  "fork.seedSummary": "Forked",

  // Prompt input (PromptBar.tsx)
  "promptBar.placeholder":
    "Tell this page what to become. Try: a Tokyo coffee shop at 3am",
  "promptBar.placeholder.generating": "Generating…",

  // Pill / icon aria-labels & titles
  "promptBar.env.ariaLabel": "Environmental usage — click for methodology",
  "promptBar.versions.ariaLabel": "Versions — currently v{current} of {total}",
  "promptBar.export.ariaLabel": "Export",
  "promptBar.generate.ariaLabel": "Generate",

  // Fork button states
  "promptBar.fork.idle": "Fork to new URL",
  "promptBar.fork.forking": "Forking…",
  "promptBar.fork.copied": "Fork URL copied",
  "promptBar.fork.title.idle": "Fork to new URL",
  "promptBar.fork.title.forking": "forking…",
  "promptBar.fork.title.copied": "URL copied",

  // Env-usage methodology popover
  "env.dialog.ariaLabel": "Environmental usage methodology",
  "env.heading": "Session usage so far",
  "env.row.input": "input",
  "env.row.output": "output",
  "env.row.cacheRead": "cache-read",
  "env.row.cacheCreate": "cache-create",
  "env.tokens.suffix": "tokens",
  "env.formula.energy":
    "energy ≈ (input + output + cache-create + 0.1 × cache-read) × 0.3 Wh / 1k",
  "env.formula.water": "water ≈ effective tokens × 0.5 mL / 1k",
  "env.disclaimer":
    "Rough approximation from published inference estimates; not audited.",

  // Versions menu
  "versions.menu.ariaLabel": "Session versions",
  "versions.item.untitled": "Untitled",
  "versions.item.current": "current",

  // Per-version export buttons (tooltip titles)
  "versions.export.zip.title": "Download .zip",
  "versions.export.html.title": "Download .html",
  "versions.export.csb.title": "Copy CodeSandbox link",

  // Export dropdown
  "export.menu.ariaLabel": "Export current snapshot",
  "export.zip": "Download .zip",
  "export.html": "Download .html",
  "export.csb": "Copy CodeSandbox link",
  "export.csb.copied": "Copied!",

  // Toasts / error messages
  "toast.export.failed": "Export failed: {message}",
  "toast.csb.overflow": "Too large for CodeSandbox — downloaded .zip instead.",
  "toast.csb.copyFailed": "Couldn't copy — URL: {url}",

  // Status labels
  "status.generating": "thinking · {tokens} tokens",
  "status.fixing": "fixing · attempt {attempt}",
  "status.rolledback": "rolled back",
  "status.error": "error: {message}",

  // Relative-time (for version list)
  "time.secondsAgo": "{n}s ago",
  "time.minutesAgo": "{n}m ago",
  "time.hoursAgo": "{n}h ago",
} as const;

export type StringKey = keyof typeof EN;

// ---------------------------------------------------------------------------
// Non-English dictionaries (machine-translated seeds).
// Each carries `__mt: true` so humans can audit/replace them later.
// Any key missing here falls back to EN via `t()`.
// ---------------------------------------------------------------------------

type Dict = Partial<Record<StringKey, string>> & { __mt?: boolean };

const ES: Dict = {
  __mt: true,
  "onboarding.title": "Prism",
  "onboarding.subtitle": "dile a esta página en qué convertirse",
  "fork.seedPrompt": "Bifurcado",
  "fork.seedSummary": "Bifurcado",
  "promptBar.placeholder":
    "Dile a esta página en qué convertirse. Prueba: una cafetería de Tokio a las 3 a.m.",
  "promptBar.placeholder.generating": "Generando…",
  "promptBar.env.ariaLabel": "Uso ambiental — haz clic para la metodología",
  "promptBar.versions.ariaLabel": "Versiones — actualmente v{current} de {total}",
  "promptBar.export.ariaLabel": "Exportar",
  "promptBar.generate.ariaLabel": "Generar",
  "promptBar.fork.idle": "Bifurcar a nueva URL",
  "promptBar.fork.forking": "Bifurcando…",
  "promptBar.fork.copied": "URL de bifurcación copiada",
  "promptBar.fork.title.idle": "Bifurcar a nueva URL",
  "promptBar.fork.title.forking": "bifurcando…",
  "promptBar.fork.title.copied": "URL copiada",
  "env.dialog.ariaLabel": "Metodología de uso ambiental",
  "env.heading": "Uso de la sesión hasta ahora",
  "env.row.input": "entrada",
  "env.row.output": "salida",
  "env.row.cacheRead": "caché-lectura",
  "env.row.cacheCreate": "caché-creación",
  "env.tokens.suffix": "tokens",
  "env.formula.energy":
    "energía ≈ (entrada + salida + caché-creación + 0,1 × caché-lectura) × 0,3 Wh / 1k",
  "env.formula.water": "agua ≈ tokens efectivos × 0,5 mL / 1k",
  "env.disclaimer":
    "Aproximación aproximada a partir de estimaciones de inferencia publicadas; no auditada.",
  "versions.menu.ariaLabel": "Versiones de la sesión",
  "versions.item.untitled": "Sin título",
  "versions.item.current": "actual",
  "versions.export.zip.title": "Descargar .zip",
  "versions.export.html.title": "Descargar .html",
  "versions.export.csb.title": "Copiar enlace de CodeSandbox",
  "export.menu.ariaLabel": "Exportar snapshot actual",
  "export.zip": "Descargar .zip",
  "export.html": "Descargar .html",
  "export.csb": "Copiar enlace de CodeSandbox",
  "export.csb.copied": "¡Copiado!",
  "toast.export.failed": "La exportación falló: {message}",
  "toast.csb.overflow":
    "Demasiado grande para CodeSandbox — se descargó .zip en su lugar.",
  "toast.csb.copyFailed": "No se pudo copiar — URL: {url}",
  "status.generating": "pensando · {tokens} tokens",
  "status.fixing": "corrigiendo · intento {attempt}",
  "status.rolledback": "revertido",
  "status.error": "error: {message}",
  "time.secondsAgo": "hace {n}s",
  "time.minutesAgo": "hace {n}m",
  "time.hoursAgo": "hace {n}h",
};

const HT: Dict = {
  __mt: true,
  "onboarding.title": "Prism",
  "onboarding.subtitle": "di paj sa a sa pou l tounen",
  "fork.seedPrompt": "Separe",
  "fork.seedSummary": "Separe",
  "promptBar.placeholder":
    "Di paj sa a sa pou l tounen. Eseye: yon kafe Tokyo a 3 a.m.",
  "promptBar.placeholder.generating": "N ap jenere…",
  "promptBar.env.ariaLabel":
    "Itilizasyon anviwònman — klike pou metodoloji",
  "promptBar.versions.ariaLabel":
    "Vèsyon — kounye a v{current} sou {total}",
  "promptBar.export.ariaLabel": "Ekspòte",
  "promptBar.generate.ariaLabel": "Jenere",
  "promptBar.fork.idle": "Separe nan yon nouvo URL",
  "promptBar.fork.forking": "N ap separe…",
  "promptBar.fork.copied": "URL separe kopye",
  "promptBar.fork.title.idle": "Separe nan yon nouvo URL",
  "promptBar.fork.title.forking": "n ap separe…",
  "promptBar.fork.title.copied": "URL kopye",
  "env.dialog.ariaLabel": "Metodoloji itilizasyon anviwònman",
  "env.heading": "Itilizasyon sesyon an jiskaprezan",
  "env.row.input": "antre",
  "env.row.output": "soti",
  "env.row.cacheRead": "kach-li",
  "env.row.cacheCreate": "kach-kreye",
  "env.tokens.suffix": "tokens",
  "env.formula.energy":
    "enèji ≈ (antre + soti + kach-kreye + 0.1 × kach-li) × 0.3 Wh / 1k",
  "env.formula.water": "dlo ≈ tokens efektif × 0.5 mL / 1k",
  "env.disclaimer":
    "Apwoksimasyon apati estimasyon enferans ki pibliye; pa odite.",
  "versions.menu.ariaLabel": "Vèsyon sesyon",
  "versions.item.untitled": "San tit",
  "versions.item.current": "kounye a",
  "versions.export.zip.title": "Telechaje .zip",
  "versions.export.html.title": "Telechaje .html",
  "versions.export.csb.title": "Kopye lyen CodeSandbox",
  "export.menu.ariaLabel": "Ekspòte snapshot aktyèl la",
  "export.zip": "Telechaje .zip",
  "export.html": "Telechaje .html",
  "export.csb": "Kopye lyen CodeSandbox",
  "export.csb.copied": "Kopye!",
  "toast.export.failed": "Ekspòtasyon echwe: {message}",
  "toast.csb.overflow":
    "Twò gwo pou CodeSandbox — .zip telechaje olye sa.",
  "toast.csb.copyFailed": "Pa kapab kopye — URL: {url}",
  "status.generating": "n ap reflechi · {tokens} tokens",
  "status.fixing": "n ap ranje · tantativ {attempt}",
  "status.rolledback": "retounen",
  "status.error": "erè: {message}",
  "time.secondsAgo": "{n}s pase",
  "time.minutesAgo": "{n}m pase",
  "time.hoursAgo": "{n}h pase",
};

const ZH: Dict = {
  __mt: true,
  "onboarding.title": "Prism",
  "onboarding.subtitle": "告诉这个页面要变成什么",
  "fork.seedPrompt": "已分叉",
  "fork.seedSummary": "已分叉",
  "promptBar.placeholder":
    "告诉这个页面要变成什么。试试：凌晨 3 点的东京咖啡馆",
  "promptBar.placeholder.generating": "生成中…",
  "promptBar.env.ariaLabel": "环境用量 — 点击查看方法",
  "promptBar.versions.ariaLabel": "版本 — 当前第 {current} 个，共 {total} 个",
  "promptBar.export.ariaLabel": "导出",
  "promptBar.generate.ariaLabel": "生成",
  "promptBar.fork.idle": "分叉到新 URL",
  "promptBar.fork.forking": "分叉中…",
  "promptBar.fork.copied": "分叉 URL 已复制",
  "promptBar.fork.title.idle": "分叉到新 URL",
  "promptBar.fork.title.forking": "分叉中…",
  "promptBar.fork.title.copied": "URL 已复制",
  "env.dialog.ariaLabel": "环境用量方法论",
  "env.heading": "本次会话用量",
  "env.row.input": "输入",
  "env.row.output": "输出",
  "env.row.cacheRead": "缓存读取",
  "env.row.cacheCreate": "缓存创建",
  "env.tokens.suffix": "tokens",
  "env.formula.energy":
    "能耗 ≈ (输入 + 输出 + 缓存创建 + 0.1 × 缓存读取) × 0.3 Wh / 1k",
  "env.formula.water": "水 ≈ 有效 tokens × 0.5 mL / 1k",
  "env.disclaimer": "基于已发布推理估算的粗略近似；未经审计。",
  "versions.menu.ariaLabel": "会话版本",
  "versions.item.untitled": "无标题",
  "versions.item.current": "当前",
  "versions.export.zip.title": "下载 .zip",
  "versions.export.html.title": "下载 .html",
  "versions.export.csb.title": "复制 CodeSandbox 链接",
  "export.menu.ariaLabel": "导出当前快照",
  "export.zip": "下载 .zip",
  "export.html": "下载 .html",
  "export.csb": "复制 CodeSandbox 链接",
  "export.csb.copied": "已复制！",
  "toast.export.failed": "导出失败：{message}",
  "toast.csb.overflow": "对 CodeSandbox 来说太大 — 已改为下载 .zip。",
  "toast.csb.copyFailed": "无法复制 — URL：{url}",
  "status.generating": "思考中 · {tokens} tokens",
  "status.fixing": "修复中 · 第 {attempt} 次",
  "status.rolledback": "已回滚",
  "status.error": "错误：{message}",
  "time.secondsAgo": "{n} 秒前",
  "time.minutesAgo": "{n} 分钟前",
  "time.hoursAgo": "{n} 小时前",
};

const AR: Dict = {
  __mt: true,
  "onboarding.title": "Prism",
  "onboarding.subtitle": "أخبر هذه الصفحة بما ستصبح",
  "fork.seedPrompt": "تم التفريع",
  "fork.seedSummary": "تم التفريع",
  "promptBar.placeholder":
    "أخبر هذه الصفحة بما ستصبح. جرّب: مقهى في طوكيو الساعة 3 صباحًا",
  "promptBar.placeholder.generating": "جاري الإنشاء…",
  "promptBar.env.ariaLabel": "الاستخدام البيئي — انقر لعرض المنهجية",
  "promptBar.versions.ariaLabel":
    "الإصدارات — حاليًا v{current} من أصل {total}",
  "promptBar.export.ariaLabel": "تصدير",
  "promptBar.generate.ariaLabel": "إنشاء",
  "promptBar.fork.idle": "تفريع إلى عنوان جديد",
  "promptBar.fork.forking": "جاري التفريع…",
  "promptBar.fork.copied": "تم نسخ عنوان التفريع",
  "promptBar.fork.title.idle": "تفريع إلى عنوان جديد",
  "promptBar.fork.title.forking": "جاري التفريع…",
  "promptBar.fork.title.copied": "تم نسخ العنوان",
  "env.dialog.ariaLabel": "منهجية الاستخدام البيئي",
  "env.heading": "استخدام الجلسة حتى الآن",
  "env.row.input": "إدخال",
  "env.row.output": "إخراج",
  "env.row.cacheRead": "قراءة-ذاكرة",
  "env.row.cacheCreate": "إنشاء-ذاكرة",
  "env.tokens.suffix": "رموز",
  "env.formula.energy":
    "طاقة ≈ (إدخال + إخراج + إنشاء-ذاكرة + 0.1 × قراءة-ذاكرة) × 0.3 واط·س / 1k",
  "env.formula.water": "ماء ≈ الرموز الفعّالة × 0.5 مل / 1k",
  "env.disclaimer":
    "تقدير تقريبي مستند إلى تقديرات الاستدلال المنشورة؛ غير مُدقَّق.",
  "versions.menu.ariaLabel": "إصدارات الجلسة",
  "versions.item.untitled": "بلا عنوان",
  "versions.item.current": "الحالي",
  "versions.export.zip.title": "تنزيل .zip",
  "versions.export.html.title": "تنزيل .html",
  "versions.export.csb.title": "نسخ رابط CodeSandbox",
  "export.menu.ariaLabel": "تصدير اللقطة الحالية",
  "export.zip": "تنزيل .zip",
  "export.html": "تنزيل .html",
  "export.csb": "نسخ رابط CodeSandbox",
  "export.csb.copied": "تم النسخ!",
  "toast.export.failed": "فشل التصدير: {message}",
  "toast.csb.overflow":
    "أكبر مما يدعمه CodeSandbox — تم تنزيل .zip بدلًا من ذلك.",
  "toast.csb.copyFailed": "تعذّر النسخ — العنوان: {url}",
  "status.generating": "يفكر · {tokens} رموز",
  "status.fixing": "يُصلِح · محاولة {attempt}",
  "status.rolledback": "تم التراجع",
  "status.error": "خطأ: {message}",
  "time.secondsAgo": "منذ {n} ث",
  "time.minutesAgo": "منذ {n} د",
  "time.hoursAgo": "منذ {n} س",
};

const BN: Dict = {
  __mt: true,
  "onboarding.title": "Prism",
  "onboarding.subtitle": "এই পৃষ্ঠাকে বলুন কী হতে হবে",
  "fork.seedPrompt": "ফর্ক করা হয়েছে",
  "fork.seedSummary": "ফর্ক করা হয়েছে",
  "promptBar.placeholder":
    "এই পৃষ্ঠাকে বলুন কী হতে হবে। চেষ্টা করুন: ভোর ৩টায় টোকিওর একটি কফি শপ",
  "promptBar.placeholder.generating": "জেনারেট হচ্ছে…",
  "promptBar.env.ariaLabel":
    "পরিবেশগত ব্যবহার — পদ্ধতি দেখতে ক্লিক করুন",
  "promptBar.versions.ariaLabel":
    "সংস্করণ — বর্তমানে {total}-এর মধ্যে v{current}",
  "promptBar.export.ariaLabel": "রপ্তানি",
  "promptBar.generate.ariaLabel": "জেনারেট",
  "promptBar.fork.idle": "নতুন URL-এ ফর্ক করুন",
  "promptBar.fork.forking": "ফর্ক হচ্ছে…",
  "promptBar.fork.copied": "ফর্ক URL কপি হয়েছে",
  "promptBar.fork.title.idle": "নতুন URL-এ ফর্ক করুন",
  "promptBar.fork.title.forking": "ফর্ক হচ্ছে…",
  "promptBar.fork.title.copied": "URL কপি হয়েছে",
  "env.dialog.ariaLabel": "পরিবেশগত ব্যবহারের পদ্ধতি",
  "env.heading": "এ পর্যন্ত সেশনের ব্যবহার",
  "env.row.input": "ইনপুট",
  "env.row.output": "আউটপুট",
  "env.row.cacheRead": "ক্যাশ-রিড",
  "env.row.cacheCreate": "ক্যাশ-ক্রিয়েট",
  "env.tokens.suffix": "টোকেন",
  "env.formula.energy":
    "শক্তি ≈ (ইনপুট + আউটপুট + ক্যাশ-ক্রিয়েট + ০.১ × ক্যাশ-রিড) × ০.৩ Wh / ১k",
  "env.formula.water":
    "জল ≈ কার্যকর টোকেন × ০.৫ mL / ১k",
  "env.disclaimer":
    "প্রকাশিত ইনফারেন্স অনুমান থেকে আনুমানিক হিসাব; অডিট করা হয়নি।",
  "versions.menu.ariaLabel": "সেশনের সংস্করণ",
  "versions.item.untitled": "শিরোনামহীন",
  "versions.item.current": "বর্তমান",
  "versions.export.zip.title": ".zip ডাউনলোড",
  "versions.export.html.title": ".html ডাউনলোড",
  "versions.export.csb.title": "CodeSandbox লিঙ্ক কপি",
  "export.menu.ariaLabel": "বর্তমান স্ন্যাপশট রপ্তানি",
  "export.zip": ".zip ডাউনলোড",
  "export.html": ".html ডাউনলোড",
  "export.csb": "CodeSandbox লিঙ্ক কপি",
  "export.csb.copied": "কপি হয়েছে!",
  "toast.export.failed": "রপ্তানি ব্যর্থ: {message}",
  "toast.csb.overflow":
    "CodeSandbox-এর জন্য খুব বড় — পরিবর্তে .zip ডাউনলোড হয়েছে।",
  "toast.csb.copyFailed": "কপি করা যায়নি — URL: {url}",
  "status.generating": "ভাবছে · {tokens} টোকেন",
  "status.fixing": "ঠিক করছে · প্রচেষ্টা {attempt}",
  "status.rolledback": "রোলব্যাক করা হয়েছে",
  "status.error": "ত্রুটি: {message}",
  "time.secondsAgo": "{n} সে আগে",
  "time.minutesAgo": "{n} মি আগে",
  "time.hoursAgo": "{n} ঘ আগে",
};

const FR: Dict = {
  __mt: true,
  "onboarding.title": "Prism",
  "onboarding.subtitle": "dites à cette page ce qu'elle doit devenir",
  "fork.seedPrompt": "Forké",
  "fork.seedSummary": "Forké",
  "promptBar.placeholder":
    "Dites à cette page ce qu'elle doit devenir. Essayez : un café de Tokyo à 3 h du matin",
  "promptBar.placeholder.generating": "Génération…",
  "promptBar.env.ariaLabel":
    "Usage environnemental — cliquez pour la méthodologie",
  "promptBar.versions.ariaLabel":
    "Versions — actuellement v{current} sur {total}",
  "promptBar.export.ariaLabel": "Exporter",
  "promptBar.generate.ariaLabel": "Générer",
  "promptBar.fork.idle": "Forker vers une nouvelle URL",
  "promptBar.fork.forking": "Fork en cours…",
  "promptBar.fork.copied": "URL du fork copiée",
  "promptBar.fork.title.idle": "Forker vers une nouvelle URL",
  "promptBar.fork.title.forking": "fork en cours…",
  "promptBar.fork.title.copied": "URL copiée",
  "env.dialog.ariaLabel": "Méthodologie d'usage environnemental",
  "env.heading": "Usage de la session jusqu'à présent",
  "env.row.input": "entrée",
  "env.row.output": "sortie",
  "env.row.cacheRead": "cache-lecture",
  "env.row.cacheCreate": "cache-création",
  "env.tokens.suffix": "tokens",
  "env.formula.energy":
    "énergie ≈ (entrée + sortie + cache-création + 0,1 × cache-lecture) × 0,3 Wh / 1k",
  "env.formula.water": "eau ≈ tokens effectifs × 0,5 mL / 1k",
  "env.disclaimer":
    "Approximation grossière à partir d'estimations d'inférence publiées ; non auditée.",
  "versions.menu.ariaLabel": "Versions de la session",
  "versions.item.untitled": "Sans titre",
  "versions.item.current": "actuel",
  "versions.export.zip.title": "Télécharger .zip",
  "versions.export.html.title": "Télécharger .html",
  "versions.export.csb.title": "Copier le lien CodeSandbox",
  "export.menu.ariaLabel": "Exporter le snapshot actuel",
  "export.zip": "Télécharger .zip",
  "export.html": "Télécharger .html",
  "export.csb": "Copier le lien CodeSandbox",
  "export.csb.copied": "Copié !",
  "toast.export.failed": "Échec de l'export : {message}",
  "toast.csb.overflow":
    "Trop gros pour CodeSandbox — .zip téléchargé à la place.",
  "toast.csb.copyFailed": "Impossible de copier — URL : {url}",
  "status.generating": "réflexion · {tokens} tokens",
  "status.fixing": "correction · tentative {attempt}",
  "status.rolledback": "annulé",
  "status.error": "erreur : {message}",
  "time.secondsAgo": "il y a {n} s",
  "time.minutesAgo": "il y a {n} min",
  "time.hoursAgo": "il y a {n} h",
};

const RU: Dict = {
  __mt: true,
  "onboarding.title": "Prism",
  "onboarding.subtitle": "скажите этой странице, чем ей стать",
  "fork.seedPrompt": "Ответвлено",
  "fork.seedSummary": "Ответвлено",
  "promptBar.placeholder":
    "Скажите этой странице, чем ей стать. Попробуйте: токийская кофейня в 3 часа ночи",
  "promptBar.placeholder.generating": "Генерация…",
  "promptBar.env.ariaLabel":
    "Экологическое потребление — нажмите для методологии",
  "promptBar.versions.ariaLabel":
    "Версии — сейчас v{current} из {total}",
  "promptBar.export.ariaLabel": "Экспорт",
  "promptBar.generate.ariaLabel": "Сгенерировать",
  "promptBar.fork.idle": "Ответвить на новый URL",
  "promptBar.fork.forking": "Ответвление…",
  "promptBar.fork.copied": "URL ответвления скопирован",
  "promptBar.fork.title.idle": "Ответвить на новый URL",
  "promptBar.fork.title.forking": "ответвление…",
  "promptBar.fork.title.copied": "URL скопирован",
  "env.dialog.ariaLabel": "Методология экологического потребления",
  "env.heading": "Потребление за сессию",
  "env.row.input": "вход",
  "env.row.output": "выход",
  "env.row.cacheRead": "кэш-чтение",
  "env.row.cacheCreate": "кэш-создание",
  "env.tokens.suffix": "токенов",
  "env.formula.energy":
    "энергия ≈ (вход + выход + кэш-создание + 0,1 × кэш-чтение) × 0,3 Вт·ч / 1k",
  "env.formula.water":
    "вода ≈ эффективные токены × 0,5 мл / 1k",
  "env.disclaimer":
    "Приблизительная оценка на основе опубликованных данных вывода; не прошло аудит.",
  "versions.menu.ariaLabel": "Версии сессии",
  "versions.item.untitled": "Без названия",
  "versions.item.current": "текущая",
  "versions.export.zip.title": "Скачать .zip",
  "versions.export.html.title": "Скачать .html",
  "versions.export.csb.title": "Копировать ссылку CodeSandbox",
  "export.menu.ariaLabel": "Экспорт текущего снимка",
  "export.zip": "Скачать .zip",
  "export.html": "Скачать .html",
  "export.csb": "Копировать ссылку CodeSandbox",
  "export.csb.copied": "Скопировано!",
  "toast.export.failed": "Экспорт не удался: {message}",
  "toast.csb.overflow":
    "Слишком велико для CodeSandbox — скачан .zip вместо этого.",
  "toast.csb.copyFailed": "Не удалось скопировать — URL: {url}",
  "status.generating": "думаю · {tokens} токенов",
  "status.fixing": "исправляю · попытка {attempt}",
  "status.rolledback": "откатано",
  "status.error": "ошибка: {message}",
  "time.secondsAgo": "{n} с назад",
  "time.minutesAgo": "{n} мин назад",
  "time.hoursAgo": "{n} ч назад",
};

// ---------------------------------------------------------------------------
// Combined table. English is the canonical source-of-truth (no __mt flag).
// ---------------------------------------------------------------------------

const DICTS: Record<SupportedLang, Dict> = {
  en: { ...EN } as Dict,
  es: ES,
  ht: HT,
  zh: ZH,
  ar: AR,
  bn: BN,
  fr: FR,
  ru: RU,
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Interpolate `{placeholders}` in a template against a params object.
 * Unmatched placeholders are left as-is so P9 consumers catch mistakes.
 */
function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = params[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/**
 * Look up `key` in the dictionary for `lang`, falling back to English,
 * then to `key` itself. `params` are interpolated into any `{name}`
 * placeholders in the resolved template.
 */
export function t(
  key: string,
  lang: string,
  params?: Record<string, string | number>,
): string {
  const k = key as StringKey;

  const safeLang: SupportedLang =
    (SUPPORTED_LANGS as readonly string[]).includes(lang)
      ? (lang as SupportedLang)
      : "en";

  const primary = DICTS[safeLang]?.[k];
  if (typeof primary === "string") return interpolate(primary, params);

  const english = DICTS.en[k];
  if (typeof english === "string") return interpolate(english, params);

  // Unknown key — return the key itself (interpolated) so bugs surface loudly.
  return interpolate(key, params);
}

// ---------------------------------------------------------------------------
// React provider + hook
// ---------------------------------------------------------------------------

interface LanguageContextValue {
  lang: SupportedLang;
  setLang: (lang: string) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

interface LanguageProviderProps {
  initialLang?: string;
  children: ReactNode;
}

/**
 * Wraps a subtree with a mutable language. Accepts any string for
 * `initialLang`; unsupported codes are coerced to `"en"`.
 */
export function LanguageProvider({
  initialLang = "en",
  children,
}: LanguageProviderProps) {
  const [lang, setLangState] = useState<SupportedLang>(() =>
    (SUPPORTED_LANGS as readonly string[]).includes(initialLang)
      ? (initialLang as SupportedLang)
      : "en",
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang: (next: string) => {
        if ((SUPPORTED_LANGS as readonly string[]).includes(next)) {
          setLangState(next as SupportedLang);
        } else {
          setLangState("en");
        }
      },
    }),
    [lang],
  );

  return createElement(LanguageContext.Provider, { value }, children);
}

/**
 * Returns a `t` function closed over the current provider language.
 * Outside a provider, resolves against English.
 */
export function useT(): (
  key: string,
  params?: Record<string, string | number>,
) => string {
  const ctx = useContext(LanguageContext);
  const lang = ctx?.lang ?? "en";
  return (key, params) => t(key, lang, params);
}

/**
 * Escape hatch — current language, or `"en"` if outside a provider.
 */
export function useLang(): SupportedLang {
  return useContext(LanguageContext)?.lang ?? "en";
}

/**
 * Escape hatch — setter from provider, or a no-op outside one.
 */
export function useSetLang(): (lang: string) => void {
  const ctx = useContext(LanguageContext);
  return ctx?.setLang ?? (() => {});
}
