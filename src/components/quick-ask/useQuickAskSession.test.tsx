import { act, renderHook } from "@testing-library/react";
import { useQuickAskSession } from "./useQuickAskSession";
import { useResolvedChatBackendModel } from "@/hooks/useResolvedChatBackendModel";

const mockModel = {
  name: "selected",
  configuredModelId: "selected",
  provider: "openai",
  enabled: true,
};
const mockApp = {};
const mockRunTurn = jest.fn(async () => "Answer");
const mockStop = jest.fn();
const mockReset = jest.fn();
jest.mock("@/context", () => ({ useApp: () => mockApp }));
jest.mock("@/hooks/useResolvedChatBackendModel", () => ({
  useResolvedChatBackendModel: jest.fn(() => mockModel),
}));
jest.mock("@/hooks/use-streaming-chat-session", () => ({
  useStreamingChatSession: () => ({
    isStreaming: false,
    streamingText: "",
    runTurn: mockRunTurn,
    stop: mockStop,
    reset: mockReset,
  }),
}));
jest.mock("@/commands/customCommandUtils", () => ({ processCommandPrompt: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

describe("useQuickAskSession", () => {
  describe("useQuickAskSession()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(useResolvedChatBackendModel).mockReturnValue(mockModel);
    });
    it("adds the question and answer using the explicitly selected model", async () => {
      const { result } = renderHook(() =>
        useQuickAskSession({
          selectedText: "selection",
          selectedModelKey: "selected",
          includeNoteContext: false,
        })
      );
      await act(async () => {
        await result.current.sendMessage("Explain this");
      });
      expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
        { role: "user", content: "Explain this" },
        { role: "assistant", content: "Answer" },
      ]);
      act(() => result.current.stop());
      expect(mockStop).toHaveBeenCalled();
      act(() => result.current.clear());
      expect(result.current.messages).toEqual([]);
      expect(mockReset).toHaveBeenCalled();
    });
    it("requests strict model resolution and exposes unavailable selections to the panel (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      jest.mocked(useResolvedChatBackendModel).mockReturnValue(null);
      const { result } = renderHook(() =>
        useQuickAskSession({
          selectedText: "selection",
          selectedModelKey: "removed",
          includeNoteContext: false,
        })
      );
      expect(useResolvedChatBackendModel).toHaveBeenCalledWith(mockApp, "removed", false);
      expect(result.current.hasModel).toBe(false);
      expect(result.current.messages).toEqual([]);
    });
  });
});
