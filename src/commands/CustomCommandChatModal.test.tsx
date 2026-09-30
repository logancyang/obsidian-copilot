import React from "react";
import type { MenuCommandModal } from "@/components/command-ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomCommandChatModalContent } from "./CustomCommandChatModal";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { updateSetting } from "@/settings/model";

const mockSettings = { quickCommandModelKey: "quick", quickCommandIncludeNoteContext: false };
const mockApp = { workspace: { getActiveFile: () => null } };
const mockModels = {
  explicit: { name: "explicit", configuredModelId: "explicit" },
  quick: { name: "quick", configuredModelId: "quick" },
  picked: { name: "picked", configuredModelId: "picked" },
};
const mockTurns: { model: string; prompt: string }[] = [];
const mockStop = jest.fn();
const mockLatest = () => "";
jest.mock("@/context", () => ({ useApp: () => mockApp }));
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
  updateSetting: jest.fn(),
}));
jest.mock("@/commands/customCommandUtils", () => ({
  processCommandPrompt: jest.fn(async (_app, prompt, selection) => `${prompt}: ${selection}`),
}));
jest.mock("@/components/chat-components/useChatModelPicker", () => ({
  useChatModelPicker: (params: { value: string; onChange: (value: string) => void }) => ({
    ...params,
    models: [],
  }),
}));
jest.mock("@/hooks/useResolvedChatBackendModel", () => ({
  useResolvedChatBackendModel: (_app: unknown, key: keyof typeof mockModels, fallback: boolean) =>
    mockModels[key] ?? (fallback === false ? null : mockModels.quick),
}));
jest.mock("@/hooks/use-streaming-chat-session", () => ({
  useStreamingChatSession: ({ model }: { model: { name: string } | null }) => {
    const runTurn = React.useCallback(
      async (getPrompt: (ctx: unknown) => Promise<string>) => {
        if (!model) return null;
        const prompt = await getPrompt({ signal: new AbortController().signal, isFirstTurn: true });
        mockTurns.push({ model: model.name, prompt });
        return `Answer from ${model.name}`;
      },
      [model]
    );
    return {
      isStreaming: false,
      streamingText: "",
      runTurn,
      stop: mockStop,
      getLatestStreamingText: mockLatest,
    };
  },
}));
jest.mock("@/components/command-ui", () => ({
  MenuCommandModal: (props: React.ComponentProps<typeof MenuCommandModal>) => (
    <div>
      <div>
        {props.contentState.type === "result" ? props.contentState.text : props.contentState.type}
      </div>
      <button type="button" onClick={() => props.onSelectModel("picked")}>
        Choose model
      </button>
      <input
        aria-label="Instruction"
        value={props.followUpValue}
        onChange={(event) => props.onFollowUpChange(event.target.value)}
      />
      <button type="button" onClick={props.onFollowUpSubmit}>
        Submit
      </button>
    </div>
  ),
}));
jest.mock("@/utils", () => ({
  cleanMessageForCopy: (value: string) => value,
  insertIntoEditor: jest.fn(),
}));
jest.mock("@/editor/selectionHighlight", () => ({ SelectionHighlight: {} }));
jest.mock("@/editor/replaceGuard", () => ({ createHighlightReplaceGuard: jest.fn() }));
jest.mock("@/utils/react/createPluginRoot", () => ({ createPluginRoot: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

function renderCommand(modelKey: string, autoExecuteOnOpen = true) {
  return render(
    <CustomCommandChatModalContent
      originalText="Selected sentence"
      command={{
        order: 0,
        lastUsedMs: 0,
        title: "Rewrite",
        content: "Rewrite clearly",
        modelKey,
        showInContextMenu: true,
        showInSlashMenu: true,
      }}
      onClose={() => undefined}
      onInsert={() => undefined}
      onReplace={() => undefined}
      behaviorConfig={{ autoExecuteOnOpen }}
    />
  );
}

describe("CustomCommandChatModal", () => {
  describe("CustomCommandChatModalContent()", () => {
    beforeEach(() => {
      mockTurns.length = 0;
      jest.clearAllMocks();
      mockSettings.quickCommandModelKey = "quick";
    });
    it("runs the saved command with its explicit model", async () => {
      renderCommand("explicit");
      await screen.findByText("Answer from explicit");
      expect(mockTurns).toEqual([
        { model: "explicit", prompt: "Rewrite clearly: Selected sentence" },
      ]);
    });
    it("uses the shared default for a saved command without a model (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", async () => {
      renderCommand("");
      await screen.findByText("Answer from quick");
      expect(mockTurns[0].model).toBe("quick");
    });
    it("waits on a removed explicit model and runs the original command once after selection (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", async () => {
      renderCommand("removed");
      expect(screen.getByText("idle")).not.toBeNull();
      expect(processCommandPrompt).not.toHaveBeenCalled();
      expect(mockTurns).toEqual([]);
      fireEvent.click(screen.getByText("Choose model"));
      await screen.findByText("Answer from picked");
      expect(mockTurns).toEqual([
        { model: "picked", prompt: "Rewrite clearly: Selected sentence" },
      ]);
      fireEvent.click(screen.getByText("Choose model"));
      expect(mockTurns).toHaveLength(1);
      expect(updateSetting).not.toHaveBeenCalled();
    });
    it("preserves a quick-command draft until a model is selected and keeps that choice local (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", async () => {
      mockSettings.quickCommandModelKey = "";
      renderCommand("", false);
      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Make concise" } });
      fireEvent.click(screen.getByText("Submit"));
      expect(screen.getByLabelText<HTMLInputElement>("Instruction").value).toBe("Make concise");
      expect(mockTurns).toEqual([]);
      fireEvent.click(screen.getByText("Choose model"));
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() =>
        expect(mockTurns).toEqual([{ model: "picked", prompt: "Make concise: Selected sentence" }])
      );
      expect(updateSetting).not.toHaveBeenCalled();
    });
  });
});
