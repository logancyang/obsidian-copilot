import { LanguageModal } from "@/components/modals/LanguageModal";
import { ToneModal } from "@/components/modals/ToneModal";
import CopilotPlugin from "@/main";
import { Editor, Notice } from "obsidian";
import { COMMAND_IDS } from "./constants";
import { getSettings } from "@/settings/model";

export function registerBuiltInCommands(plugin: CopilotPlugin) {
  // Remove all built in commands first
  Object.values(COMMAND_IDS).forEach((id) => {
    // removeCommand is not available in TypeScript for some reasons
    // https://docs.obsidian.md/Reference/TypeScript+API/Plugin/removeCommand
    (plugin as any).removeCommand(id);
  });

  const addCommandIfEnabled = (id: string, callback: (editor: Editor) => void) => {
    const commandSettings = getSettings().enabledCommands[id];
    if (commandSettings && commandSettings.enabled) {
      plugin.addCommand({
        id,
        name: commandSettings.name,
        editorCallback: callback,
      });
    }
  };

  addCommandIfEnabled(COMMAND_IDS.FIX_GRAMMAR, (editor) => {
    plugin.processSelection(editor, "fixGrammarSpellingSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.SUMMARIZE, (editor) => {
    plugin.processSelection(editor, "summarizeSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.GENERATE_TOC, (editor) => {
    plugin.processSelection(editor, "tocSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.GENERATE_GLOSSARY, (editor) => {
    plugin.processSelection(editor, "glossarySelection");
  });

  addCommandIfEnabled(COMMAND_IDS.SIMPLIFY, (editor) => {
    plugin.processSelection(editor, "simplifySelection");
  });

  addCommandIfEnabled(COMMAND_IDS.EMOJIFY, (editor) => {
    plugin.processSelection(editor, "emojifySelection");
  });

  addCommandIfEnabled(COMMAND_IDS.REMOVE_URLS, (editor) => {
    plugin.processSelection(editor, "removeUrlsFromSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.REWRITE_TWEET, (editor) => {
    plugin.processSelection(editor, "rewriteTweetSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.REWRITE_TWEET_THREAD, (editor) => {
    plugin.processSelection(editor, "rewriteTweetThreadSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.MAKE_SHORTER, (editor) => {
    plugin.processSelection(editor, "rewriteShorterSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.MAKE_LONGER, (editor) => {
    plugin.processSelection(editor, "rewriteLongerSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.ELI5, (editor) => {
    plugin.processSelection(editor, "eli5Selection");
  });

  addCommandIfEnabled(COMMAND_IDS.PRESS_RELEASE, (editor) => {
    plugin.processSelection(editor, "rewritePressReleaseSelection");
  });

  addCommandIfEnabled(COMMAND_IDS.TRANSLATE, (editor) => {
    new LanguageModal(plugin.app, (language) => {
      if (!language) {
        new Notice("Please select a language.");
        return;
      }
      plugin.processSelection(editor, "translateSelection", language);
    }).open();
  });

  addCommandIfEnabled(COMMAND_IDS.CHANGE_TONE, (editor) => {
    new ToneModal(plugin.app, (tone) => {
      if (!tone) {
        new Notice("Please select a tone.");
        return;
      }
      plugin.processSelection(editor, "changeToneSelection", tone);
    }).open();
  });

  plugin.addCommand({
    id: COMMAND_IDS.COUNT_TOKENS,
    name: "Count words and tokens in selection",
    editorCallback: (editor: Editor) => {
      plugin.processSelection(editor, "countTokensSelection");
    },
  });

  plugin.addCommand({
    id: COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS,
    name: "Count total tokens in your vault",
    callback: async () => {
      const totalTokens = await plugin.countTotalTokens();
      new Notice(`Total tokens in your vault: ${totalTokens}`);
    },
  });
}
