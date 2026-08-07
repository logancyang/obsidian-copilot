import type { ActivityMember } from "@/agentMode/ui/activityGroups";
import { activityLiveStep, isReasoningActive } from "@/agentMode/ui/activityLiveStep";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

function action(id: string, overrides: Partial<ToolCallPart> = {}): ActivityMember {
  return {
    type: "action",
    part: { kind: "tool_call", id, title: id, status: "completed", ...overrides },
  };
}

const REASONING: ActivityMember = { type: "reasoning", part: { kind: "thought", text: "…" } };

describe("activityLiveStep", () => {
  describe("isReasoningActive()", () => {
    it("is true only for a trailing thought on a streaming trail", () => {
      expect(isReasoningActive([action("a"), REASONING], true)).toBe(true);
      expect(isReasoningActive([action("a"), REASONING], false)).toBe(false);
      expect(isReasoningActive([REASONING, action("a")], true)).toBe(false);
      expect(isReasoningActive([], true)).toBe(false);
    });
  });

  describe("activityLiveStep()", () => {
    it("names the reasoning in flight when the group's trailing member is a thought", () => {
      expect(activityLiveStep([action("a"), REASONING], true)).toBe("Reasoning");
    });

    it("labels the unfinished tool call with the tool's own collapsed line", () => {
      const members = [
        action("a", { vendorToolName: "Read", input: { file_path: "Inbox/Clippings.md" } }),
        REASONING,
        action("b", { vendorToolName: "Bash", status: "in_progress", input: { command: "npm t" } }),
      ];

      expect(activityLiveStep(members, true)).toBe("Running `npm t`");
    });

    it("prefers the latest unsettled call when parallel calls resolve out of order", () => {
      const members = [
        action("a", { vendorToolName: "Bash", status: "pending", input: { command: "npm run a" } }),
        action("b", { vendorToolName: "Bash", status: "pending", input: { command: "npm run b" } }),
        action("c", { vendorToolName: "Bash", input: { command: "npm run c" } }),
      ];

      expect(activityLiveStep(members, true)).toBe("Running `npm run b`");
    });

    it("goes quiet once the group has nothing left in flight", () => {
      const settled = [action("a", { vendorToolName: "Read" }), action("b", { status: "failed" })];

      expect(activityLiveStep(settled, true)).toBeNull();
      expect(activityLiveStep([], true)).toBeNull();
    });

    it("shows nothing at all once the trail has stopped streaming", () => {
      const members = [
        action("a", { vendorToolName: "Bash", status: "in_progress", input: { command: "npm t" } }),
        REASONING,
      ];

      expect(activityLiveStep(members, false)).toBeNull();
    });

    it("shortens the label's vault path through the supplied context", () => {
      const members = [
        action("a", {
          vendorToolName: "Read",
          status: "in_progress",
          input: { file_path: "/vault/Notes/Inbox.md" },
        }),
      ];

      expect(activityLiveStep(members, true, { vaultBase: "/vault" })).toBe(
        "Reading Notes/Inbox.md"
      );
    });
  });
});
