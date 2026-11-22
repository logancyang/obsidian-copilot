import { backendRegistry } from "@/agentMode/backends/registry";
import { chatBackendIcon } from "@/agentMode/ui/chatBackendIcon";
import { MessageCircle } from "lucide-react";

describe("chatBackendIcon", () => {
  describe("chatBackendIcon()", () => {
    it("returns the logo of the agent that runs the chat", () => {
      expect(chatBackendIcon({ backendId: "codex" })).toBe(backendRegistry.codex.Icon);
    });

    it("falls back to a generic chat bubble when the chat names no agent", () => {
      expect(chatBackendIcon({})).toBe(MessageCircle);
    });

    it("falls back to a generic chat bubble when the chat names an agent Copilot no longer ships", () => {
      expect(chatBackendIcon({ backendId: "retired-agent" })).toBe(MessageCircle);
    });
  });
});
