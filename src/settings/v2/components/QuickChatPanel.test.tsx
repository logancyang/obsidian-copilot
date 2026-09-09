import { QuickChatPanel } from "@/settings/v2/components/QuickChatPanel";
import { updateSetting } from "@/settings/model";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode", () => {
  throw new Error("Quick Chat settings must not initialize desktop agents");
});
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useSettingsValue: () => ({ defaultModelKey: "legacy-default" }),
  updateSetting: jest.fn(),
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useChatBackendModelOptions: () => ({
    options: [
      { label: "Model A", value: "a" },
      { label: "Model B", value: "b" },
    ],
    resolveSelectionId: (selection: string) => (selection === "legacy-default" ? "a" : undefined),
  }),
}));
jest.mock("@/settings/v2/components/ChatModelEnableList", () => ({
  ChatModelEnableList: () => <div>Enabled chat models</div>,
}));

describe("QuickChatPanel", () => {
  describe("QuickChatPanel()", () => {
    it("resolves the saved default and persists a new model without desktop agents (https://github.com/Brevilabs/obsidian-copilot-private/issues/373)", () => {
      render(<QuickChatPanel />);
      expect(screen.getByDisplayValue("Model A")).not.toBeNull();
      expect(screen.getByText("Enabled chat models")).not.toBeNull();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
      expect(updateSetting).toHaveBeenCalledWith("defaultModelKey", "b");
    });
  });
});
