import { DEFAULT_SETTINGS } from "@/constants";
import { act, render, screen } from "@testing-library/react";
import React from "react";

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
