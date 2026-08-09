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

function makeDescriptor(enabled: EnabledModelEntry[] = ENABLED): BackendDescriptor {
  return {
    id: "opencode",
    displayName: "opencode",
    getEnabledModelEntries: () => enabled,
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
    getModelCacheSignature: () => "ready#",
    subscribe: () => () => {},
    subscribeModelCache: () => () => {},
    getActiveChatUIState: () => null,
    getDefaultSelection: () => opts.defaultSelection ?? null,
    getCachedModelCatalog: () => null,
    getEffortCatalog: () => effortByModel,
    persistDefaultSelection: opts.persist ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentSessionManager;
}

function getSettingSelect(title: string): HTMLSelectElement {
  const row = screen.getByText(title).parentElement?.parentElement;
  const select = row?.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${title} select was not rendered`);
  return select;
}

describe("AgentDefaultModelSetting", () => {
  it("persists a model-only change with agent-default effort, not the first option", () => {
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
    // Switching the model alone carries no effort choice, so effort resets to
    // the agent default (null) rather than silently adopting the new model's
    // first concrete effort or carrying over the stale "high".
    fireEvent.change(modelSelect, { target: { value: "sonnet" } });
    expect(persist).toHaveBeenCalledWith("opencode", { baseModelId: "sonnet", effort: null });
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

  it("represents an unset default as 'Agent default' with a disabled effort row", () => {
    const manager = makeManager({
      defaultSelection: null,
      effortByModel: { opus: [{ value: "high", label: "High" }] },
    });
    render(<AgentDefaultModelSetting descriptor={makeDescriptor()} manager={manager} />);
    // The model select shows the sentinel, not the first enabled model.
    expect(getSettingSelect("Default model").value).toBe("__agent_default__");
    // No concrete default → the agent picks effort, but the row keeps its layout space.
    expect(getSettingSelect("Default effort").disabled).toBe(true);
  });

  it("keeps the same effort row mounted while model support changes", () => {
    const descriptor = makeDescriptor();
    const supportedManager = makeManager({
      defaultSelection: { baseModelId: "opus", effort: null },
      effortByModel: { opus: [{ value: "high", label: "High" }] },
    });
    const unsupportedManager = makeManager({
      defaultSelection: { baseModelId: "sonnet", effort: null },
    });
    const { rerender } = render(
      <AgentDefaultModelSetting descriptor={descriptor} manager={supportedManager} />
    );

    const effortTitle = screen.getByText("Default effort");
    expect(getSettingSelect("Default effort").disabled).toBe(false);

    rerender(<AgentDefaultModelSetting descriptor={descriptor} manager={unsupportedManager} />);
    expect(screen.getByText("Default effort")).toBe(effortTitle);
    expect(getSettingSelect("Default effort").disabled).toBe(true);

    rerender(<AgentDefaultModelSetting descriptor={descriptor} manager={supportedManager} />);
    expect(screen.getByText("Default effort")).toBe(effortTitle);
    expect(getSettingSelect("Default effort").disabled).toBe(false);
  });

  it("selecting 'Agent default' clears the stored default", () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager({
      defaultSelection: { baseModelId: "opus", effort: "high" },
      effortByModel: { opus: [{ value: "high", label: "High" }] },
      persist,
    });
    render(<AgentDefaultModelSetting descriptor={makeDescriptor()} manager={manager} />);
    fireEvent.change(screen.getByDisplayValue("Opus"), {
      target: { value: "__agent_default__" },
    });
    expect(persist).toHaveBeenCalledWith("opencode", null);
  });

  it("hides the control only when there are no enabled models and no stored default", () => {
    const manager = makeManager({ defaultSelection: null });
    const { container } = render(
      <AgentDefaultModelSetting descriptor={makeDescriptor([])} manager={manager} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps a stored default visible (and clearable) after its model is disabled", () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager({
      defaultSelection: { baseModelId: "opus", effort: "high" },
      persist,
    });
    // The enable list no longer contains the stored default's model.
    render(<AgentDefaultModelSetting descriptor={makeDescriptor([])} manager={manager} />);
    // The stale default is shown as a disabled option, not hidden.
    expect(screen.getByDisplayValue("opus (disabled)")).not.toBeNull();
    fireEvent.change(screen.getByDisplayValue("opus (disabled)"), {
      target: { value: "__agent_default__" },
    });
    expect(persist).toHaveBeenCalledWith("opencode", null);
  });

  it("shows 'Agent default' effort for a null-effort default over a concrete-only catalog", () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager({
      // Stored model with effort explicitly unset (agent default).
      defaultSelection: { baseModelId: "opus", effort: null },
      // Catalog enumerates only concrete values, no null/unset option.
      effortByModel: {
        opus: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
      },
      persist,
    });
    render(<AgentDefaultModelSetting descriptor={makeDescriptor()} manager={manager} />);

    // The effort select reflects the unset state, not the first concrete option.
    const effortSelect = screen.getByDisplayValue("Agent default");
    expect(effortSelect).not.toBeNull();
    // Picking a concrete effort persists it against the same model.
    fireEvent.change(effortSelect, { target: { value: "high" } });
    expect(persist).toHaveBeenCalledWith("opencode", { baseModelId: "opus", effort: "high" });
  });
});
