import { DEFAULT_SETTINGS } from "@/constants";
import { act, render, screen } from "@testing-library/react";
import React from "react";

let mockLocale: "en" | "zh-CN" = "en";
jest.mock("@/i18n", () => ({
  t: (key: string, values: Record<string, number | string> = {}) => {
    const { ENGLISH_TRANSLATIONS } =
      jest.requireActual<typeof import("@/i18n/locales/en")>("@/i18n/locales/en");
    const { ZH_CN_TRANSLATIONS } =
      jest.requireActual<typeof import("@/i18n/locales/zh-CN")>("@/i18n/locales/zh-CN");
    const catalog: Readonly<Record<string, string>> =
      mockLocale === "zh-CN" ? ZH_CN_TRANSLATIONS : ENGLISH_TRANSLATIONS;
    return (catalog[key] ?? key).replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
      values[name] === undefined ? placeholder : String(values[name])
    );
  },
}));

const updateSetting = jest.fn<void, unknown[]>();
const mockApp = {};
let currentSettings = { ...DEFAULT_SETTINGS };
jest.mock("@/settings/model", () => ({
  updateSetting: (...a: unknown[]) => updateSetting(...a),
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => currentSettings,
}));

// Entitlement surface. `useLicenseState` is the hook under test elsewhere; here
// it only has to produce the states this section renders.
let mockLicenseState: { status: string; plan?: string } = { status: "none" };
let mockIsPaidUser: boolean | undefined = false;
const checkIsPaidUser = jest.fn<Promise<boolean | undefined>, unknown[]>();
jest.mock("@/plusUtils", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useLicenseState: () => mockLicenseState,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useIsPaidUser: () => mockIsPaidUser,
  checkIsPaidUser: (...a: unknown[]) => checkIsPaidUser(...a),
  createPlusPageUrl: () => "https://example.test/plans",
  navigateToPlusPage: jest.fn(),
}));

jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useApp: () => mockApp,
}));

jest.mock("@/components/modals/CopilotPlusWelcomeModal", () => ({
  CopilotPlusWelcomeModal: class {
    open() {}
  },
}));

import { PlusSettings } from "./PlusSettings";

describe("PlusSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocale = "en";
    currentSettings = { ...DEFAULT_SETTINGS };
    mockLicenseState = { status: "none" };
    mockIsPaidUser = false;
  });

  describe("PlusSettings()", () => {
    it("names a lifetime purchase Lifetime rather than its stored plan", () => {
      mockLicenseState = { status: "active", plan: "believer" };
      mockIsPaidUser = true;

      render(<PlusSettings />);

      expect(screen.getByText("Lifetime")).toBeTruthy();
      expect(screen.queryByText(/believer/i)).toBeNull();
    });

    it("shows a recurring plan under its own name", () => {
      mockLicenseState = { status: "active", plan: "lite" };
      mockIsPaidUser = true;

      render(<PlusSettings />);

      expect(screen.getByText("lite")).toBeTruthy();
    });

    it("preserves the complete English sales pitch across its styled links and features", () => {
      render(<PlusSettings />);

      expect(document.body.textContent).toContain(
        "Copilot paid plans add premium chat models, document understanding, advanced web search, and multi-agent capabilities to your Copilot agentic experience. Pair it with Miyo and turn your vault into a centralized workspace for all your AI tools across devices."
      );
    });

    it("localizes the license surface while preserving a stored plan identifier for https://github.com/Brevilabs/obsidian-copilot-private/issues/326", () => {
      mockLocale = "zh-CN";
      mockLicenseState = { status: "active", plan: "lite" };
      mockIsPaidUser = true;

      render(<PlusSettings />);

      expect(screen.getByText("Copilot 许可证")).not.toBeNull();
      expect(screen.getByText("lite")).not.toBeNull();
      expect(screen.getByRole("link", { name: "Copilot 付费方案" })).not.toBeNull();
      expect(screen.getByPlaceholderText("输入许可证密钥")).not.toBeNull();
      expect(screen.getByRole("button", { name: "应用" })).not.toBeNull();
      expect(document.body.textContent).toContain(
        "Copilot 付费方案为你的智能体工作流提供高级对话模型、文档理解、高级网络搜索和多智能体功能。搭配 Miyo 使用，可将仓库变成所有 AI 工具都能跨设备访问的统一工作区。"
      );
    });

    it("reports a stored key that grants nothing as inactive, alongside the pitch", () => {
      mockLicenseState = { status: "inactive" };

      render(<PlusSettings />);

      expect(screen.getByText("Inactive")).toBeTruthy();
      expect(screen.getByText("All of it for a few dollars a month.")).toBeTruthy();
    });

    it("says nothing about a key while its validation is still in flight", async () => {
      // The hook only sees the stored token, which stays empty until the server
      // answers, so a freshly applied key reads as inactive there. Rejecting a
      // license the user just bought — for the length of a network call — is the
      // regression this guards.
      mockLicenseState = { status: "inactive" };
      let resolveValidation: (value: boolean) => void = () => {};
      checkIsPaidUser.mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveValidation = resolve;
        })
      );

      render(<PlusSettings />);
      act(() => {
        screen.getByRole("button", { name: "Apply" }).click();
      });

      expect(checkIsPaidUser).toHaveBeenCalledWith(mockApp, { trigger: "manual" });
      expect(screen.queryByText("Inactive")).toBeNull();
      expect(screen.queryByText("All of it for a few dollars a month.")).toBeNull();

      await act(async () => {
        resolveValidation(true);
      });

      expect(screen.getByText("Inactive")).toBeTruthy();
    });
  });
});
