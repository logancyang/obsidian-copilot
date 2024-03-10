import { LanguageModal } from "@/components/LanguageModal";
import { ToneModal } from "@/components/ToneModal";
import CopilotPlugin from "@/main";
import { Editor, Notice } from "obsidian";

export function registerBuiltInCommands(plugin: CopilotPlugin) {
  plugin.addCommand({
    id: "fix-grammar-prompt",
    name: "Fix grammar and spelling of selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "fixGrammarSpellingSelection");
    },
  });

  plugin.addCommand({
    id: "summarize-prompt",
    name: "Summarize selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "summarizeSelection");
    },
  });

  plugin.addCommand({
    id: "generate-toc-prompt",
    name: "Generate table of contents for selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "tocSelection");
    },
  });

  plugin.addCommand({
    id: "generate-glossary-prompt",
    name: "Generate glossary for selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "glossarySelection");
    },
  });

  plugin.addCommand({
    id: "simplify-prompt",
    name: "Simplify selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "simplifySelection");
    },
  });

  plugin.addCommand({
    id: "emojify-prompt",
    name: "Emojify selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "emojifySelection");
    },
  });

  plugin.addCommand({
    id: "remove-urls-prompt",
    name: "Remove URLs from selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "removeUrlsFromSelection");
    },
  });

  plugin.addCommand({
    id: "rewrite-tweet-prompt",
    name: "Rewrite selection to a tweet",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "rewriteTweetSelection");
    },
  });

  plugin.addCommand({
    id: "rewrite-tweet-thread-prompt",
    name: "Rewrite selection to a tweet thread",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "rewriteTweetThreadSelection");
    },
  });

  plugin.addCommand({
    id: "make-shorter-prompt",
    name: "Make selection shorter",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "rewriteShorterSelection");
    },
  });

  plugin.addCommand({
    id: "make-longer-prompt",
    name: "Make selection longer",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "rewriteLongerSelection");
    },
  });

  plugin.addCommand({
    id: "eli5-prompt",
    name: "Explain selection like I'm 5",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "eli5Selection");
    },
  });

  plugin.addCommand({
    id: "press-release-prompt",
    name: "Rewrite selection to a press release",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "rewritePressReleaseSelection");
    },
  });

  plugin.addCommand({
    id: "translate-selection-prompt",
    name: "Translate selection",
    editorCallback: (editor: Editor) => {
      new LanguageModal(plugin.app, (language) => {
        if (!language) {
          new Notice("Please select a language.");
          return;
        }
        plugin.processSelection(editor, "translateSelection", language);
      }).open();
    },
  });

  plugin.addCommand({
    id: "change-tone-prompt",
    name: "Change tone of selection",
    editorCallback: (editor: Editor) => {
      new ToneModal(plugin.app, (tone) => {
        if (!tone) {
          new Notice("Please select a tone.");
          return;
        }
        plugin.processSelection(editor, "changeToneSelection", tone);
      }).open();
    },
  });

  plugin.addCommand({
    id: "count-tokens",
    name: "Count words and tokens in selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "countTokensSelection");
    },
  });

  plugin.addCommand({
    id: "count-total-vault-tokens",
    name: "Count total tokens in your vault",
    callback: async () => {
      const totalTokens = await plugin.countTotalTokens();
      new Notice(`Total tokens in your vault: ${totalTokens}`);
    },
  });
}
