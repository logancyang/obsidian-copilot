import type { InstallState } from "@/agentMode/session/types";
import { installBadge } from "./installStatus";

describe("installStatus", () => {
  describe("installBadge()", () => {
    it("returns a green 'Ready' badge with a check for ready state", () => {
      const spec = installBadge({ kind: "ready", source: "managed" });
      expect(spec).toEqual({
        label: "Ready",
        variant: "success",
        showCheck: true,
      });
    });

    it("ignores source — custom and managed both read 'Ready' (no path/source on the card)", () => {
      expect(installBadge({ kind: "ready", source: "custom" })?.label).toBe("Ready");
      expect(installBadge({ kind: "ready", source: "managed" })?.label).toBe("Ready");
    });

    it("returns null for absent state — the missing badge is the 'not configured' signal", () => {
      expect(installBadge({ kind: "absent" })).toBeNull();
    });

    it("returns a destructive 'Error' badge carrying the message as a tooltip", () => {
      const state: InstallState = { kind: "error", message: "boom" };
      expect(installBadge(state)).toEqual({
        label: "Error",
        variant: "destructive",
        title: "boom",
      });
    });

    it("returns a shared incompatible-version badge with the requirement as a tooltip", () => {
      const state: InstallState = {
        kind: "incompatible",
        source: "custom",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message: "Claude Code 2.1.205 is not supported.",
      };
      expect(installBadge(state)).toEqual({
        label: "Incompatible version",
        variant: "destructive",
        title: state.message,
      });
    });

    it("returns a neutral checking badge while compatibility is being probed", () => {
      expect(installBadge({ kind: "checking", source: "managed" })).toEqual({
        label: "Checking…",
        variant: "outline",
      });
    });
  });
});
