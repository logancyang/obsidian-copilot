import {
  companionCompatibility,
  companionRuntimeConfigKey,
  companionInvocation,
  companionModeMapping,
} from "./companionPolicy";

describe("companionPolicy", () => {
  describe("companionRuntimeConfigKey()", () => {
    it("does not restart a backend merely because its model preference changed", () => {
      expect(
        companionRuntimeConfigKey({
          binaryPath: "/cli",
          defaultModel: { baseModelId: "one", effort: null },
        })
      ).toBe(
        companionRuntimeConfigKey({
          binaryPath: "/cli",
          defaultModel: { baseModelId: "two", effort: "high" },
        })
      );
    });
    it("detects revoked consent and changed local environment", () => {
      expect(companionRuntimeConfigKey({ automaticToolsConsent: true })).not.toBe(
        companionRuntimeConfigKey({ automaticToolsConsent: false })
      );
      expect(companionRuntimeConfigKey({ envOverrides: { HTTP_PROXY: "one" } })).not.toBe(
        companionRuntimeConfigKey({ envOverrides: { HTTP_PROXY: "two" } })
      );
    });
  });
  describe("companionInvocation()", () => {
    it("passes an executable path with spaces as one argument", () => {
      expect(companionInvocation("C:\\My Agents\\grok.exe", ["agent", "stdio"], "win32")).toEqual({
        command: "C:\\My Agents\\grok.exe",
        args: ["agent", "stdio"],
      });
    });
    it("wraps Windows command shims without concatenating arguments", () => {
      expect(companionInvocation("C:\\My Agents\\muse.cmd", ["login"], "win32")).toEqual({
        command: "cmd.exe",
        args: ["/d", "/c", "C:\\My Agents\\muse.cmd", "login"],
      });
    });
    it("runs POSIX launchers directly", () => {
      expect(companionInvocation("/home/user/muse", ["serve"], "linux").command).toBe(
        "/home/user/muse"
      );
    });
  });
  describe("companionCompatibility()", () => {
    it("accepts Grok at its supported floor", () =>
      expect(companionCompatibility("grok", "grok 0.2.117", "win32")).toBeNull());
    it("rejects the broken Windows stdio range", () =>
      expect(companionCompatibility("grok", "grok 0.2.66", "win32")).toMatch(/broken stdio/));
    it("rejects versions below the supported Grok baseline", () =>
      expect(companionCompatibility("grok", "grok 0.2.116", "linux")).toMatch(/required/));
    it("accepts an Antigravity numeric version", () =>
      expect(companionCompatibility("antigravity", "1.2.14", "win32")).toBeNull());
    it("rejects unrecognized version output", () =>
      expect(companionCompatibility("muse", "unknown", "darwin")).toMatch(/recognizable/));
  });
  describe("companionModeMapping()", () => {
    it("maps the Grok adapter's Agent, Plan and YOLO modes to Default, Plan and Auto", () => {
      expect(
        companionModeMapping("grok", [{ id: "default" }, { id: "plan" }, { id: "yolo" }]).canonical
      ).toEqual({ default: "default", plan: "plan", auto: "yolo" });
    });
    it("never advertises Muse Plan mode even if a server claims it", () => {
      expect(
        companionModeMapping("muse", [{ id: "agent" }, { id: "yolo" }, { id: "plan" }]).canonical
      ).toEqual({ default: "agent", auto: "yolo" });
    });
    it("shows Antigravity automatic tools without a request-every-tool mode", () => {
      expect(
        companionModeMapping("antigravity", [{ id: "agent" }, { id: "plan" }]).canonical
      ).toEqual({ auto: "agent", plan: "plan" });
    });
    it("only maps modes the Grok server advertises", () => {
      expect(companionModeMapping("grok", [{ id: "default" }]).canonical).toEqual({
        default: "default",
        auto: undefined,
        plan: undefined,
      });
    });
  });
});
