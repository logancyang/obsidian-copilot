import { DEFAULT_SETTINGS } from "@/constants";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// Persisted-settings surface: capture writes and feed a controllable snapshot.
const updateSetting = jest.fn<void, unknown[]>();
let currentSettings = { ...DEFAULT_SETTINGS };
jest.mock("@/settings/model", () => ({
  updateSetting: (...a: unknown[]) => updateSetting(...a),
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => currentSettings,
}));

// Entitlement surface. Eligible by default so the sub-section fields aren't
// blocked by the toggle's own gating.
let mockEligible: boolean | undefined = true;
jest.mock("@/plusUtils", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useIsSelfHostEligible: () => mockEligible,
}));

jest.mock("@/contexts/TabContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useTab: () => ({ setSelectedTab: jest.fn() }),
}));

import { SelfHostSettings } from "./SelfHostSettings";

const setSettings = (over: Partial<typeof DEFAULT_SETTINGS>) => {
  currentSettings = { ...DEFAULT_SETTINGS, ...over };
};

const providerSelect = () => screen.getByRole<HTMLSelectElement>("combobox");
const enableToggle = () => screen.getByRole("switch");

describe("SelfHostSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEligible = true;
    currentSettings = { ...DEFAULT_SETTINGS };
  });

  it("shows the Firecrawl key (not Perplexity) when the provider is firecrawl", () => {
    setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "firecrawl" });
    render(<SelfHostSettings />);

    expect(screen.getByText("Firecrawl API Key")).toBeTruthy();
    expect(screen.queryByText("Perplexity API Key")).toBeNull();
    expect(screen.getByText("Supadata API Key")).toBeTruthy();
  });

  it("shows the Perplexity key (not Firecrawl) when the provider is perplexity", () => {
    setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "perplexity" });
    render(<SelfHostSettings />);

    expect(screen.getByText("Perplexity API Key")).toBeTruthy();
    expect(screen.queryByText("Firecrawl API Key")).toBeNull();
  });

  it("persists a provider change through updateSetting", () => {
    setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "firecrawl" });
    render(<SelfHostSettings />);

    fireEvent.change(providerSelect(), { target: { value: "perplexity" } });

    expect(updateSetting).toHaveBeenCalledWith("selfHostSearchProvider", "perplexity");
  });

  it("offers both Firecrawl and Perplexity as provider options", () => {
    setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "firecrawl" });
    render(<SelfHostSettings />);

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Firecrawl", "Perplexity Sonar"]));
  });

  it("disables the provider control while self-host mode is off", () => {
    setSettings({ enableSelfHostMode: false, selfHostSearchProvider: "firecrawl" });
    render(<SelfHostSettings />);

    expect(providerSelect().disabled).toBe(true);
  });

  it("enables the provider control while self-host mode is on", () => {
    setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "firecrawl" });
    render(<SelfHostSettings />);

    expect(providerSelect().disabled).toBe(false);
  });

  it("persists the toggle directly when the entitlement grants self-host", () => {
    render(<SelfHostSettings />);
    fireEvent.click(enableToggle());

    expect(updateSetting).toHaveBeenCalledWith("enableSelfHostMode", true);
  });

  it.each([
    ["the entitlement does not grant self-host", false],
    ["the entitlement check has not settled yet", undefined],
  ])("ignores clicks on the enable toggle while %s", (_case, eligible) => {
    mockEligible = eligible;
    render(<SelfHostSettings />);

    expect(enableToggle().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(enableToggle());
    expect(updateSetting).not.toHaveBeenCalledWith("enableSelfHostMode", true);
  });

  it("lets an ineligible user turn self-host mode back off", () => {
    // A token that stops verifying leaves the preference on (it is not an
    // authoritative "not entitled"), so gating this direction too would strand
    // the user with self-host stuck on and the toggle unreachable.
    mockEligible = false;
    setSettings({ enableSelfHostMode: true });
    render(<SelfHostSettings />);

    expect(enableToggle().getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(enableToggle());
    expect(updateSetting).toHaveBeenCalledWith("enableSelfHostMode", false);
  });
});
