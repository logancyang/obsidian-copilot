import { useAgentSetupProblems } from "@/agents/agentMode/useAgentSetupProblems";
import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import type { EnabledModelEntry, InstallState } from "@/agentMode/session/types";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import type CopilotPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import { act, renderHook } from "@testing-library/react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";
const PLUGIN = {} as CopilotPlugin;

type Agent = Pick<CustomAgent, "slug" | "model">;

const LEO: Agent = { slug: "leo", model: { baseModelId: "opencode/big-pickle", effort: null } };
const MAYA: Agent = { slug: "maya", model: { baseModelId: "haiku", effort: null } };

function deviceWithOpencode(initial: InstallState) {
  let opencode = initial;
  let notify = () => {};
  const entry = (baseModelId: string) =>
    ({ baseModelId, name: baseModelId, credentialState: "ok" }) as EnabledModelEntry;
  jest
    .spyOn(OpencodeBackendDescriptor, "getEnabledModelEntries")
    .mockReturnValue([entry("opencode/big-pickle")]);
  jest.spyOn(ClaudeBackendDescriptor, "getEnabledModelEntries").mockReturnValue([entry("haiku")]);
  jest.spyOn(CodexBackendDescriptor, "getEnabledModelEntries").mockReturnValue([]);
  jest.spyOn(OpencodeBackendDescriptor, "getInstallState").mockImplementation(() => opencode);
  jest
    .spyOn(ClaudeBackendDescriptor, "getInstallState")
    .mockReturnValue({ kind: "ready", source: "custom" });
  jest.spyOn(CodexBackendDescriptor, "getInstallState").mockReturnValue({ kind: "absent" });
  jest.spyOn(OpencodeBackendDescriptor, "subscribeInstallState").mockImplementation((_, cb) => {
    notify = cb;
    return () => {};
  });
  jest.spyOn(ClaudeBackendDescriptor, "subscribeInstallState").mockReturnValue(() => {});
  jest.spyOn(CodexBackendDescriptor, "subscribeInstallState").mockReturnValue(() => {});
  return {
    install: (next: InstallState) => {
      opencode = next;
      act(() => notify());
    },
  };
}

describe("useAgentSetupProblems", () => {
  beforeEach(() => resetSettings());
  afterEach(() => jest.restoreAllMocks());

  describe("useAgentSetupProblems()", () => {
    it(`lists only the agents whose model can't run on this device, with the reason (${ISSUE})`, () => {
      deviceWithOpencode({ kind: "absent" });

      const { result } = renderHook(() => useAgentSetupProblems(PLUGIN, [LEO, MAYA]));

      expect([...result.current]).toEqual([
        ["leo", { kind: "coding_agent", backendId: "opencode" }],
      ]);
    });

    it(`unlocks an agent as soon as its coding agent is set up, without a reload (${ISSUE})`, () => {
      const device = deviceWithOpencode({ kind: "absent" });
      const { result } = renderHook(() => useAgentSetupProblems(PLUGIN, [LEO, MAYA]));

      device.install({ kind: "ready", source: "managed" });

      expect(result.current.size).toBe(0);
    });

    it(`unlocks an agent as soon as its model changes to one that runs here (${ISSUE})`, () => {
      deviceWithOpencode({ kind: "absent" });
      const { result, rerender } = renderHook(
        ({ agents }: { agents: Agent[] }) => useAgentSetupProblems(PLUGIN, agents),
        { initialProps: { agents: [LEO] } }
      );
      expect(result.current.has("leo")).toBe(true);

      rerender({ agents: [{ ...LEO, model: MAYA.model }] });

      expect(result.current.has("leo")).toBe(false);
    });

    it("returns the same empty answer while every agent runs here, so views that depend on it keep still", () => {
      deviceWithOpencode({ kind: "ready", source: "managed" });
      const { result, rerender } = renderHook(
        ({ agents }: { agents: Agent[] }) => useAgentSetupProblems(PLUGIN, agents),
        { initialProps: { agents: [LEO] } }
      );
      const first = result.current;

      rerender({ agents: [MAYA] });

      expect(result.current).toBe(first);
    });
  });
});
