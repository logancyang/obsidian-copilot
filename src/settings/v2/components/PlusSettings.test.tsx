import type { PlanUsageReading } from "@/agentMode";
import { resetSettings, getSettings, setSettings } from "@/settings/model";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const mockApp = {};
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useApp: () => mockApp,
}));

const mockReadPlanUsage = jest.fn<Promise<PlanUsageReading>, []>();
jest.mock("@/agentMode", () => ({
  CopilotPlusUsageReader: class {
    readPlanUsage() {
      return mockReadPlanUsage();
    }
  },
}));

const mockValidateLicenseKey = jest.fn<Promise<{ isValid: boolean | undefined }>, unknown[]>();
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      validateLicenseKey: (...args: unknown[]) => mockValidateLicenseKey(...args),
    }),
  },
}));

const mockOpenWelcome = jest.fn();
jest.mock("@/components/modals/CopilotPlusWelcomeModal", () => ({
  CopilotPlusWelcomeModal: class {
    open() {
      mockOpenWelcome();
    }
  },
}));

interface ConfirmRequest {
  onConfirm: () => void;
  content: string;
  title: string;
}
const confirmRequests: ConfirmRequest[] = [];
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    constructor(_app: unknown, onConfirm: () => void, content: string, title: string) {
      confirmRequests.push({ onConfirm, content, title });
    }
    open() {}
  },
}));

import { PlusSettings } from "./PlusSettings";

const KEY_FIELD_PLACEHOLDER = "Enter your license key";

const USAGE_READING: PlanUsageReading = {
  kind: "usage",
  planUsage: {
    windows: [
      { id: "five_hour", label: "5h", percent: 12 },
      { id: "weekly", label: "Weekly", percent: 34 },
    ],
    updatedAt: 1,
  },
};

function storeActiveLicense(): void {
  setSettings({ plusLicenseKey: "stored-key", isPaidUser: true, entitlementExpiresAt: 0 });
}

describe("PlusSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmRequests.length = 0;
    resetSettings();
    mockReadPlanUsage.mockResolvedValue(USAGE_READING);
  });

  describe("PlusSettings()", () => {
    it("offers the license key field, Apply and See plans while no license is stored", () => {
      render(<PlusSettings />);

      expect(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "See plans" })).toBeTruthy();
      expect(mockReadPlanUsage).not.toHaveBeenCalled();
    });

    it("drops the key row and welcomes the user once an applied key turns out active — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
      mockValidateLicenseKey.mockImplementation(async () => {
        setSettings({ isPaidUser: true });
        return { isValid: true };
      });
      render(<PlusSettings />);

      fireEvent.change(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER), {
        target: { value: "fresh-key" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      expect(getSettings().plusLicenseKey).toBe("fresh-key");
      expect(mockOpenWelcome).toHaveBeenCalledTimes(1);
      expect(screen.queryByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeNull();
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
    });

    it("says nothing about a key while its validation is still in flight, then reports the verdict", async () => {
      setSettings({ plusLicenseKey: "lapsed-key", isPaidUser: false });
      let resolveValidation: (result: { isValid: boolean }) => void = () => {};
      mockValidateLicenseKey.mockReturnValue(
        new Promise((resolve) => {
          resolveValidation = resolve;
        })
      );
      render(<PlusSettings />);
      expect(screen.getByText("Inactive")).toBeTruthy();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      expect(mockValidateLicenseKey).toHaveBeenCalledWith(mockApp, { trigger: "manual" });
      expect(screen.queryByText("Inactive")).toBeNull();

      await act(async () => {
        resolveValidation({ isValid: false });
      });

      expect(screen.getByText("Inactive")).toBeTruthy();
      expect(screen.getByText("Invalid license key")).toBeTruthy();
    });

    it("shows the 5-hour and weekly usage read when the settings open with an active license", async () => {
      storeActiveLicense();

      render(<PlusSettings />);

      const usageLine = await screen.findByRole("list", { name: "Usage" });
      expect(
        within(usageLine)
          .getAllByRole("listitem")
          .map((item) => item.textContent)
      ).toEqual(["5h 12% used", "Weekly 34% used"]);
      expect(screen.queryByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeNull();
    });

    it("shows Remove license without numbers when the usage read has no allowance windows — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
      mockReadPlanUsage.mockResolvedValue({ kind: "unavailable" });
      storeActiveLicense();

      render(<PlusSettings />);

      await waitFor(() => expect(mockReadPlanUsage).toHaveBeenCalledTimes(1));
      await act(async () => {
        await mockReadPlanUsage.mock.results[0].value;
      });
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Usage" })).toBeNull();
    });

    it("removes the license after a confirmation that the plan is unaffected, restoring an empty key row", async () => {
      storeActiveLicense();
      render(<PlusSettings />);
      await screen.findByRole("list", { name: "Usage" });

      fireEvent.click(screen.getByRole("button", { name: "Remove license" }));
      expect(confirmRequests).toHaveLength(1);
      expect(confirmRequests[0].title).toBe("Remove license?");
      expect(confirmRequests[0].content).toContain("Your plan itself is not affected.");
      expect(getSettings().plusLicenseKey).toBe("stored-key");

      act(() => {
        confirmRequests[0].onConfirm();
      });

      expect(getSettings().plusLicenseKey).toBe("");
      expect(getSettings().isPaidUser).toBe(false);
      expect(screen.getByPlaceholderText<HTMLInputElement>(KEY_FIELD_PLACEHOLDER).value).toBe("");
      expect(screen.queryByRole("list", { name: "Usage" })).toBeNull();
    });
  });
});
