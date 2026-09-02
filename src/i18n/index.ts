import { DEFAULT_LOCALE, resolveLocale, type SupportedLocale } from "@/i18n/locale";
import { ENGLISH_TRANSLATIONS } from "@/i18n/locales/en";
import { ZH_CN_TRANSLATIONS } from "@/i18n/locales/zh-CN";
import { getLanguage } from "obsidian";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, resolveLocale } from "@/i18n/locale";
export type { SupportedLocale } from "@/i18n/locale";

export interface TranslationValues {
  count?: number;
  [name: string]: boolean | null | number | string | undefined;
}

export type TranslationCatalog = Readonly<Record<string, string>>;

const catalogs: Partial<Record<SupportedLocale, TranslationCatalog>> = {
  [DEFAULT_LOCALE]: ENGLISH_TRANSLATIONS,
  "zh-CN": ZH_CN_TRANSLATIONS,
};
let requestedLocale: SupportedLocale | undefined;
let activeLocale: SupportedLocale = DEFAULT_LOCALE;

/** Initialize the shared interface-localization runtime for the current plugin lifecycle. */
export function initializeI18n(): void {
  if (requestedLocale) return;
  requestedLocale = resolveLocale(getLanguage());
  // A supported locale without a shipped catalog must remain fully English.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/324
  activeLocale = catalogs[requestedLocale] ? requestedLocale : DEFAULT_LOCALE;
}

/** Register one complete locale catalog before translating interface messages. */
export function registerCatalog(locale: SupportedLocale, catalog: TranslationCatalog): void {
  catalogs[locale] = catalog;
  // Future catalogs may register after initialization without leaving the UI
  // stuck on its temporary English fallback.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/324
  if (requestedLocale === locale) activeLocale = locale;
}

function findMessage(
  catalog: TranslationCatalog | undefined,
  locale: SupportedLocale,
  key: string,
  count: number | undefined
): string | undefined {
  // A count selects the locale's CLDR plural form while ordinary messages
  // keep their unsuffixed key.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/324
  if (count === undefined) return catalog?.[key];
  const category = new Intl.PluralRules(locale).select(count);
  return catalog?.[`${key}_${category}`] ?? catalog?.[`${key}_other`] ?? catalog?.[key];
}

/** Translate one complete interface message through the shared locale and English fallback. */
export function t(key: string, values: TranslationValues = {}): string {
  // Traditional Chinese and every other locale fall directly back to English;
  // no sibling-language catalog participates in lookup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/324
  const message =
    findMessage(catalogs[activeLocale], activeLocale, key, values.count) ??
    findMessage(catalogs[DEFAULT_LOCALE], DEFAULT_LOCALE, key, values.count) ??
    key;
  // An unresolved placeholder stays visible instead of silently deleting
  // information from an incomplete translation call.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/324
  return message.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    values[name] === undefined ? placeholder : String(values[name])
  );
}

/** Format a number with the active interface locale. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(activeLocale, options).format(value);
}

/** Format a date with the active interface locale. */
export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(activeLocale, options).format(value);
}
