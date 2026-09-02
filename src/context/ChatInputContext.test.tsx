import {
  ChatInputProvider,
  type ChatInputComposerSnapshot,
  useChatInput,
} from "@/context/ChatInputContext";
import { render } from "@testing-library/react";
import React from "react";

describe("ChatInputContext", () => {
  describe("ChatInputProvider", () => {
    let chatInput!: ReturnType<typeof useChatInput>;

    const Probe = () => {
      chatInput = useChatInput();
      return null;
    };

    const renderProvider = () =>
      render(
        <ChatInputProvider>
          <Probe />
        </ChatInputProvider>
      );

    const snapshot: ChatInputComposerSnapshot = {
      editorState: null,
      contextUrls: ["https://example.com"],
      contextFolders: ["Projects"],
      contextWebTabs: [{ url: "https://example.com/tab", title: "Tab" }],
    };

    describe("registerComposerSnapshotBridge()", () => {
      it("restores a captured composer into the next registered bridge for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
        renderProvider();
        const unregister = chatInput.registerComposerSnapshotBridge({
          capture: () => snapshot,
          restore: jest.fn(),
        });
        chatInput.preserveComposerAcrossNextMount();
        unregister();
        const restore = jest.fn();

        chatInput.registerComposerSnapshotBridge({ capture: jest.fn(), restore });

        expect(restore).toHaveBeenCalledWith(snapshot);
      });
    });

    describe("preserveComposerAcrossNextMount()", () => {
      it("leaves no pending restore when no composer bridge is mounted for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
        renderProvider();
        chatInput.preserveComposerAcrossNextMount();
        const restore = jest.fn();

        chatInput.registerComposerSnapshotBridge({ capture: jest.fn(), restore });

        expect(restore).not.toHaveBeenCalled();
      });

      it("cancels a pending restore when synchronous submission fails for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
        renderProvider();
        const unregister = chatInput.registerComposerSnapshotBridge({
          capture: () => snapshot,
          restore: jest.fn(),
        });
        const cancel = chatInput.preserveComposerAcrossNextMount();
        cancel();
        unregister();
        const restore = jest.fn();

        chatInput.registerComposerSnapshotBridge({ capture: jest.fn(), restore });

        expect(restore).not.toHaveBeenCalled();
      });
    });
  });
});
