import type { AgentSession } from "./AgentSession";
import { MethodUnsupportedError } from "./errors";
import { replayPersistedMode } from "./replayPersistedMode";
import type { BackendState, CopilotMode } from "./types";

type ModeState = NonNullable<BackendState["mode"]>;

interface MockSessionParts {
  mode: ModeState | null;
  setMode?: jest.Mock;
  setModeConfigOption?: jest.Mock;
}

function makeSession({ mode, setMode, setModeConfigOption }: MockSessionParts): {
  session: AgentSession;
  setMode: jest.Mock;
  setModeConfigOption: jest.Mock;
} {
  const setModeMock = setMode ?? jest.fn().mockResolvedValue(undefined);
  const setModeConfigOptionMock = setModeConfigOption ?? jest.fn().mockResolvedValue(undefined);
  const session = {
    getState: (): BackendState => ({ model: null, mode }),
    setMode: setModeMock,
    setModeConfigOption: setModeConfigOptionMock,
  } as unknown as AgentSession;
  return { session, setMode: setModeMock, setModeConfigOption: setModeConfigOptionMock };
}

const modeState = (current: CopilotMode | null, apply: ModeState["apply"]): ModeState => ({
  current,
  options: [
    { value: "default", label: "Default" },
    { value: "plan", label: "Plan" },
    { value: "auto", label: "Auto" },
  ],
  apply,
});

describe("replayPersistedMode", () => {
  it("applies the persisted mode via setMode when it differs from current", async () => {
    const { session, setMode } = makeSession({
      mode: modeState("default", { auto: { kind: "setMode", nativeId: "bypassPermissions" } }),
    });
    await replayPersistedMode(session, "auto");
    expect(setMode).toHaveBeenCalledWith("bypassPermissions");
  });

  it("applies the persisted mode via setModeConfigOption for configOption-style backends", async () => {
    const { session, setModeConfigOption } = makeSession({
      mode: modeState("default", {
        plan: { kind: "setConfigOption", configId: "approval", value: "plan" },
      }),
    });
    await replayPersistedMode(session, "plan");
    expect(setModeConfigOption).toHaveBeenCalledWith("approval", "plan");
  });

  it("is a no-op when no mode is persisted", async () => {
    const { session, setMode } = makeSession({
      mode: modeState("default", { auto: { kind: "setMode", nativeId: "bypassPermissions" } }),
    });
    await replayPersistedMode(session, null);
    expect(setMode).not.toHaveBeenCalled();
  });

  it("is a no-op when the backend exposes no modes", async () => {
    const { session, setMode } = makeSession({ mode: null });
    await replayPersistedMode(session, "auto");
    expect(setMode).not.toHaveBeenCalled();
  });

  it("is a no-op when the session is already in the persisted mode", async () => {
    const { session, setMode } = makeSession({
      mode: modeState("auto", { auto: { kind: "setMode", nativeId: "bypassPermissions" } }),
    });
    await replayPersistedMode(session, "auto");
    expect(setMode).not.toHaveBeenCalled();
  });

  it("falls back to a no-op when the backend doesn't offer the persisted mode", async () => {
    // Persisted "auto" but this backend only advertises an apply spec for "plan".
    const { session, setMode, setModeConfigOption } = makeSession({
      mode: modeState("default", {
        plan: { kind: "setConfigOption", configId: "approval", value: "plan" },
      }),
    });
    await replayPersistedMode(session, "auto");
    expect(setMode).not.toHaveBeenCalled();
    expect(setModeConfigOption).not.toHaveBeenCalled();
  });

  it("swallows MethodUnsupportedError without throwing", async () => {
    const setMode = jest.fn().mockRejectedValue(new MethodUnsupportedError("session/set_mode"));
    const { session } = makeSession({
      mode: modeState("default", { auto: { kind: "setMode", nativeId: "bypassPermissions" } }),
      setMode,
    });
    await expect(replayPersistedMode(session, "auto")).resolves.toBeUndefined();
  });

  it("swallows unexpected apply errors without throwing", async () => {
    const setMode = jest.fn().mockRejectedValue(new Error("boom"));
    const { session } = makeSession({
      mode: modeState("default", { auto: { kind: "setMode", nativeId: "bypassPermissions" } }),
      setMode,
    });
    await expect(replayPersistedMode(session, "auto")).resolves.toBeUndefined();
  });
});
