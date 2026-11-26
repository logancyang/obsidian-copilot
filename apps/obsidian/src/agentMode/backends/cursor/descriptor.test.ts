import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type { CopilotSettings } from "@/settings/model";
import { CursorBackendDescriptor } from "./descriptor";
import { resolveCursorBinary } from "./cursorBinaryResolver";

jest.mock("./cursorBinaryResolver", () => ({
  resolveCursorBinary: jest.fn(),
  cursorBinarySearchDirs: jest.fn(() => []),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const settings = { agentMode: { backends: { cursor: {} } } } as unknown as CopilotSettings;

describe("descriptor", () => {
  describe("CursorBackendDescriptor", () => {
    beforeEach(() => {
      jest.mocked(resolveCursorBinary).mockReset();
    });

    describe("prefetchEffortCatalog", () => {
      it("does not switch through every Cursor model before a chat opens (https://github.com/logancyang/obsidian-copilot/issues/4671)", () => {
        expect(CursorBackendDescriptor.prefetchEffortCatalog).toBeUndefined();
      });
    });

    describe("getInstallState()", () => {
      it("is ready when a Cursor installation is found", () => {
        jest.mocked(resolveCursorBinary).mockReturnValue("/home/me/.local/bin/agent");
        expect(CursorBackendDescriptor.getInstallState(settings)).toEqual({
          kind: "ready",
          source: "custom",
        });
      });

      it("is absent when no Cursor installation is found", () => {
        jest.mocked(resolveCursorBinary).mockReturnValue(null);
        expect(CursorBackendDescriptor.getInstallState(settings)).toEqual({ kind: "absent" });
      });
    });

    describe("getModeMapping()", () => {
      it("offers Default, Plan, and Auto from the modes Cursor advertises", () => {
        const state = translateBackendState(
          {
            models: null,
            modes: {
              currentModeId: "plan",
              availableModes: [
                { id: "ask", name: "Ask" },
                { id: "plan", name: "Plan" },
                { id: "agent", name: "Agent" },
              ],
            },
            configOptions: null,
          },
          CursorBackendDescriptor
        );
        expect(state.mode?.current).toBe("plan");
      });
    });

    describe("getEnabledModelEntries()", () => {
      it("lists enabled Cursor models by the id Cursor reports", () => {
        const configured = {
          backends: { cursor: { enabledModels: ["cm-1"] } },
          configuredModels: [
            {
              configuredModelId: "cm-1",
              providerId: "cursor",
              info: { id: "composer-2", displayName: "Composer 2" },
              configuredAt: 0,
            },
          ],
        } as unknown as CopilotSettings;

        expect(CursorBackendDescriptor.getEnabledModelEntries?.(configured)).toEqual([
          expect.objectContaining({ baseModelId: "composer-2", name: "Composer 2" }),
        ]);
      });

      it("reuses one empty list when Cursor has no enabled models", () => {
        const empty = {
          backends: { cursor: { enabledModels: [] } },
          configuredModels: [],
        } as unknown as CopilotSettings;
        const first = CursorBackendDescriptor.getEnabledModelEntries?.(empty);
        const second = CursorBackendDescriptor.getEnabledModelEntries?.(empty);
        expect(first).toEqual([]);
        expect(first).toBe(second);
      });
    });

    describe("applySelection()", () => {
      it("sets the bare model id, then that model's effort when Cursor offers one", async () => {
        const session = {
          modelId: "composer-2",
          getState() {
            return {
              model: {
                current: { baseModelId: this.modelId, effort: null },
                availableModels: [
                  {
                    baseModelId: "composer-2",
                    name: "Composer 2",
                    provider: null,
                    effortOptions: [],
                  },
                  {
                    baseModelId: "gpt",
                    name: "GPT",
                    provider: null,
                    effortOptions: [{ value: "high", label: "High" }],
                  },
                ],
                apply: {
                  kind: "setConfigOption" as const,
                  configId: "model",
                  effortConfigId: "effort",
                },
              },
              mode: null,
            };
          },
          applyModelWireId: jest.fn(async (id: string) => {
            session.modelId = id;
          }),
          setConfigOption: jest.fn(),
        };

        await CursorBackendDescriptor.applySelection(session, {
          baseModelId: "gpt",
          effort: "high",
        });

        expect(session.applyModelWireId).toHaveBeenCalledWith("gpt");
        expect(session.setConfigOption).toHaveBeenCalledWith("effort", "high");
      });
    });
  });
});
