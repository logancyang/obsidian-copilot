/**
 * Internationalization (i18n) module for Obsidian Copilot
 *
 * This module provides translation support for multiple languages.
 * It automatically detects Obsidian's locale and loads the appropriate translations.
 */

import en from "./en";
import zhCN from "./zh-CN";

// Supported languages
export type SupportedLanguage = "en" | "zh-CN";

// Translation type (inferred from English translations)
export type Translation = typeof en;

// All available translations
const translations: Record<SupportedLanguage, Translation> = {
  en,
  "zh-CN": zhCN,
};

// Language code mapping (Obsidian locale -> our language code)
const languageMap: Record<string, SupportedLanguage> = {
  en: "en",
  "en-US": "en",
  "en-GB": "en",
  zh: "zh-CN",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-CN", // Fallback to Simplified Chinese
  "zh-HK": "zh-CN", // Fallback to Simplified Chinese
};

// Default language
const DEFAULT_LANGUAGE: SupportedLanguage = "en";

// Current language (cached)
let currentLanguage: SupportedLanguage | null = null;

/**
 * Get the current language code based on Obsidian's locale
 */
export function getCurrentLanguage(): SupportedLanguage {
  if (currentLanguage) {
    return currentLanguage;
  }

  // Get Obsidian's locale
  // @ts-ignore - Obsidian's internal API
  const obsidianLocale = window.localStorage.getItem("language") || "en";

  // Map to our supported language
  currentLanguage = languageMap[obsidianLocale] || DEFAULT_LANGUAGE;

  return currentLanguage;
}

/**
 * Set the current language manually
 * This can be used to override Obsidian's locale
 */
export function setLanguage(language: SupportedLanguage): void {
  currentLanguage = language;
}

/**
 * Get translations for the current language
 */
export function getTranslations(): Translation {
  const language = getCurrentLanguage();
  return translations[language] || translations[DEFAULT_LANGUAGE];
}

/**
 * Get a nested translation value by key path
 * @param key - Dot-separated key path (e.g., "chat.newChat")
 * @param params - Optional parameters for string interpolation
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const translations = getTranslations();
  const keys = key.split(".");

  // Navigate to the nested value
  let value: unknown = translations;
  for (const k of keys) {
    if (typeof value === "object" && value !== null && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      // Key not found, return the key itself
      console.warn(`Translation key not found: ${key}`);
      return key;
    }
  }

  if (typeof value !== "string") {
    console.warn(`Translation value is not a string: ${key}`);
    return key;
  }

  // Interpolate parameters if provided
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey) => {
      return String(params[paramKey] ?? `{{${paramKey}}}`);
    });
  }

  return value;
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(language: string): language is SupportedLanguage {
  return language in translations;
}

/**
 * Get all supported languages
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return Object.keys(translations) as SupportedLanguage[];
}

// Export translations for direct access if needed
export { translations };
