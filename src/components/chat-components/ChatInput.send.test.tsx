import ChatInput, { type ChatInputProps } from "@/components/chat-components/ChatInput";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/aiParams", () => ({
  useChainType: jest.fn().mockReturnValue(["agent"]),
  useModelKey: jest.fn().mockReturnValue(["model", jest.fn()]),
}));
jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn().mockReturnValue({ activeModels: [] }),
}));
// Records the portal host ChatInput hands its pickers; the menu itself is not
// rendered here (layout is untestable under jsdom), only the host choice.
const pickerContainers: (HTMLElement | null | undefined)[] = [];
jest.mock("@/components/ui/ModelSelector", () => ({
  ModelSelector: ({ container }: { container?: HTMLElement | null }) => {
    pickerContainers.push(container);
    return null;
  },
}));
jest.mock("@/components/chat-components/ContextControl", () => ({ ContextControl: () => null }));
jest.mock("@/components/chat-components/AddContextButton", () => ({
  AddContextButton: () => null,
}));
jest.mock("@/components/chat-components/LexicalEditor", () => ({
  __esModule: true,
  default: ({ onSubmit }: { onSubmit: () => void }) => (
    <input aria-label="Message" onKeyDown={(event) => event.key === "Enter" && onSubmit()} />
  ),
}));

const image = new File(["image bytes"], "screenshot.png", { type: "image/png" });

function composer(inputMessage: string, selectedImages: File[]) {
  const props = {
    inputMessage,
    selectedImages,
    handleSendMessage: jest.fn(),
    isGenerating: false,
    isAgentMode: true,
    app: { workspace: { getActiveFile: () => null, on: jest.fn(), offref: jest.fn() } },
    contextNotes: [],
    setContextNotes: jest.fn(),
    setInputMessage: jest.fn(),
    onStopGenerating: jest.fn(),
    setIncludeActiveNote: jest.fn(),
    setIncludeActiveWebTab: jest.fn(),
    onAddImage: jest.fn(),
    setSelectedImages: jest.fn(),
    includeActiveNote: false,
    includeActiveWebTab: false,
    activeWebTab: null,
  } as unknown as ChatInputProps;
  return { node: <ChatInput {...props} />, send: props.handleSendMessage };
}

describe("ChatInput", () => {
  const createObjectURL = URL.createObjectURL;
  beforeAll(() => {
    URL.createObjectURL = jest.fn(() => "blob:screenshot");
  });
  afterAll(() => {
    URL.createObjectURL = createObjectURL;
  });
  describe("ChatInput()", () => {
    it("hands the pickers this pane's document body, not the composer root (https://github.com/Brevilabs/obsidian-copilot-private/issues/153)", () => {
      // The composer root carries `@container`, and a container query makes an
      // element a containing block for fixed-position descendants — mounting
      // the menu there resolves Radix's viewport offsets against the composer
      // box and puts the menu off-screen. The body of the pane's own document
      // keeps the menu positioned correctly while still following the
      // component rather than whichever Obsidian window holds focus.
      pickerContainers.length = 0;
      render(composer("", []).node);

      const host = pickerContainers.at(-1);
      expect(host).toBe(document.body);
      expect(host?.className).not.toMatch(/@container/);
    });
  });

  describe("onSendMessage()", () => {
    it.each(["", "   ", "Describe this"])(
      "enables Send with an image and draft %p https://github.com/logancyang/obsidian-copilot/issues/2850",
      (text) => {
        const { node, send } = composer(text, [image]);
        render(node);
        const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
        expect(button.disabled).toBe(false);
        fireEvent.click(button);
        expect(send).toHaveBeenCalledTimes(1);
      }
    );

    it("disables Send after the last image is removed from an empty draft https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      const view = render(composer("", [image]).node);
      view.rerender(composer("   ", []).node);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).disabled).toBe(true);
    });

    it("routes Enter with an image-only draft to the send handler https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      const { node, send } = composer("", [image]);
      render(node);
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
