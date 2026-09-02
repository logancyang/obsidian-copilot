import ChatInput from "@/components/chat-components/ChatInput";
import {
  $createFolderPillNode,
  FolderPillNode,
} from "@/components/chat-components/pills/FolderPillNode";
import { $createURLPillNode, URLPillNode } from "@/components/chat-components/pills/URLPillNode";
import {
  $createWebTabPillNode,
  WebTabPillNode,
} from "@/components/chat-components/pills/WebTabPillNode";
import {
  $createAgentPillNode,
  AgentPillNode,
} from "@/components/chat-components/pills/AgentPillNode";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalEditor,
} from "lexical";
import type { App } from "obsidian";
import React, { useState } from "react";

const mockEditors: LexicalEditor[] = [];
let mockDelayEditorReady = false;
const mockPendingEditorReady: Array<() => void> = [];

const mockCreateEditor = (): LexicalEditor => {
  const editor = createEditor({
    nodes: [URLPillNode, FolderPillNode, WebTabPillNode, AgentPillNode],
  });
  if (mockEditors.length === 0) {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode("unfinished draft"),
          $createURLPillNode("https://pill.example", "Pill URL"),
          $createFolderPillNode("Pill Folder"),
          $createWebTabPillNode("https://pill-tab.example", "Pill tab"),
          $createAgentPillNode("claude", "Claude")
        );
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
  }
  mockEditors.push(editor);
  return editor;
};

const readEditorContext = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChild();
    const children = $isElementNode(paragraph) ? paragraph.getChildren() : [];
    const url = children.find((node) => node instanceof URLPillNode);
    const folder = children.find((node) => node instanceof FolderPillNode);
    const webTab = children.find((node) => node instanceof WebTabPillNode);
    const agent = children.find((node) => node instanceof AgentPillNode);
    return {
      text: children[0]?.getTextContent(),
      url: url instanceof URLPillNode ? url.getURL() : null,
      folder: folder instanceof FolderPillNode ? folder.getFolderPath() : null,
      webTab: webTab instanceof WebTabPillNode ? webTab.getURL() : null,
      agent: agent instanceof AgentPillNode ? agent.getBackendId() : null,
    };
  });

jest.mock("@/components/chat-components/LexicalEditor", () => ({
  __esModule: true,
  default: function MockLexicalEditor({
    onEditorReady,
  }: {
    onEditorReady?: (editor: LexicalEditor) => void;
  }) {
    const [editor] = React.useState(mockCreateEditor);
    React.useEffect(() => {
      if (mockDelayEditorReady) {
        mockPendingEditorReady.push(() => onEditorReady?.(editor));
        return;
      }
      onEditorReady?.(editor);
    }, [editor, onEditorReady]);
    return <div data-testid="lexical-editor" />;
  },
}));

jest.mock("@/components/chat-components/ContextControl", () => ({
  ContextControl: (props: {
    contextUrls: string[];
    contextFolders: string[];
    contextWebTabs: Array<{ url: string }>;
    onAddToContext: (category: string, data: unknown) => void;
  }) => (
    <div>
      <span data-testid="context-urls">{props.contextUrls.join(",")}</span>
      <span data-testid="context-folders">{props.contextFolders.join(",")}</span>
      <span data-testid="context-web-tabs">
        {props.contextWebTabs.map((tab) => tab.url).join(",")}
      </span>
      <button
        type="button"
        onClick={() => props.onAddToContext("webTabs", { url: "https://badge-tab.example" })}
      >
        add web tab
      </button>
    </div>
  ),
}));

jest.mock("@/components/chat-components/AddContextButton", () => ({
  AddContextButton: () => null,
}));
jest.mock("@/components/ui/ModelSelector", () => ({ ModelSelector: () => null }));
jest.mock("@/components/ui/ModelEffortPicker", () => ({ ModelEffortPicker: () => null }));
jest.mock("@/components/ui/ModePicker", () => ({ ModePicker: () => null }));
// Mock factory names match the hook exports even though the test doubles do
// not need React state.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/aiParams", () => ({
  useChainType: () => ["copilot-plus"],
  useModelKey: () => ["model", jest.fn()],
}));
jest.mock("@/settings/model", () => ({ useSettingsValue: () => ({ activeModels: [] }) }));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/utils", () => ({
  getDomainFromUrl: (url: string) => new URL(url).hostname,
  isAllowedFileForNoteContext: () => false,
  isPlusChain: () => true,
}));

const app = {
  workspace: {
    getActiveFile: () => null,
    on: jest.fn(() => ({})),
    offref: jest.fn(),
  },
} as unknown as App;

const RemountHarness = () => {
  const chatInput = useChatInput();
  const [mount, setMount] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          chatInput.preserveComposerAcrossNextMount();
          setMount(1);
        }}
      >
        remount
      </button>
      <ChatInput
        key={mount}
        inputMessage="unfinished draft"
        setInputMessage={jest.fn()}
        handleSendMessage={jest.fn()}
        isGenerating={false}
        onStopGenerating={jest.fn()}
        app={app}
        contextNotes={[]}
        setContextNotes={jest.fn()}
        includeActiveNote={false}
        setIncludeActiveNote={jest.fn()}
        includeActiveWebTab={false}
        setIncludeActiveWebTab={jest.fn()}
        activeWebTab={null}
        selectedImages={[]}
        onAddImage={jest.fn()}
        setSelectedImages={jest.fn()}
        initialContext={
          mount === 0 ? { urls: ["https://badge.example"], folders: ["Badge Folder"] } : undefined
        }
        isAgentMode
      />
    </>
  );
};

describe("ChatInput", () => {
  describe("composer snapshot", () => {
    beforeEach(() => {
      mockEditors.length = 0;
      mockDelayEditorReady = false;
      mockPendingEditorReady.length = 0;
    });

    it("restores URL, folder, web-tab, and serialized pill semantics across the external-send remount for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
      render(
        <ChatInputProvider>
          <RemountHarness />
        </ChatInputProvider>
      );
      fireEvent.click(screen.getByText("add web tab"));
      expect(screen.getByTestId("context-web-tabs").textContent).toBe("https://badge-tab.example");

      fireEvent.click(screen.getByText("remount"));

      await waitFor(() => expect(mockEditors).toHaveLength(2));
      await waitFor(() =>
        expect(readEditorContext(mockEditors[1])).toEqual({
          text: "unfinished draft",
          url: "https://pill.example",
          folder: "Pill Folder",
          webTab: "https://pill-tab.example",
          agent: "claude",
        })
      );
      expect(screen.getByTestId("context-urls").textContent).toBe("https://badge.example");
      expect(screen.getByTestId("context-folders").textContent).toBe("Badge Folder");
      expect(screen.getByTestId("context-web-tabs").textContent).toBe("https://badge-tab.example");
    });

    it("holds serialized pill semantics until a replacement editor becomes ready for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
      render(
        <ChatInputProvider>
          <RemountHarness />
        </ChatInputProvider>
      );
      mockDelayEditorReady = true;

      fireEvent.click(screen.getByText("remount"));

      await waitFor(() => expect(mockEditors).toHaveLength(2));
      expect(readEditorContext(mockEditors[1]).agent).toBeNull();
      expect(mockPendingEditorReady).toHaveLength(1);
      mockPendingEditorReady[0]();
      await waitFor(() => expect(readEditorContext(mockEditors[1]).agent).toBe("claude"));
    });

    it("restores badge context when the previous editor was not ready to serialize for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
      mockDelayEditorReady = true;
      render(
        <ChatInputProvider>
          <RemountHarness />
        </ChatInputProvider>
      );
      fireEvent.click(screen.getByText("add web tab"));
      mockDelayEditorReady = false;

      fireEvent.click(screen.getByText("remount"));

      await waitFor(() => expect(mockEditors).toHaveLength(2));
      expect(screen.getByTestId("context-urls").textContent).toBe("https://badge.example");
      expect(screen.getByTestId("context-folders").textContent).toBe("Badge Folder");
      expect(screen.getByTestId("context-web-tabs").textContent).toBe("https://badge-tab.example");
      expect(readEditorContext(mockEditors[1])).toEqual({
        text: undefined,
        url: null,
        folder: null,
        webTab: null,
        agent: null,
      });
    });
  });
});
