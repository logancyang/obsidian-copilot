import { isCommandName } from "@/agentMode/protocol/commands";

describe("commands", () => {
  describe("isCommandName()", () => {
    it.each([
      "send",
      "cancel",
      "resolvePermission",
      "answerQuestion",
      "resolvePlan",
      "createSession",
      "replaceSession",
      "openTab",
      "closeTab",
      "renameSession",
      "applySelection",
      "applyMode",
    ])("accepts the protocol command %s", (name) => {
      expect(isCommandName(name)).toBe(true);
    });

    it.each(["", "Send", "explode", "constructor", "__proto__", "toString", "hasOwnProperty"])(
      "rejects %j, which is not a protocol command",
      (name) => {
        expect(isCommandName(name)).toBe(false);
      }
    );
  });
});
