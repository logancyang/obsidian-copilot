import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import { act, renderHook } from "@testing-library/react";
import type CopilotPlugin from "@/main";
import { installStateSignature, useBackendInstallStates } from "./useBackendInstallStates";

describe("useBackendInstallStates", () => {
  describe("useBackendInstallStates()", () => {
    it("observes readiness changes and releases descriptor subscriptions for https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      let state: InstallState = { kind: "absent" };
      let notify = () => {};
      const unsubscribe = jest.fn();
      const descriptors = [
        {
          id: "opencode",
          getInstallState: () => state,
          subscribeInstallState: (_plugin: CopilotPlugin, listener: () => void) => {
            notify = listener;
            return unsubscribe;
          },
        },
      ] as unknown as BackendDescriptor[];
      const plugin = {} as CopilotPlugin;
      const { result, unmount } = renderHook(() => useBackendInstallStates(plugin, descriptors));
      expect(result.current.opencode.kind).toBe("absent");
      act(() => {
        state = { kind: "ready", source: "managed" };
        notify();
      });
      expect(result.current.opencode.kind).toBe("ready");
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
  describe("installStateSignature()", () => {
    it("preserves readiness and diagnostic differences in subscription snapshots", () => {
      const states: InstallState[] = [
        { kind: "absent" },
        { kind: "checking", source: "custom" },
        { kind: "ready", source: "custom" },
        { kind: "error", message: "Cannot read binary" },
        { kind: "error", message: "Permission denied" },
        {
          kind: "incompatible",
          source: "custom",
          currentVersion: "1",
          minVersion: "2",
          message: "Upgrade required",
        },
      ];
      const signatures = states.map(installStateSignature);
      expect(new Set(signatures).size).toBe(states.length);
      expect(states.map((state) => installStateSignature({ ...state }))).toEqual(signatures);
    });
  });
});
