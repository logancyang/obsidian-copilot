import { INSERT_TEXT_WITH_PILLS_COMMAND } from "@/components/chat-components/utils/lexicalTextUtils";
import {
  initialTypewriterState,
  nextTypewriterFrame,
  shufflePrompts,
  visiblePromptText,
} from "@/components/chat-components/utils/promptTypewriter";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, KEY_TAB_COMMAND } from "lexical";
import React, { useEffect, useMemo, useState } from "react";

interface PromptSuggestionPlaceholderProps {
  /**
   * Non-empty pool of sample prompts to cycle through. Must be referentially
   * stable (a frozen module constant) — a new array identity reshuffles the
   * pool and restarts the rotation.
   */
  prompts: readonly string[];
  /**
   * Id of this component's screen-reader description, which the composer points
   * at with `aria-describedby`. Supplied by the caller because the element that
   * needs describing is the editor, not anything rendered here.
   */
  descriptionId: string;
}

/**
 * Rotating sample prompts for an empty composer: each types in a character at a
 * time, holds while it's readable, deletes itself the same way, and gives way to
 * the next. Tab commits the prompt on screen to the real input.
 *
 * Mounted as Lexical's `placeholder`, which is why one component owns both the
 * animation and the Tab binding. That slot renders inside the composer, so the
 * editor context is reachable; and Lexical unmounts it the moment the editor
 * holds text, which is what stops the rotation on the user's first keystroke —
 * no editor-value subscription of our own, and nothing to tear down by hand.
 * Holding the per-character state here also confines a ~22fps re-render to this
 * leaf instead of the whole composer tree.
 */
export const PromptSuggestionPlaceholder: React.FC<PromptSuggestionPlaceholderProps> = ({
  prompts,
  descriptionId,
}) => {
  const [editor] = useLexicalComposerContext();
  const pool = useMemo(() => shufflePrompts(prompts), [prompts]);
  // Read once at mount: an OS preference nobody flips mid-chat, so this stays
  // free of a media-query subscription.
  const [instant] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
  );
  const [state, setState] = useState(initialTypewriterState);

  // Each frame schedules the next one, so the per-phase delays vary without an
  // interval that has to be reconciled against them.
  useEffect(() => {
    const { state: next, delayMs } = nextTypewriterFrame(state, pool, instant);
    const timer = window.setTimeout(() => setState(next), delayMs);
    return () => window.clearTimeout(timer);
  }, [state, pool, instant]);

  const visible = visiblePromptText(state, pool);
  // Tab commits the WHOLE prompt even mid-animation — what you accept is the
  // prompt, never the fragment on screen. In the beat between two prompts
  // there's nothing to accept, so Tab falls through to its default behavior.
  const acceptText = visible.length > 0 ? pool[state.index] : null;

  useEffect(() => {
    if (!acceptText) return;
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent | null) => {
        // Shift+Tab is the mode cycler (KeyboardPlugin); the rest are the
        // platform's own bindings. Only bare Tab accepts a suggestion.
        if (!event || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        event.preventDefault();
        editor.dispatchCommand(INSERT_TEXT_WITH_PILLS_COMMAND, {
          text: acceptText,
          options: { insertAtSelection: true },
        });
        return true;
      },
      // Below the typeahead menus, which claim Tab at HIGH priority while open.
      COMMAND_PRIORITY_LOW
    );
  }, [editor, acceptText]);

  // The animation is hidden from assistive tech — a string that rewrites itself
  // every 45ms is noise — but Tab is bound whenever a prompt is loaded, so what
  // that key will do has to be announced anyway. The description carries the
  // whole prompt (what Tab actually commits) and changes once per rotation
  // rather than per character. The hint is a sibling of the prompt, not a
  // child, so the prompt keeps its own text node — the chip must not read as
  // part of the suggestion.
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      {state.phase === "holding" && (
        <span
          aria-hidden="true"
          className="tw-ml-1.5 tw-whitespace-nowrap tw-text-ui-smaller tw-opacity-80"
        >
          ⇥ Tab
        </span>
      )}
      <span id={descriptionId} className="tw-sr-only">
        {acceptText ? `Suggested prompt: ${acceptText}. Press Tab to insert it.` : ""}
      </span>
    </>
  );
};
