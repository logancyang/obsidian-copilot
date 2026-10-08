import React from "react";
import { act, render } from "@testing-library/react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import {
  $createActiveNotePillNode,
  ActiveNotePillNode,
} from "@/components/chat-components/pills/ActiveNotePillNode";
import { ActiveNotePillSyncPlugin } from "@/components/chat-components/plugins/ActiveNotePillSyncPlugin";
import {
  VALUE_SYNC_TAG,
  ValueSyncPlugin,
} from "@/components/chat-components/plugins/ValueSyncPlugin";

interface HarnessProps {
  value: string;
  onActiveNoteAdded: () => void;
  onActiveNoteRemoved: () => void;
}

function renderComposer(props: HarnessProps) {
  let editor!: LexicalEditor;
  function CaptureEditor() {
    [editor] = useLexicalComposerContext();
    return null;
  }
  function Harness({ value, onActiveNoteAdded, onActiveNoteRemoved }: HarnessProps) {
    return (
      <LexicalComposer
        initialConfig={{
          namespace: "active-note-pill-sync-test",
          nodes: [ActiveNotePillNode],
          onError: (error) => {
            throw error;
          },
        }}
      >
        <PlainTextPlugin
          contentEditable={<ContentEditable />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ValueSyncPlugin value={value} />
        <ActiveNotePillSyncPlugin
          onActiveNoteAdded={onActiveNoteAdded}
          onActiveNoteRemoved={onActiveNoteRemoved}
        />
        <CaptureEditor />
      </LexicalComposer>
    );
  }
  const view = render(<Harness {...props} />);
  const update = (fn: () => void) => act(() => editor.update(fn, { discrete: true }));
  const nextValueSync = () =>
    new Promise<void>((resolve) => {
      const unregister = editor.registerUpdateListener(({ tags }) => {
        if (!tags.has(VALUE_SYNC_TAG)) return;
        unregister();
        resolve();
      });
    });
  return { ...view, Harness, update, nextValueSync };
}

function setupWithPill() {
  const onActiveNoteAdded = jest.fn();
  const onActiveNoteRemoved = jest.fn();
  const composer = renderComposer({ value: "", onActiveNoteAdded, onActiveNoteRemoved });
  composer.update(() => {
    const paragraph = $createParagraphNode();
    paragraph.append($createActiveNotePillNode());
    $getRoot().clear().append(paragraph);
  });
  return { ...composer, onActiveNoteAdded, onActiveNoteRemoved };
}

describe("ActiveNotePillSyncPlugin", () => {
  it("reports the Active Note as added when an active-note pill enters the editor", () => {
    const { onActiveNoteAdded, onActiveNoteRemoved } = setupWithPill();

    expect(onActiveNoteAdded).toHaveBeenCalledTimes(1);
    expect(onActiveNoteRemoved).not.toHaveBeenCalled();
  });

  it("reports the Active Note as removed when the user deletes its pill", () => {
    const { update, onActiveNoteRemoved } = setupWithPill();

    update(() => {
      $getRoot().clear().append($createParagraphNode());
    });

    expect(onActiveNoteRemoved).toHaveBeenCalledTimes(1);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/670 keeps the Active Note when the composer clears its text after a send", async () => {
    const { Harness, rerender, nextValueSync, onActiveNoteAdded, onActiveNoteRemoved } =
      setupWithPill();
    const harness = (value: string) => (
      <Harness
        value={value}
        onActiveNoteAdded={onActiveNoteAdded}
        onActiveNoteRemoved={onActiveNoteRemoved}
      />
    );
    rerender(harness("{activeNote}"));

    const cleared = nextValueSync();
    rerender(harness(""));
    await act(() => cleared);

    expect(onActiveNoteRemoved).not.toHaveBeenCalled();
  });
});
