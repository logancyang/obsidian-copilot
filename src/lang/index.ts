/**
 * i18n module entry point
 * Re-export everything from i18n.ts for convenient imports
 */
export { t, getTranslations, getCurrentLanguage, setLanguage, isLanguageSupported, getSupportedLanguages, translations } from "./i18n";
export type { Translation, SupportedLanguage } from "./i18n";
