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

      it("uses block language for a persistent network rejection", () => {
        const option: PermissionOption = {
          optionId: "apply_network_policy_amendment:3",
          name: "Block api.example.com in the Future",
          kind: "reject_always",
        };

        expect(CodexBackendDescriptor.presentPermissionOption?.(option)).toEqual({
          optionId: "apply_network_policy_amendment:3",
          name: "Block Always",
          description: "Block api.example.com in the Future",
          kind: "reject_always",
        });
      });

      it.each(["allow_host_session", "apply_network_policy_amendment:not-an-index"])(
        "leaves the ordinary or near-match label for %s unchanged",
        (optionId) => {
          const option: PermissionOption = {
            optionId,
            name: "Allow Host for Session",
            kind: "allow_always",
          };

          expect(CodexBackendDescriptor.presentPermissionOption?.(option)).toBe(option);
        }
      );
    });
  });
});
