import React from "react";
import { Notice } from "obsidian";
import type { MenuCommandModal } from "@/components/command-ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomCommandChatModalContent } from "./CustomCommandChatModal";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { updateSetting } from "@/settings/model";
import { openCopilotSettings } from "@/settings/openSettings";

const mockSettings = { quickCommandModelKey: "quick", quickCommandIncludeNoteContext: false };
const mockApp = { workspace: { getActiveFile: () => null } };
const mockModels = {
  explicit: { name: "explicit", configuredModelId: "explicit" },
  quick: { name: "quick", configuredModelId: "quick" },
  picked: { name: "picked", configuredModelId: "picked" },
};
const mockTurns: { model: string; prompt: string }[] = [];
const mockStop = jest.fn();
const mockReset = jest.fn();
const mockLatest = () => "";
jest.mock("@/context", () => ({ useApp: () => mockApp }));
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
  updateSetting: jest.fn(),
}));
jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));
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
  useResolvedChatBackendModel: (_app: unknown, key: keyof typeof mockModels) =>
    mockModels[key] ?? null,
}));
jest.mock("@/hooks/use-streaming-chat-session", () => ({
  useStreamingChatSession: ({
    model,
    onNoModel,
  }: {
    model: { name: string } | null;
    onNoModel: () => void;
  }) => {
    const onNoModelRef = React.useRef(onNoModel);
    onNoModelRef.current = onNoModel;
    const runTurn = React.useCallback(
      async (getPrompt: (ctx: unknown) => Promise<string>) => {
        if (!model) {
          onNoModelRef.current();
          return null;
        }
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
      reset: mockReset,
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
      <button type="button" onClick={() => props.onOpenModelSettings?.(window)}>
        {props.needsModel ? "Model missing" : "Configure default"}
      </button>
      {props.onRunAgain && (
        <button type="button" onClick={props.onRunAgain}>
          Run again
        </button>
      )}
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

function commandModal(modelKey: string, autoExecuteOnOpen = true) {
  return (
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

function renderCommand(modelKey: string, autoExecuteOnOpen = true) {
  return render(commandModal(modelKey, autoExecuteOnOpen));
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
    it.each(["removed", ""])(
      "asks for settings configuration when selection %s is unavailable and does not resume after a popup choice (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)",
      async (modelKey) => {
        mockSettings.quickCommandModelKey = "";
        renderCommand(modelKey);
        await waitFor(() =>
          expect(Notice).toHaveBeenCalledWith(
            "Configure a model in Settings → Copilot → Command, then rerun the command."
          )
        );
        expect(screen.getByText("idle")).not.toBeNull();
        expect(processCommandPrompt).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("Choose model"));
        await waitFor(() => expect(screen.getByText("idle")).not.toBeNull());
        expect(mockTurns).toEqual([]);
        expect(processCommandPrompt).not.toHaveBeenCalled();
        expect(updateSetting).not.toHaveBeenCalled();
      }
    );
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
    it("flags a missing model and opens the Command settings tab to set the default (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", async () => {
      mockSettings.quickCommandModelKey = "";
      renderCommand("");
      fireEvent.click(await screen.findByText("Model missing"));
      expect(openCopilotSettings).toHaveBeenCalledWith(mockApp, window, "command");
    });
    it("follows a default set in settings until the user picks a model in the dialog", async () => {
      mockSettings.quickCommandModelKey = "";
      const view = renderCommand("", false);
      expect(screen.getByText("Model missing")).not.toBeNull();
      mockSettings.quickCommandModelKey = "quick";
      view.rerender(commandModal("", false));
      expect(screen.getByText("Configure default")).not.toBeNull();
      fireEvent.click(screen.getByText("Choose model"));
      mockSettings.quickCommandModelKey = "explicit";
      view.rerender(commandModal("", false));
      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Summarize" } });
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => expect(mockTurns[0]?.model).toBe("picked"));
    });
    it("runs a saved command on the selection again in a fresh session", async () => {
      renderCommand("explicit");
      await screen.findByText("Answer from explicit");
      fireEvent.click(screen.getByText("Run again"));
      await waitFor(() => expect(mockTurns).toHaveLength(2));
      expect(mockReset).toHaveBeenCalledTimes(1);
      expect(mockTurns[1]).toEqual({
        model: "explicit",
        prompt: "Rewrite clearly: Selected sentence",
      });
    });
    it("offers Run again for a quick command only after its first instruction, then reruns that instruction", async () => {
      renderCommand("", false);
      expect(screen.queryByText("Run again")).toBeNull();
      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Make concise" } });
      fireEvent.click(screen.getByText("Submit"));
      await screen.findByText("Answer from quick");
      fireEvent.click(screen.getByText("Run again"));
      await waitFor(() => expect(mockTurns).toHaveLength(2));
      expect(mockTurns[1]).toEqual({ model: "quick", prompt: "Make concise: Selected sentence" });
    });
  });
});
