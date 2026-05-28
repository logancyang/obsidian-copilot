import type { InstallState } from "@/agentMode/session/types";
import { installBadge } from "./installStatus";

describe("installBadge", () => {
  it("returns a green 'Ready' badge with a check for ready state", () => {
    const spec = installBadge({ kind: "ready", source: "managed" });
    expect(spec).toEqual({
      label: "Ready",
      variant: "outline",
      className: "tw-text-success",
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
});
