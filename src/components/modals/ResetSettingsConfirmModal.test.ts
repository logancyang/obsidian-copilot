import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";

let mockLocale: "en" | "zh-CN" = "en";
jest.mock("@/i18n", () => ({
  t: (key: string, values: Record<string, string> = {}) => {
    const { ENGLISH_TRANSLATIONS } =
      jest.requireActual<typeof import("@/i18n/locales/en")>("@/i18n/locales/en");
    const { ZH_CN_TRANSLATIONS } =
      jest.requireActual<typeof import("@/i18n/locales/zh-CN")>("@/i18n/locales/zh-CN");
    const catalog: Readonly<Record<string, string>> =
      mockLocale === "zh-CN" ? ZH_CN_TRANSLATIONS : ENGLISH_TRANSLATIONS;
    return (catalog[key] ?? key).replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
      values[name] === undefined ? placeholder : values[name]
    );
  },
}));

const confirmModalConstructor = jest.fn();
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    constructor(...args: unknown[]) {
      confirmModalConstructor(...args);
    }
  },
}));

describe("ResetSettingsConfirmModal", () => {
  describe("ResetSettingsConfirmModal", () => {
    describe("constructor()", () => {
      it("localizes the modal controls while preserving deferred destination labels for https://github.com/Brevilabs/obsidian-copilot-private/issues/325", () => {
        mockLocale = "zh-CN";

        new ResetSettingsConfirmModal({} as never, jest.fn());

        expect(confirmModalConstructor).toHaveBeenCalledWith(
          expect.anything(),
          expect.any(Function),
          expect.stringContaining("“高级”→“API Key Storage”"),
          "重置设置",
          "继续",
          "取消"
        );
        expect(confirmModalConstructor.mock.calls[0][2]).toContain("“Delete All Keys”");
      });
    });
  });
});
