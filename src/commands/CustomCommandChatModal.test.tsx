import { render, screen } from "@testing-library/react";
import type { CustomCommand } from "@/commands/type";
import type { ChatModelPickerOverride } from "@/components/chat-components/useChatModelPicker";
import React from "react";

const mockUseModelKey = jest.fn<[string, (value: string) => void], []>();
const mockUseSettingsValue = jest.fn<
  { quickCommandModelKey?: string; quickCommandIncludeNoteContext: boolean },
  []
>();
const mockUseChatModelPicker = jest.fn<
  ChatModelPickerOverride,
  [{ value: string; onChange: (configuredModelId: string) => void }]
>();
const mockUseResolvedChatBackendModel = jest.fn();
const mockApp = { workspace: { getActiveFile: () => null } };
const mockAppHook = () => mockApp;
const mockStreamingChatSession = () => ({
  isStreaming: false,
  streamingText: "",
  runTurn: jest.fn(),
  stop: jest.fn(),
  getLatestStreamingText: jest.fn(() => ""),
});

jest.mock("@/aiParams", () => ({ useModelKey: mockUseModelKey }));
jest.mock("@/settings/model", () => ({
  useSettingsValue: mockUseSettingsValue,
  updateSetting: jest.fn(),
}));
jest.mock("@/components/chat-components/useChatModelPicker", () => ({
  useChatModelPicker: mockUseChatModelPicker,
}));
jest.mock("@/hooks/useResolvedChatBackendModel", () => ({
  useResolvedChatBackendModel: mockUseResolvedChatBackendModel,
}));
jest.mock("@/context", () => ({ useApp: mockAppHook }));
jest.mock("@/components/command-ui", () => ({
  MenuCommandModal: ({ selectedModel }: { selectedModel: string }) => (
    <span data-testid="selected-model">{selectedModel}</span>
  ),
}));
jest.mock("@/hooks/use-streaming-chat-session", () => ({
  useStreamingChatSession: mockStreamingChatSession,
}));
jest.mock("@/commands/customCommandUtils", () => ({ processCommandPrompt: jest.fn() }));
jest.mock("@/editor/selectionHighlight", () => ({ SelectionHighlight: { hide: jest.fn() } }));
jest.mock("@/editor/replaceGuard", () => ({ createHighlightReplaceGuard: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/utils", () => ({
  cleanMessageForCopy: jest.fn((value: string) => value),
  insertIntoEditor: jest.fn(),
}));
jest.mock("@/utils/markdownPreprocess", () => ({
  preprocessAIResponse: jest.fn((value: string) => value),
}));
jest.mock("@/utils/panelPlacement", () => ({ computeVerticalPlacement: jest.fn() }));
jest.mock("@/utils/selectionAnchors", () => ({ computeSelectionAnchors: jest.fn() }));
jest.mock("@/utils/safeAsyncHandler", () => ({ safeAsyncHandler: (handler: unknown) => handler }));
jest.mock("@/constants", () => ({
  ABORT_REASON: { UNMOUNT: "unmount", USER_STOPPED: "user-stopped" },
}));

import { CustomCommandChatModalContent } from "./CustomCommandChatModal";

function command(modelKey = ""): CustomCommand {
  return {
    title: "Test command",
    content: "",
    modelKey,
    showInContextMenu: false,
    showInSlashMenu: false,
    order: 0,
    lastUsedMs: 0,
  };
}

function props(
  overrides: Partial<React.ComponentProps<typeof CustomCommandChatModalContent>> = {}
) {
  return {
    originalText: "",
    command: command(),
    onInsert: jest.fn(),
    onReplace: jest.fn(),
    onClose: jest.fn(),
    behaviorConfig: {
      autoExecuteOnOpen: false,
      hideContentAreaOnIdle: true,
      commandLabel: "Test command",
    },
    ...overrides,
  };
}

describe("CustomCommandChatModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseModelKey.mockReturnValue(["legacy-model", jest.fn()]);
    mockUseSettingsValue.mockReturnValue({
      quickCommandModelKey: undefined,
      quickCommandIncludeNoteContext: false,
    });
    mockUseResolvedChatBackendModel.mockReturnValue(null);
    mockUseChatModelPicker.mockImplementation(({ value, onChange }) => ({
      value,
      onChange,
      models: [],
    }));
  });

  describe("CustomCommandChatModalContent()", () => {
    it("uses the active Agent Chat model for an inherited command and snapshots it at mount (https://github.com/logancyang/obsidian-copilot/issues/3014)", () => {
      const { rerender } = render(
        <CustomCommandChatModalContent {...props({ agentModelKey: "agent-model" })} />
      );

      expect(screen.getByTestId("selected-model").textContent).toBe("agent-model");
      expect(mockUseResolvedChatBackendModel).toHaveBeenCalledWith(mockApp, "agent-model");

      rerender(<CustomCommandChatModalContent {...props({ agentModelKey: "new-agent-model" })} />);
      expect(screen.getByTestId("selected-model").textContent).toBe("agent-model");
    });

    it("keeps an explicit command model ahead of Agent Chat inheritance", () => {
      render(
        <CustomCommandChatModalContent
          {...props({ command: command("explicit-model"), agentModelKey: "agent-model" })}
        />
      );

      expect(screen.getByTestId("selected-model").textContent).toBe("explicit-model");
    });

    it("falls back to the legacy Quick Chat model when Agent Chat has no runnable match", () => {
      render(<CustomCommandChatModalContent {...props({ agentModelKey: null })} />);

      expect(screen.getByTestId("selected-model").textContent).toBe("legacy-model");
    });

    it("keeps Quick Command on its existing Quick Chat selection", () => {
      mockUseSettingsValue.mockReturnValue({
        quickCommandModelKey: "quick-command-model",
        quickCommandIncludeNoteContext: false,
      });
      render(
        <CustomCommandChatModalContent
          {...props({
            agentModelKey: "agent-model",
            behaviorConfig: {
              autoExecuteOnOpen: false,
              hideContentAreaOnIdle: true,
              commandLabel: "Quick Command",
              modelSelectionScope: "quick-command",
            },
          })}
        />
      );

      expect(screen.getByTestId("selected-model").textContent).toBe("quick-command-model");
    });
  });
});
