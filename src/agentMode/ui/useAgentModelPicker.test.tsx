import { ClientView } from "@/agentMode/protocol/ClientView";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import { type BackendSummary, type SessionState } from "@/agentMode/protocol/state";
import {
  buildBackendSummary,
  buildMessage,
  buildTab,
  FakeTransport,
} from "@/agentMode/protocol/testBuilders";
import type { BackendState } from "@/agentMode/session/types";
import {
  AgentPaneCapabilitiesProvider,
  NO_PANE_CAPABILITIES,
  type AgentPaneCapabilities,
} from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient, type FixtureClientOptions } from "@/agentMode/ui/agentPane.fixtures";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import { logError } from "@/logger";
import { act, renderHook } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("obsidian", () => ({ Notice: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn(), logWarn: jest.fn() }));

const GLOBAL = "__global__";

const claude = (overrides: Partial<BackendSummary> = {}) =>
  buildBackendSummary({
    id: "claude",
    displayName: "Claude Code",
    enabled: [
      { baseModelId: "opus", name: "Opus", missingKey: false },
      { baseModelId: "haiku", name: "Haiku", missingKey: false },
    ],
    reported: [
      { baseModelId: "opus", name: "Opus" },
      { baseModelId: "haiku", name: "Haiku" },
    ],
    efforts: { opus: [{ value: "high", label: "High" }] },
    ...overrides,
  });

const codex = (overrides: Partial<BackendSummary> = {}) =>
  buildBackendSummary({
    id: "codex",
    displayName: "Codex",
    enabled: [{ baseModelId: "gpt", name: "GPT", missingKey: false }],
    reported: [{ baseModelId: "gpt", name: "GPT" }],
    defaultSelection: { baseModelId: "gpt", effort: "low" },
    ...overrides,
  });

const claudeState: BackendState = {
  model: {
    current: { baseModelId: "opus", effort: null },
    availableModels: [
      {
        baseModelId: "opus",
        name: "Opus",
        provider: null,
        effortOptions: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
      },
    ],
    apply: { kind: "setModel" },
  },
  mode: null,
};

interface Rig {
  fixture: ReturnType<typeof createFixtureClient>;
  view: ClientView;
  persist: { setDefaultBackend: jest.Mock; persistDefaultMode: jest.Mock };
}

function rig(options: Partial<FixtureClientOptions> = {}, session: Partial<SessionState> = {}) {
  const fixture = createFixtureClient({
    sessionId: "s1",
    tab: { backendId: "claude" },
    host: { backends: [claude(), codex()] },
    session: { backendState: claudeState, ...session },
    ...options,
  });
  const view = new ClientView(GLOBAL);
  view.activate({ id: "s1", projectId: GLOBAL });
  const persist = { setDefaultBackend: jest.fn(), persistDefaultMode: jest.fn() };
  const capabilities: AgentPaneCapabilities = { ...NO_PANE_CAPABILITIES, persistDefaults: persist };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AgentPaneCapabilitiesProvider value={capabilities}>{children}</AgentPaneCapabilitiesProvider>
  );
  const hook = renderHook(() => useAgentModelPicker(fixture.client, view), { wrapper });
  return { fixture, view, persist, hook } as Rig & { hook: typeof hook };
}

const keyOf = (name: string, backendId: string) => `${backendId}:${name}|agent`;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useAgentModelPicker", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("useAgentModelPicker()", () => {
    it("returns null until the client has the host's state", () => {
      const transport = new FakeTransport();
      const client = new SessionClient(transport, { app: "1.0.0" });
      const { result } = renderHook(() => useAgentModelPicker(client, new ClientView(GLOBAL)));
      expect(result.current).toBeNull();
      transport.setOpen(true);
    });

    it("lists every ready agent's models and selects the model the shown session runs", () => {
      const { hook } = rig();
      const picker = hook.result.current!;
      expect(picker.models.map((m) => m.name)).toEqual(["opus", "haiku", "gpt"]);
      expect(picker.value).toBe(keyOf("opus", "claude"));
    });

    it("offers the shown model's effort levels from the session's own state", () => {
      const { hook } = rig();
      const effort = hook.result.current!.effort;
      expect(effort).toMatchObject({ value: null, disabled: false });
      expect(effort?.options.map((o) => o.value)).toEqual(["low", "high"]);
    });

    it("hides other agents once the shown session holds a conversation", () => {
      const { hook } = rig({}, { transcript: [buildMessage({ id: "m1" })] });
      expect(hook.result.current!.models.map((m) => m.name)).toEqual(["opus", "haiku"]);
    });

    it("applies a model pick on the shown session's agent and remembers the agent as the desktop default", async () => {
      const { hook, fixture, persist } = rig();
      hook.result.current!.onChange(keyOf("haiku", "claude"));
      await flush();
      expect(persist.setDefaultBackend).toHaveBeenCalledWith("claude");
      expect(fixture.commands).toEqual([
        { name: "applySelection", sessionId: "s1", backendId: "claude", baseModelId: "haiku" },
      ]);
    });

    it("does not send a model pick the agent cannot switch to while running", async () => {
      const { hook, fixture } = rig({ tab: { backendId: "claude", canSwitchModel: false } });
      hook.result.current!.onChange(keyOf("haiku", "claude"));
      await flush();
      expect(Notice).toHaveBeenCalledWith("This agent doesn't support runtime model switching.");
      expect(fixture.commands).toEqual([]);
    });

    it("tells the user when the host says the agent cannot switch", async () => {
      const { hook } = rig({
        onCommand: () => ({ ok: false, code: "unsupported", message: "no" }),
      });
      hook.result.current!.onChange(keyOf("haiku", "claude"));
      await flush();
      expect(Notice).toHaveBeenCalledWith("This agent doesn't support runtime model switching.");
    });

    it("swaps the shown session for one on another agent, seeded with the saved effort, then shows it and remembers the agent https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
      const { hook, fixture, view, persist } = rig({
        onCommand: (command) =>
          command.name === "applySelection"
            ? { ok: true, value: { sessionId: "s2" } }
            : { ok: true, value: undefined },
      });
      hook.result.current!.onChange(keyOf("gpt", "codex"));
      await flush();
      expect(fixture.commands).toEqual([
        {
          name: "applySelection",
          sessionId: "s1",
          backendId: "codex",
          baseModelId: "gpt",
          effort: "low",
        },
      ]);
      expect(view.getActiveTabId()).toBe("s2");
      expect(persist.setDefaultBackend).toHaveBeenCalledWith("codex");
    });

    it("starts a session on the picked agent when no session is shown", async () => {
      const { hook, fixture, view, persist } = rig({
        host: {
          backends: [claude(), codex()],
          tabs: [buildTab({ id: "s1", backendId: "claude" })],
        },
        onCommand: (command) =>
          command.name === "createSession"
            ? { ok: true, value: { sessionId: "fresh" } }
            : { ok: true, value: undefined },
      });
      act(() => view.clearActive());
      hook.result.current!.commitSelection!(keyOf("gpt", "codex"), "high");
      await flush();
      expect(fixture.commands).toEqual([
        {
          name: "createSession",
          backendId: "codex",
          projectId: GLOBAL,
          seedSelection: { baseModelId: "gpt", effort: "high" },
        },
      ]);
      expect(view.getActiveTabId()).toBe("fresh");
      expect(persist.setDefaultBackend).toHaveBeenCalledWith("codex");
    });

    it("keeps the shown tab and tells the user when starting the other agent fails", async () => {
      const { hook, view, persist } = rig({
        onCommand: () => ({ ok: false, code: "failed", message: "spawn failed" }),
      });
      hook.result.current!.onChange(keyOf("gpt", "codex"));
      await flush();
      expect(Notice).toHaveBeenCalledWith("Failed to start Codex. See console for details.");
      expect(logError).toHaveBeenCalled();
      expect(view.getActiveTabId()).toBe("s1");
      expect(persist.setDefaultBackend).not.toHaveBeenCalled();
    });

    it("stays quiet and keeps the default agent when the host says the chat can no longer change agents https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
      const { hook, view, persist } = rig({
        onCommand: () => ({ ok: false, code: "stale", message: "The chat has messages" }),
      });
      hook.result.current!.onChange(keyOf("gpt", "codex"));
      await flush();
      expect(Notice).not.toHaveBeenCalled();
      expect(view.getActiveTabId()).toBe("s1");
      expect(persist.setDefaultBackend).not.toHaveBeenCalled();
    });

    it("commits a model with an effort on the shown session's agent without touching the default agent", async () => {
      const { hook, fixture, persist } = rig();
      hook.result.current!.commitSelection!(keyOf("opus", "claude"), "high");
      await flush();
      expect(fixture.commands).toEqual([
        {
          name: "applySelection",
          sessionId: "s1",
          backendId: "claude",
          baseModelId: "opus",
          effort: "high",
        },
      ]);
      expect(persist.setDefaultBackend).not.toHaveBeenCalled();
    });

    it("changes only the effort from the effort control", async () => {
      const { hook, fixture } = rig();
      hook.result.current!.effort!.onChange("high");
      await flush();
      expect(fixture.commands).toEqual([
        { name: "applySelection", sessionId: "s1", backendId: "claude", effort: "high" },
      ]);
    });

    it("stays silent when the host answers an effort change with stale", async () => {
      const { hook } = rig({ onCommand: () => ({ ok: false, code: "stale", message: "moved" }) });
      hook.result.current!.effort!.onChange("high");
      await flush();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("says it could not resolve a row that is not an agent model", async () => {
      const { hook, fixture } = rig({
        host: {
          backends: [
            claude({
              lockedPreview: [
                {
                  name: "flash",
                  provider: "copilot-plus",
                  displayName: "Flash",
                  group: "Claude Code",
                  backendId: "claude",
                  needsLicense: true,
                },
              ],
            }),
          ],
        },
      });
      hook.result.current!.onChange("claude:flash|copilot-plus");
      await flush();
      expect(Notice).toHaveBeenCalledWith("Could not resolve a model id for this selection.");
      expect(fixture.commands).toEqual([]);
    });

    it("ignores a key that matches no row", async () => {
      const { hook, fixture } = rig();
      hook.result.current!.onChange("nope");
      hook.result.current!.commitSelection!("nope", null);
      await flush();
      expect(fixture.commands).toEqual([]);
    });

    it("keeps the same override while nothing it depends on changed", () => {
      const { hook } = rig();
      const first = hook.result.current;
      hook.rerender();
      expect(hook.result.current).toBe(first);
    });
  });
});
