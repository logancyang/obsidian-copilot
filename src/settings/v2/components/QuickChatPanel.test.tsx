import { QuickChatPanel } from "@/settings/v2/components/QuickChatPanel";
import { updateBackendDefaultModel } from "@/settings/model";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode", () => {
  throw new Error("Quick Chat settings must not initialize desktop agents");
});
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useSettingsValue: () => ({ backends: { chat: { default: { configuredModelId: "a" } } } }),
  updateBackendDefaultModel: jest.fn(),
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useChatBackendModelOptions: () => ({
    options: [
      { label: "Model A", value: "a" },
      { label: "Model B", value: "b" },
    ],
    resolveSelectionId: (selection: string | undefined) => selection,
  }),
}));
jest.mock("@/settings/v2/components/ChatModelEnableList", () => ({
  ChatModelEnableList: () => <div>Enabled chat models</div>,
}));

describe("QuickChatPanel", () => {
  describe("QuickChatPanel()", () => {
    it("shows the stored chat default and persists a new pick without desktop agents (https://github.com/Brevilabs/obsidian-copilot-private/issues/373)", () => {
      render(<QuickChatPanel />);
      expect(screen.getByDisplayValue("Model A")).not.toBeNull();
      expect(screen.getByText("Enabled chat models")).not.toBeNull();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
      expect(updateBackendDefaultModel).toHaveBeenCalledWith("chat", { configuredModelId: "b" });
    });
  });
});
