import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";

const mockGetSettings = jest.fn<CopilotSettings, []>();
const mockSetSettings = jest.fn<void, [Partial<CopilotSettings>]>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  setSettings: (partial: Partial<CopilotSettings>) => mockSetSettings(partial),
}));

const mockVerifyEntitlement = jest.fn<Promise<unknown>, [string, unknown?]>();

jest.mock("@/entitlement", () => ({
  verifyEntitlement: (...args: [string, unknown?]) => mockVerifyEntitlement(...args),
}));

import {
  applyEntitlement,
  canUseMultiAgent,
  isSelfHostAccessValid,
  isSelfHostModeValid,
} from "@/plusUtils";

const SELF_HOST_GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;

function buildSettings(overrides: Partial<CopilotSettings>): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("isSelfHostAccessValid", () => {
  it("returns false when selfHostModeValidatedAt is null (un-seeded receipt)", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({ selfHostModeValidatedAt: null, selfHostValidationCount: 0 })
    );
    expect(isSelfHostAccessValid()).toBe(false);
  });

  it("returns true within the 15-day grace period of a freshly seeded receipt", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({ selfHostModeValidatedAt: Date.now(), selfHostValidationCount: 1 })
    );
    expect(isSelfHostAccessValid()).toBe(true);
  });

  it("returns false once the grace period has expired and count < 3", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({
        selfHostModeValidatedAt: Date.now() - SELF_HOST_GRACE_PERIOD_MS - 1000,
        selfHostValidationCount: 1,
      })
    );
    expect(isSelfHostAccessValid()).toBe(false);
  });

  it("returns true permanently once count >= 3 even after grace expiry", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({
        selfHostModeValidatedAt: Date.now() - SELF_HOST_GRACE_PERIOD_MS - 1000,
        selfHostValidationCount: 3,
      })
    );
    expect(isSelfHostAccessValid()).toBe(true);
  });
});

describe("canUseMultiAgent", () => {
  it("returns false for a free user (no Plus, no self-host)", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({ isPlusUser: false, enableSelfHostMode: false })
    );
    expect(canUseMultiAgent()).toBe(false);
  });

  it("returns true for a Plus user", () => {
    mockGetSettings.mockReturnValue(buildSettings({ isPlusUser: true, enableSelfHostMode: false }));
    expect(canUseMultiAgent()).toBe(true);
  });

  it("returns false for a Lite user (paid but below Plus)", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({ isPaidUser: true, isPlusUser: false, enableSelfHostMode: false })
    );
    expect(canUseMultiAgent()).toBe(false);
  });

  it("returns true when self-host mode is on (believer/supporter offline path)", () => {
    mockGetSettings.mockReturnValue(buildSettings({ isPlusUser: false, enableSelfHostMode: true }));
    expect(canUseMultiAgent()).toBe(true);
  });
});

describe("applyEntitlement", () => {
  beforeEach(() => {
    mockSetSettings.mockClear();
    mockVerifyEntitlement.mockReset();
    mockGetSettings.mockReturnValue(buildSettings({ userId: "user-123" }));
  });

  it("grants Plus for a token carrying the multi_agent feature", async () => {
    mockVerifyEntitlement.mockResolvedValue({
      user_id: "user-123",
      plan: "plus",
      tier: "plus",
      features: ["multi_agent", "self_host"],
      iat: 0,
      exp: 9_999_999_999,
    });
    expect(await applyEntitlement("token")).toBe(true);
    expect(mockSetSettings).toHaveBeenCalledWith({
      entitlementToken: "token",
      isPaidUser: true,
      isPlusUser: true,
    });
  });

  it("marks a Lite token paid but not Plus", async () => {
    mockVerifyEntitlement.mockResolvedValue({
      user_id: "user-123",
      plan: "lite",
      tier: "lite",
      features: [],
      iat: 0,
      exp: 9_999_999_999,
    });
    expect(await applyEntitlement("token")).toBe(false);
    expect(mockSetSettings).toHaveBeenCalledWith({
      entitlementToken: "token",
      isPaidUser: true,
      isPlusUser: false,
    });
  });

  it("grants Plus for a Pro token", async () => {
    mockVerifyEntitlement.mockResolvedValue({
      user_id: "user-123",
      plan: "pro",
      tier: "pro",
      features: ["multi_agent"],
      iat: 0,
      exp: 9_999_999_999,
    });
    expect(await applyEntitlement("token")).toBe(true);
    expect(mockSetSettings).toHaveBeenCalledWith({
      entitlementToken: "token",
      isPaidUser: true,
      isPlusUser: true,
    });
  });

  it("clears entitlement when the token is invalid or expired", async () => {
    mockVerifyEntitlement.mockResolvedValue(null);
    expect(await applyEntitlement("bad")).toBe(false);
    expect(mockSetSettings).toHaveBeenCalledWith({
      isPaidUser: false,
      isPlusUser: false,
      entitlementToken: "",
    });
  });
});

describe("isSelfHostModeValid", () => {
  it("returns false when the toggle is off, regardless of any receipt", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({
        enableSelfHostMode: false,
        selfHostModeValidatedAt: Date.now(),
        selfHostValidationCount: 1,
      })
    );
    expect(isSelfHostModeValid()).toBe(false);
  });

  it("returns true when the toggle is on even with a null receipt (gates on the toggle alone)", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({
        enableSelfHostMode: true,
        selfHostModeValidatedAt: null,
        selfHostValidationCount: 0,
      })
    );
    expect(isSelfHostModeValid()).toBe(true);
  });

  it("returns true when the toggle is on regardless of grace/permanent receipt state", () => {
    mockGetSettings.mockReturnValue(
      buildSettings({
        enableSelfHostMode: true,
        selfHostModeValidatedAt: Date.now() - SELF_HOST_GRACE_PERIOD_MS - 1000,
        selfHostValidationCount: 0,
      })
    );
    expect(isSelfHostModeValid()).toBe(true);
  });
});
