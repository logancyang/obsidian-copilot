import { AgentDefaultModelSetting } from "@/agentMode/ui/AgentDefaultModelSetting";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, EnabledModelEntry } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useSettingsValue` hook; the name must match the export
  useSettingsValue: () => ({ agentMode: { backends: {} } }),
}));

const ENABLED: EnabledModelEntry[] = [
  { baseModelId: "opus", name: "Opus", credentialState: "ok" },
  { baseModelId: "sonnet", name: "Sonnet", credentialState: "ok" },
  { baseModelId: "byok", name: "BYOK", credentialState: "missing_key" },
];

function makeDescriptor(): BackendDescriptor {
  return {
    id: "opencode",
    displayName: "opencode",
    getEnabledModelEntries: () => ENABLED,
  } as unknown as BackendDescriptor;
}

function makeManager(opts: {
  defaultSelection?: { baseModelId: string; effort: string | null } | null;
  effortByModel?: Record<string, { value: string | null; label: string }[]>;
  persist?: jest.Mock;
}): AgentSessionManager {
  const effortByModel = opts.effortByModel ?? {};
  return {
    getPreloadStatus: () => "ready",
    subscribe: () => () => {},
    subscribeModelCache: () => () => {},
    getActiveChatUIState: () => null,
    getDefaultSelection: () => opts.defaultSelection ?? null,
    // resolveEffortOptions reads cached state first, then the effort catalog;
    // route everything through the catalog so the test controls it per model.
    getCachedBackendState: () => null,
    getEffortCatalog: () => effortByModel,
    persistDefaultSelection: opts.persist ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentSessionManager;
}

describe("AgentDefaultModelSetting", () => {
  it("persists the picked model with its first effort option", () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager({
      defaultSelection: { baseModelId: "opus", effort: "high" },
      effortByModel: {
        opus: [
          { value: "high", label: "High" },
          { value: "low", label: "Low" },
        ],
        sonnet: [
          { value: "medium", label: "Medium" },
          { value: "max", label: "Max" },
        ],
      },
      persist,
    });
    render(<AgentDefaultModelSetting descriptor={makeDescriptor()} manager={manager} />);

    const modelSelect = screen.getByDisplayValue("Opus");
    // Switching to a model whose effort vocabulary differs must reset effort
    // to the new model's first option, not carry over the stale "high".
    fireEvent.change(modelSelect, { target: { value: "sonnet" } });
    expect(persist).toHaveBeenCalledWith("opencode", { baseModelId: "sonnet", effort: "medium" });
  });

  it("resets effort to null when the new model has no effort options", () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager({
      defaultSelection: { baseModelId: "opus", effort: "high" },
      effortByModel: { opus: [{ value: "high", label: "High" }] },
      persist,
    });
    render(<AgentDefaultModelSetting descriptor={makeDescriptor()} manager={manager} />);

    fireEvent.change(screen.getByDisplayValue("Opus"), { target: { value: "sonnet" } });
    expect(persist).toHaveBeenCalledWith("opencode", { baseModelId: "sonnet", effort: null });
  });

  it("flags a missing-key model in its option label", () => {
    const manager = makeManager({ defaultSelection: { baseModelId: "opus", effort: null } });
    render(<AgentDefaultModelSetting descriptor={makeDescriptor()} manager={manager} />);
    expect(screen.queryByText(/BYOK \(Add API key\)/)).not.toBeNull();
  });
});
