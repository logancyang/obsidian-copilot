import { resolveLocale } from "@/i18n/locale";
import { ENGLISH_TRANSLATIONS } from "@/i18n/locales/en";
import { ENGLISH_TRANSLATIONS as ENGLISH_TRANSLATION_SOURCE } from "@/i18n/locales/en.source";
import { ZH_CN_TRANSLATIONS } from "@/i18n/locales/zh-CN";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/324";
const SETTINGS_ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/325";
const ZH_CN_ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/326";

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
  describe("catalogs", () => {
    it(`keeps the Simplified Chinese Settings catalog in parity with English for ${SETTINGS_ISSUE_URL}`, () => {
      expect(Object.keys(ZH_CN_TRANSLATIONS).sort()).toEqual(
        Object.keys(ENGLISH_TRANSLATIONS).sort()
      );
      expect(
        Object.values(ZH_CN_TRANSLATIONS).every((message) => typeof message === "string")
      ).toBe(true);
    });

    it(`ships complete named English Settings messages for ${SETTINGS_ISSUE_URL}`, () => {
      expect(ENGLISH_TRANSLATIONS).toEqual(ENGLISH_TRANSLATION_SOURCE);
      expect(Object.keys(ENGLISH_TRANSLATIONS)).not.toHaveLength(0);
      expect(Object.values(ENGLISH_TRANSLATIONS).every((message) => message.length > 0)).toBe(true);
    });
  });

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

    it(`activates the bundled Simplified Chinese Settings catalog for ${SETTINGS_ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");

      i18n.initializeI18n();

      expect(i18n.t("settings.title")).toBe("Copilot 设置");
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

    it(`keeps a dynamic folder path unchanged inside Simplified Chinese for ${SETTINGS_ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");
      i18n.initializeI18n();

      expect(i18n.t("settings.notice.folderChanged", { folder: "资料/Copilot 数据" })).toBe(
        "Copilot 文件夹已更改为“资料/Copilot 数据”。"
      );
    });

    it(`localizes the Agent Chat shell while preserving dynamic product values for ${ZH_CN_ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");
      i18n.initializeI18n();

      expect(i18n.t("agentChat.composer.placeholder")).toBe(
        "有问题尽管问 • 输入 @ 添加上下文 • 输入 / 使用命令"
      );
      expect(i18n.t("agentChat.status.configure", { backend: "Claude" })).toBe("配置 Claude");
      expect(i18n.t("agentChat.notice.imagesUnsupported", { model: "Sonnet 4.5" })).toBe(
        "Sonnet 4.5 不支持图片。请切换到支持视觉的模型后再发送图片。"
      );
    });

    it(`localizes every Settings tab while preserving protected product and technical terms for ${ZH_CN_ISSUE_URL}`, () => {
      const i18n = loadI18n("zh");
      i18n.initializeI18n();

      expect(i18n.t("settings.tabs.byok")).toBe("BYOK");
      expect(i18n.t("settings.tabs.miyo")).toBe("Miyo");
      expect(i18n.t("settings.miyo.documentProcessor.description")).toContain("PDF 和 EPUB");
      expect(i18n.t("settings.miyo.documentProcessor.description")).toContain("Miyo");
      expect(i18n.t("settings.miyo.documentProcessor.description")).toContain("Plus");
      expect(i18n.t("settings.byok.removeProvider.confirm", { provider: "Anthropic" })).toContain(
        "Anthropic"
      );
      expect(i18n.t("settings.byok.providerFamily.claude")).toBe("Claude 系列");
      expect(i18n.t("settings.agents.quickChatModels.empty")).toContain("Models (BYOK)");
      expect(i18n.t("settings.advanced.patterns.addCustom")).toBe("添加自定义模式");
      expect(i18n.t("settings.command.delete.confirm", { command: "summarize-note" })).toContain(
        "summarize-note"
      );
      expect(i18n.t("settings.skills.properties.title", { skill: "release-note" })).toBe(
        "属性 · release-note"
      );
      expect(i18n.t("settings.skills.loadIssues.title", { count: 2 })).toBe("2 个技能无法加载");
      expect(i18n.t("settings.skills.loadIssues.tabWarning")).toBe("部分技能加载失败");
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
