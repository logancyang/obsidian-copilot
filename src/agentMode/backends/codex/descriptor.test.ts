import type { PermissionOption } from "@/agentMode/session/types";
import { CodexBackendDescriptor } from "./descriptor";

describe("descriptor", () => {
  describe("CodexBackendDescriptor", () => {
    describe("presentPermissionOption()", () => {
      it.each([
        "accept_execpolicy_amendment",
        "apply_network_policy_amendment:0",
        "apply_network_policy_amendment:12",
      ])("separates the Codex policy rule for %s", (optionId) => {
        const rule = "Allow network access to api.example.com";
        const option: PermissionOption = {
          optionId,
          name: rule,
          kind: "allow_always",
        };

        expect(CodexBackendDescriptor.presentPermissionOption?.(option)).toEqual({
          optionId,
          name: "Allow Always",
          description: rule,
          kind: "allow_always",
        });
      });

      it("leaves ordinary Codex permission labels unchanged", () => {
        const option: PermissionOption = {
          optionId: "allow_host_session",
          name: "Allow Host for Session",
          kind: "allow_always",
        };

        expect(CodexBackendDescriptor.presentPermissionOption?.(option)).toBe(option);
      });
    });
  });
});
