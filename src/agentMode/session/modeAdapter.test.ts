import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import {
  buildModeAdapter,
  type CopilotMode,
  type ModeApplyContext,
  type ModeMapping,
} from "./modeAdapter";
import { noopBackendMetaParser } from "./backendMeta";
import type { BackendDescriptor } from "./types";

function stubDescriptor(getModeMapping: BackendDescriptor["getModeMapping"]): BackendDescriptor {
  return {
    id: "stub",
    displayName: "Stub",
    meta: noopBackendMetaParser,
    getInstallState: () => ({ kind: "absent" }),
    subscribeInstallState: () => () => {},
    openInstallUI: () => {},
    createBackendProcess: (() => {
      throw new Error("not used in tests");
    }) as unknown as BackendDescriptor["createBackendProcess"],
    getModeMapping,
  };
}

function makeApplyCtx(): ModeApplyContext & {
  setSessionMode: jest.Mock;
  setSessionConfigOption: jest.Mock;
  persistMode: jest.Mock;
} {
  return {
    setSessionMode: jest.fn(async () => {}),
    setSessionConfigOption: jest.fn(async () => {}),
    persistMode: jest.fn(async () => {}),
  };
}

function modeState(currentModeId: string, available: string[]): SessionModeState {
  return {
    currentModeId,
    availableModes: available.map((id) => ({ id, name: id })),
  };
}

function selectOption(id: string, currentValue: string, values: string[]): SessionConfigOption {
  return {
    id,
    type: "select",
    name: id,
    currentValue,
    options: values.map((v) => ({ value: v, name: v })),
  } as SessionConfigOption;
}

describe("buildModeAdapter — setMode kind (Claude/Codex style)", () => {
  it("filters canonical options to those advertised by the agent", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "setMode",
        canonical: { default: "default", plan: "plan", auto: "bypassPermissions" },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: modeState("default", ["default", "plan"]), // bypassPermissions absent
      configOptions: null,
    });
    expect(adapter).not.toBeNull();
    expect(adapter!.options.map((o) => o.value)).toEqual(["default", "plan"]);
    expect(adapter!.currentValue).toBe("default");
  });

  it("returns null when no canonical option resolves", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "setMode",
        canonical: { default: "auto", auto: "full-access" },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: modeState("read-only", ["read-only"]),
      configOptions: null,
    });
    expect(adapter).toBeNull();
  });

  it("returns null currentValue when agent sits in an unmapped mode", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "setMode",
        canonical: { default: "default", plan: "plan" },
      })
    );
    const adapter = buildModeAdapter(desc, {
      // acceptEdits is intentionally hidden — currentValue should fall back to null.
      modeState: modeState("acceptEdits", ["default", "plan", "acceptEdits"]),
      configOptions: null,
    });
    expect(adapter).not.toBeNull();
    expect(adapter!.currentValue).toBeNull();
  });

  it("orders options canonically: default → plan → auto", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "setMode",
        canonical: { auto: "bypassPermissions", default: "default", plan: "plan" },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: modeState("default", ["default", "plan", "bypassPermissions"]),
      configOptions: null,
    });
    expect(adapter!.options.map((o) => o.value)).toEqual(["default", "plan", "auto"]);
  });

  it("applyMode dispatches to setSessionMode and persists", async () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "setMode",
        canonical: { default: "default", plan: "plan", auto: "bypassPermissions" },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: modeState("default", ["default", "plan", "bypassPermissions"]),
      configOptions: null,
    })!;
    const ctx = makeApplyCtx();
    await adapter.applyMode("plan" as CopilotMode, ctx);
    expect(ctx.setSessionMode).toHaveBeenCalledWith("plan");
    expect(ctx.persistMode).toHaveBeenCalledWith("plan");
    expect(ctx.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it("returns null when modeState is null", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "setMode",
        canonical: { default: "default" },
      })
    );
    expect(buildModeAdapter(desc, { modeState: null, configOptions: null })).toBeNull();
  });
});

describe("buildModeAdapter — configOption kind (OpenCode style)", () => {
  it("filters canonical options to those present in the mode select", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "configOption",
        configId: "mode",
        canonical: {
          default: "copilot-build",
          plan: "plan",
          auto: "build",
        },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: null,
      configOptions: [selectOption("mode", "copilot-build", ["copilot-build", "plan", "build"])],
    });
    expect(adapter).not.toBeNull();
    expect(adapter!.options.map((o) => o.value)).toEqual(["default", "plan", "auto"]);
    expect(adapter!.currentValue).toBe("default");
  });

  it("hides canonical options whose native id isn't offered yet", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "configOption",
        configId: "mode",
        canonical: {
          default: "copilot-build",
          plan: "plan",
          auto: "build",
        },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: null,
      configOptions: [selectOption("mode", "build", ["build", "plan"])],
    });
    expect(adapter!.options.map((o) => o.value)).toEqual(["plan", "auto"]);
  });

  it("applyMode dispatches to setSessionConfigOption and persists", async () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "configOption",
        configId: "mode",
        canonical: {
          default: "copilot-build",
          auto: "build",
        },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: null,
      configOptions: [selectOption("mode", "copilot-build", ["copilot-build", "build"])],
    })!;
    const ctx = makeApplyCtx();
    await adapter.applyMode("auto" as CopilotMode, ctx);
    expect(ctx.setSessionConfigOption).toHaveBeenCalledWith("mode", "build");
    expect(ctx.persistMode).toHaveBeenCalledWith("auto");
    expect(ctx.setSessionMode).not.toHaveBeenCalled();
  });

  it("returns null when configOption isn't present", () => {
    const desc = stubDescriptor(
      (): ModeMapping => ({
        kind: "configOption",
        configId: "mode",
        canonical: { default: "copilot-build" },
      })
    );
    const adapter = buildModeAdapter(desc, {
      modeState: null,
      configOptions: [selectOption("effort", "medium", ["low", "medium", "high"])],
    });
    expect(adapter).toBeNull();
  });
});

describe("buildModeAdapter — descriptor with no mapping", () => {
  it("returns null when descriptor doesn't expose getModeMapping", () => {
    const desc: BackendDescriptor = {
      id: "stub",
      displayName: "Stub",
      meta: noopBackendMetaParser,
      getInstallState: () => ({ kind: "absent" }),
      subscribeInstallState: () => () => {},
      openInstallUI: () => {},
      createBackendProcess: (() => {
        throw new Error("not used in tests");
      }) as unknown as BackendDescriptor["createBackendProcess"],
    };
    expect(
      buildModeAdapter(desc, {
        modeState: modeState("default", ["default"]),
        configOptions: null,
      })
    ).toBeNull();
  });

  it("returns null when getModeMapping returns null", () => {
    const desc = stubDescriptor(() => null);
    expect(
      buildModeAdapter(desc, {
        modeState: modeState("default", ["default"]),
        configOptions: null,
      })
    ).toBeNull();
  });
});
