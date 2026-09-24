import { applyModeSpec } from "@/agentMode/session/modeApply";

describe("modeApply", () => {
  describe("applyModeSpec()", () => {
    it("applies one native mode selection", async () => {
      const session = {
        setMode: jest.fn().mockResolvedValue(undefined),
        setConfigOption: jest.fn().mockResolvedValue(undefined),
      };

      await applyModeSpec(session, { kind: "setMode", nativeId: "agent" });

      expect(session.setMode).toHaveBeenCalledWith("agent");
      expect(session.setConfigOption).not.toHaveBeenCalled();
    });

    it("applies one configuration selection", async () => {
      const session = {
        setMode: jest.fn().mockResolvedValue(undefined),
        setConfigOption: jest.fn().mockResolvedValue(undefined),
      };

      await applyModeSpec(session, {
        kind: "setConfigOption",
        configId: "mode",
        value: "plan",
      });

      expect(session.setConfigOption).toHaveBeenCalledWith("mode", "plan");
      expect(session.setMode).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 applies the approval preset before Codex collaboration Plan", async () => {
      const order: string[] = [];
      const session = {
        setMode: jest.fn(async (value: string) => {
          order.push(`mode:${value}`);
        }),
        setConfigOption: jest.fn(async (id: string, value: string) => {
          order.push(`${id}:${value}`);
        }),
      };

      await applyModeSpec(session, {
        kind: "sequence",
        steps: [
          { kind: "setMode", nativeId: "agent" },
          { kind: "setConfigOption", configId: "collaboration_mode", value: "plan" },
        ],
      });

      expect(order).toEqual(["mode:agent", "collaboration_mode:plan"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 stops before entering Plan when the approval preset fails", async () => {
      const session = {
        setMode: jest.fn().mockRejectedValue(new Error("mode rejected")),
        setConfigOption: jest.fn().mockResolvedValue(undefined),
      };

      await expect(
        applyModeSpec(session, {
          kind: "sequence",
          steps: [
            { kind: "setMode", nativeId: "agent" },
            { kind: "setConfigOption", configId: "collaboration_mode", value: "plan" },
          ],
        })
      ).rejects.toThrow("mode rejected");
      expect(session.setConfigOption).not.toHaveBeenCalled();
    });
  });
});
