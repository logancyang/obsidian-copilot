import { claudeUpdateDetail } from "@/agentMode/backends/claude/claudeUpdateDetail";

describe("claudeUpdateDetail", () => {
  describe("claudeUpdateDetail()", () => {
    it("directs a custom-path user to update or clear the saved override", () => {
      expect(
        claudeUpdateDetail({
          kind: "incompatible",
          source: "custom",
          currentVersion: "2.1.205",
          minVersion: "2.1.206",
          message: "Update Claude Code.",
        })
      ).toBe(
        "Update the binary at the saved path, or clear the override to use an auto-detected installation."
      );
    });

    it("keeps the install-command recovery for an auto-detected installation", () => {
      expect(
        claudeUpdateDetail({
          kind: "incompatible",
          source: "managed",
          currentVersion: "2.1.205",
          minVersion: "2.1.206",
          message: "Update Claude Code.",
        })
      ).toBe("Update it with the install command below, then reopen this dialog.");
    });
  });
});
