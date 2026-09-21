import {
  assertBackendCompatible,
  type BackendDescriptor,
  type InstallState,
} from "@/agentMode/session/descriptor";
import type { CopilotSettings } from "@/settings/model";

describe("descriptor", () => {
  describe("assertBackendCompatible()", () => {
    it("COMPATIBILITY_ISSUE rejects an old process even when the selected installation is ready", () => {
      const descriptor = { getInstallState: () => ({ kind: "ready", source: "managed" }) as const };
      const process = {
        assertCompatible: () => {
          throw new Error("Old process requires upgrade");
        },
      };
      expect(() => assertBackendCompatible(descriptor, {} as CopilotSettings, process)).toThrow(
        "Old process requires upgrade"
      );
    });

    it("COMPATIBILITY_ISSUE permits a supported process independently of a different incompatible selection", () => {
      const descriptor = {
        getInstallState: () =>
          ({
            kind: "incompatible",
            source: "managed",
            currentVersion: "1",
            minVersion: "2",
            message: "Selected binary too old",
          }) as const,
      };
      expect(() =>
        assertBackendCompatible(descriptor, {} as CopilotSettings, {
          assertCompatible: () => undefined,
        })
      ).not.toThrow();
    });

    it("allows a supported descriptor and a session without a descriptor", () => {
      const settings = {} as CopilotSettings;
      const descriptor: Pick<BackendDescriptor, "getInstallState"> = {
        getInstallState: () => ({ kind: "ready", source: "custom" }),
      };
      expect(() => assertBackendCompatible(descriptor, settings)).not.toThrow();
      expect(() => assertBackendCompatible(undefined, settings)).not.toThrow();
    });

    it("rejects an incompatible install with its upgrade requirement (https://github.com/Brevilabs/obsidian-copilot-private/issues/531)", () => {
      const state: InstallState = {
        kind: "incompatible",
        source: "custom",
        currentVersion: "1",
        minVersion: "2",
        message: "Upgrade to version 2",
      };
      const descriptor = { getInstallState: () => state };
      expect(() => assertBackendCompatible(descriptor, {} as CopilotSettings)).toThrow(
        "Upgrade to version 2"
      );
    });
  });
});
