import { resolveLocale } from "@/i18n/locale";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/324";

interface LoadedI18n {
  formatDate: typeof import("@/i18n").formatDate;
  formatNumber: typeof import("@/i18n").formatNumber;
  initializeI18n: typeof import("@/i18n").initializeI18n;
  registerCatalog: typeof import("@/i18n").registerCatalog;
  t: typeof import("@/i18n").t;
}

function loadI18n(obsidianLocale: string): LoadedI18n {
  jest.resetModules();
  const obsidian = jest.requireActual<{
    getLanguage: jest.MockedFunction<() => string>;
  }>("obsidian");
  obsidian.getLanguage.mockReturnValue(obsidianLocale);
  return jest.requireActual<LoadedI18n>("@/i18n");
}

describe("i18n", () => {
  describe("resolveLocale()", () => {
    it(`maps Obsidian Simplified Chinese variants to zh-CN for ${ISSUE_URL}`, () => {
      expect(resolveLocale("zh")).toBe("zh-CN");
      expect(resolveLocale("zh-CN")).toBe("zh-CN");
      expect(resolveLocale("zh-Hans")).toBe("zh-CN");
    });

    it(`maps Obsidian Traditional Chinese variants to zh-TW for ${ISSUE_URL}`, () => {
      expect(resolveLocale("zh-TW")).toBe("zh-TW");
      expect(resolveLocale("zh-Hant")).toBe("zh-TW");
      expect(resolveLocale("zh-Hant-TW")).toBe("zh-TW");
    });

    it(`falls back to English for unsupported Obsidian locales for ${ISSUE_URL}`, () => {
      expect(resolveLocale("fr")).toBe("en");
      expect(resolveLocale("")).toBe("en");
    });
  });

  describe("initializeI18n()", () => {
    it(`reads Obsidian's language once when repeated initialization reuses the singleton for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("en");
      const obsidian = jest.requireActual<{
        getLanguage: jest.MockedFunction<() => string>;
      }>("obsidian");

      i18n.initializeI18n();
      i18n.initializeI18n();

      expect(obsidian.getLanguage).toHaveBeenCalledTimes(1);
    });

    it(`uses English until the requested catalog exists for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");
      i18n.registerCatalog("en", { variant: "English variant" });

      i18n.initializeI18n();

      expect(i18n.t("variant")).toBe("English variant");
    });
  });

  describe("registerCatalog()", () => {
    it(`activates a requested catalog registered after initialization for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");
      i18n.initializeI18n();

      i18n.registerCatalog("zh-CN", { variant: "简体中文" });

      expect(i18n.t("variant")).toBe("简体中文");
    });
  });

  describe("t()", () => {
    it(`falls back to the complete English message when a localized key is missing for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");
      i18n.registerCatalog("en", { fallbackOnly: "English fallback" });
      i18n.registerCatalog("zh-CN", {});
      i18n.initializeI18n();

      expect(i18n.t("fallbackOnly")).toBe("English fallback");
    });

    it(`never falls through from Taiwan Traditional to a Simplified catalog for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("zh-TW");
      i18n.registerCatalog("en", { variant: "English variant" });
      i18n.registerCatalog("zh-CN", { variant: "简体中文" });
      i18n.registerCatalog("zh-TW", {});
      i18n.initializeI18n();

      expect(i18n.t("variant")).toBe("English variant");
    });

    it(`interpolates named parameters into a complete message for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("en");
      i18n.registerCatalog("en", { welcome: "Welcome, {{name}}!" });
      i18n.initializeI18n();

      expect(i18n.t("welcome", { name: "Ada" })).toBe("Welcome, Ada!");
    });

    it(`preserves an interpolation placeholder when its value is missing for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("en");
      i18n.registerCatalog("en", { welcome: "Welcome, {{name}}!" });
      i18n.initializeI18n();

      expect(i18n.t("welcome")).toBe("Welcome, {{name}}!");
    });

    it(`selects locale plural forms and interpolates the count for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("en");
      i18n.registerCatalog("en", {
        item_one: "{{count}} item",
        item_other: "{{count}} items",
      });
      i18n.initializeI18n();

      expect(i18n.t("item", { count: 1 })).toBe("1 item");
      expect(i18n.t("item", { count: 3 })).toBe("3 items");
    });
  });

  describe("formatNumber()", () => {
    it(`formats numbers with the active locale and caller options for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");
      i18n.registerCatalog("zh-CN", {});
      i18n.initializeI18n();
      const options: Intl.NumberFormatOptions = { style: "percent" };

      expect(i18n.formatNumber(0.25, options)).toBe(
        new Intl.NumberFormat("zh-CN", options).format(0.25)
      );
    });
  });

  describe("formatDate()", () => {
    it(`formats dates with the active locale and caller options for ${ISSUE_URL}`, () => {
      const i18n = loadI18n("zh-TW");
      i18n.registerCatalog("zh-TW", {});
      i18n.initializeI18n();
      const value = new Date("2026-01-02T12:00:00Z");
      const options: Intl.DateTimeFormatOptions = {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
        year: "numeric",
      };

      expect(i18n.formatDate(value, options)).toBe(
        new Intl.DateTimeFormat("zh-TW", options).format(value)
      );
    });
  });
});
