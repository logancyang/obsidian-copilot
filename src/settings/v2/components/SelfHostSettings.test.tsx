import { DEFAULT_SETTINGS } from "@/constants";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it.each([
    ["parallel", "Parallel API Key", ["Firecrawl API Key", "Perplexity API Key", "Exa API Key"]],
    ["exa", "Exa API Key", ["Firecrawl API Key", "Perplexity API Key", "Parallel API Key"]],
  ] as const)(
    "shows only the %s credential field when that provider is selected (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
    (provider, visibleTitle, hiddenTitles) => {
      setSettings({ enableSelfHostMode: true, selfHostSearchProvider: provider });
      render(<SelfHostSettings />);

      expect(screen.getByText(visibleTitle)).toBeTruthy();
      for (const title of hiddenTitles) {
        expect(screen.queryByText(title)).toBeNull();
      }
    }
  );

  it("persists a provider change through updateSetting", () => {
    setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "firecrawl" });
    render(<SelfHostSettings />);

    fireEvent.change(providerSelect(), { target: { value: "perplexity" } });

    expect(updateSetting).toHaveBeenCalledWith("selfHostSearchProvider", "perplexity");
  });

  it("offers Firecrawl, Perplexity, Parallel, and Exa as provider options (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", () => {
    setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "firecrawl" });
    render(<SelfHostSettings />);

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Firecrawl", "Perplexity Sonar", "Parallel", "Exa"]);
  });

  it.each([
    ["parallel", "parallel-key", "parallelApiKey", "parallel-…"],
    ["exa", "exa-key", "exaApiKey", "exa-…"],
  ] as const)(
    "persists the selected %s credential independently (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
    (provider, key, field, placeholder) => {
      jest.useFakeTimers();
      setSettings({ enableSelfHostMode: true, selfHostSearchProvider: provider });
      render(<SelfHostSettings />);

      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: key } });
      act(() => jest.runAllTimers());

      expect(updateSetting).toHaveBeenCalledWith(field, key);
      jest.useRealTimers();
    }
  );

  it.each(["parallel", "exa"] as const)(
    "persists a provider change to %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
    (provider) => {
      setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "firecrawl" });
      render(<SelfHostSettings />);

      fireEvent.change(providerSelect(), { target: { value: provider } });

      expect(updateSetting).toHaveBeenCalledWith("selfHostSearchProvider", provider);
    }
  );

  it("disables the selected provider credential while self-host mode is off (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", () => {
    setSettings({ enableSelfHostMode: false, selfHostSearchProvider: "parallel" });
    render(<SelfHostSettings />);

    expect(screen.getByPlaceholderText<HTMLInputElement>("parallel-…").disabled).toBe(true);
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
