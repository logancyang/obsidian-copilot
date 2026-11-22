import { act, render } from "@testing-library/react";
import React from "react";
import type { ChatInputProps } from "./ChatInput";
import { InlineMessageEditor } from "./InlineMessageEditor";

const mockEntries = [
  {
    state: "ok",
    configuredModelId: "model-a",
    provider: {
      providerId: "p",
      providerType: "openai-compatible",
      displayName: "OpenAI",
      origin: { kind: "byok", catalogProviderId: "openai" },
      requiresApiKey: false,
    },
    configuredModel: {
      configuredModelId: "model-a",
      providerId: "p",
      info: { id: "gpt-6-luna", displayName: "GPT-6 Luna" },
    },
  },
];
const mockSetModelKey = jest.fn();
let mockChatInputProps: ChatInputProps | undefined;

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hooks; names must match the exports */
jest.mock("jotai", () => ({ useAtomValue: () => mockEntries }));
jest.mock("@/aiParams", () => ({ useModelKey: () => ["model-a", mockSetModelKey] }));
jest.mock("@/modelManagement", () => ({
  ...jest.requireActual<typeof import("@/modelManagement/chatModel/chatModelSelection")>(
    "@/modelManagement/chatModel/chatModelSelection"
  ),
  chatBackendPickerAtom: "chat",
  capabilitiesFromConfiguredInfo: () => ({}),
  mapProviderTypeToChatModelProvider: () => "openai",
  providerRequiresApiKey: () => false,
}));
jest.mock("@/settings/model", () => ({
  settingsStore: {},
  useSettingsValue: () => ({ providers: {}, copilotPlusCatalog: [] }),
  getModelKeyFromModel: (model: { name: string; provider: string }) =>
    `${model.name}|${model.provider}`,
}));
jest.mock("./hooks/useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({ activeWebTabForMentions: null }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/lib/lockedCopilotEntries", () => ({ shouldPreviewCopilotModels: () => false }));
jest.mock("./ChatModeInput", () => ({
  __esModule: true,
  default: (props: ChatInputProps) => {
    mockChatInputProps = props;
    return null;
  },
}));

describe("InlineMessageEditor", () => {
  describe("InlineMessageEditor()", () => {
    it("offers the configured chat models in the edit picker instead of the legacy built-in list (https://github.com/Brevilabs/obsidian-copilot-private/issues/761)", () => {
      render(
        <InlineMessageEditor
          initialValue="hi"
          onSave={jest.fn()}
          onCancel={jest.fn()}
          app={{} as ChatInputProps["app"]}
        />
      );

      const picker = mockChatInputProps?.modelPickerOverride;
      expect(picker?.models.map((model) => model.displayName)).toEqual(["GPT-6 Luna"]);
      expect(picker?.value).toBe("model-a|openai");
      act(() => picker?.onChange("model-a|openai"));
      expect(mockSetModelKey).toHaveBeenCalledWith("model-a");
    });
  });
});
