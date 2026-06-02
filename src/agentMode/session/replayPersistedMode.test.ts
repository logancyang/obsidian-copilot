import type { AgentSession } from "./AgentSession";
import { MethodUnsupportedError } from "./errors";
import { replayPersistedMode } from "./replayPersistedMode";
import type { BackendState, CopilotMode } from "./types";

type ModeState = NonNullable<BackendState["mode"]>;

interface MockSessionParts {
  mode: ModeState | null;
  setMode?: jest.Mock;
  setConfigOption?: jest.Mock;
}

function makeSession({ mode, setMode, setConfigOption }: MockSessionParts): {
  session: AgentSession;
  setMode: jest.Mock;
  setConfigOption: jest.Mock;
} {
  const setModeMock = setMode ?? jest.fn().mockResolvedValue(undefined);
  const setConfigOptionMock = setConfigOption ?? jest.fn().mockResolvedValue(undefined);
  const session = {
    getState: (): BackendState => ({ model: null, mode }),
    setMode: setModeMock,
    setConfigOption: setConfigOptionMock,
  } as unknown as AgentSession;
  return { session, setMode: setModeMock, setConfigOption: setConfigOptionMock };
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

  it("applies the persisted mode via setConfigOption for configOption-style backends", async () => {
    const { session, setConfigOption } = makeSession({
      mode: modeState("default", {
        plan: { kind: "setConfigOption", configId: "approval", value: "plan" },
      }),
    });
    await replayPersistedMode(session, "plan");
    expect(setConfigOption).toHaveBeenCalledWith("approval", "plan");
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
    const { session, setMode, setConfigOption } = makeSession({
      mode: modeState("default", {
        plan: { kind: "setConfigOption", configId: "approval", value: "plan" },
      }),
    });
    await replayPersistedMode(session, "auto");
    expect(setMode).not.toHaveBeenCalled();
    expect(setConfigOption).not.toHaveBeenCalled();
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
