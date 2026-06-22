import type { AgentSession } from "@/agentMode/session/AgentSession";
import {
  PERMISSION_OPTION_KINDS,
  type AgentToolKind,
  type PermissionPrompt,
} from "@/agentMode/session/types";
import { createDefaultPermissionPrompter } from "./permissionPrompter";

function promptFor(sessionId: string, kind: AgentToolKind): PermissionPrompt {
  return {
    sessionId,
    toolCall: { toolCallId: "t1", title: "tool", kind, status: "pending" },
    options: PERMISSION_OPTION_KINDS.map((k) => ({ optionId: k, name: k, kind: k })),
  };
}

describe("createDefaultPermissionPrompter — read-only fan-out policy", () => {
  it("allows read/search/fetch tools for a read-only fan-out sub-session without a card", async () => {
    const handleToolPermission = jest.fn();
    const session = { handleToolPermission } as unknown as AgentSession;
    const prompter = createDefaultPermissionPrompter(
      () => session,
      (id) => id === "ro-session"
    );

    for (const kind of ["read", "search", "fetch"] as AgentToolKind[]) {
      const decision = await prompter(promptFor("ro-session", kind));
      expect(decision.outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
    }
    // Never routed to a visible session card.
    expect(handleToolPermission).not.toHaveBeenCalled();
  });

  it("denies write/exec tools for a read-only fan-out sub-session", async () => {
    const prompter = createDefaultPermissionPrompter(
      () => null,
      () => true
    );
    // `other` is an unknown/MCP tool that can't be verified read-only, so it
    // is denied too (fail-safe), alongside the write/exec kinds.
    for (const kind of ["edit", "delete", "move", "execute", "other"] as AgentToolKind[]) {
      const decision = await prompter(promptFor("ro-session", kind));
      expect(decision.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
      expect(decision.denyMessage).toContain("Read-only");
    }
  });

  it("routes a normal (non-fan-out) session to its inline permission card", async () => {
    const handleToolPermission = jest.fn().mockResolvedValue({ outcome: { outcome: "cancelled" } });
    const session = { handleToolPermission } as unknown as AgentSession;
    const prompter = createDefaultPermissionPrompter(
      () => session,
      () => false
    );
    await prompter(promptFor("normal", "edit"));
    expect(handleToolPermission).toHaveBeenCalledTimes(1);
  });
});
