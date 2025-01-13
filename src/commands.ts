import { LanguageModal } from "@/components/modals/LanguageModal";
import { ToneModal } from "@/components/modals/ToneModal";
import CopilotPlugin from "@/main";
import { Editor, Notice } from "obsidian";
import { COMMAND_IDS, COMMAND_NAMES, CommandId } from "./constants";
import { getSettings } from "@/settings/model";
import { DISABLEABLE_COMMANDS } from "./constants";

export function isCommandEnabled(id: CommandId) {
  const commandSettings = getSettings().enabledCommands[id];
  return commandSettings?.enabled !== false;
}

export function addCommand(plugin: CopilotPlugin, id: CommandId, callback: () => void) {
  if (isCommandEnabled(id)) {
    plugin.addCommand({
      id,
      name: COMMAND_NAMES[id],
      callback,
    });
  }
}

function addEditorCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (editor: Editor) => void
) {
  if (isCommandEnabled(id)) {
    plugin.addCommand({
      id,
      name: COMMAND_NAMES[id],
      editorCallback: callback,
    });
  }
}

export function addCheckCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (checking: boolean) => boolean | void
) {
  if (isCommandEnabled(id)) {
    plugin.addCommand({
      id,
      name: COMMAND_NAMES[id],
      checkCallback: callback,
    });
  }
}

export function registerBuiltInCommands(plugin: CopilotPlugin) {
  // Remove all built in commands first
  DISABLEABLE_COMMANDS.forEach((id) => {
    // removeCommand is not available in TypeScript for some reasons
    // https://docs.obsidian.md/Reference/TypeScript+API/Plugin/removeCommand
    (plugin as any).removeCommand(id);
  });

  addEditorCommand(plugin, COMMAND_IDS.FIX_GRAMMAR, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.FIX_GRAMMAR);
  });

  addEditorCommand(plugin, COMMAND_IDS.SUMMARIZE, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.SUMMARIZE);
  });

  addEditorCommand(plugin, COMMAND_IDS.GENERATE_TOC, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.GENERATE_TOC);
  });

  addEditorCommand(plugin, COMMAND_IDS.GENERATE_GLOSSARY, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.GENERATE_GLOSSARY);
  });

  addEditorCommand(plugin, COMMAND_IDS.SIMPLIFY, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.SIMPLIFY);
  });

  addEditorCommand(plugin, COMMAND_IDS.EMOJIFY, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.EMOJIFY);
  });

  addEditorCommand(plugin, COMMAND_IDS.REMOVE_URLS, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.REMOVE_URLS);
  });

  addEditorCommand(plugin, COMMAND_IDS.REWRITE_TWEET, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.REWRITE_TWEET);
  });

  addEditorCommand(plugin, COMMAND_IDS.REWRITE_TWEET_THREAD, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.REWRITE_TWEET_THREAD);
  });

  addEditorCommand(plugin, COMMAND_IDS.MAKE_SHORTER, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.MAKE_SHORTER);
  });

  addEditorCommand(plugin, COMMAND_IDS.MAKE_LONGER, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.MAKE_LONGER);
  });

  addEditorCommand(plugin, COMMAND_IDS.ELI5, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.ELI5);
  });

  addEditorCommand(plugin, COMMAND_IDS.PRESS_RELEASE, (editor) => {
    plugin.processSelection(editor, COMMAND_IDS.PRESS_RELEASE);
  });

  addEditorCommand(plugin, COMMAND_IDS.TRANSLATE, (editor) => {
    new LanguageModal(plugin.app, (language) => {
      if (!language) {
        new Notice("Please select a language.");
        return;
      }
      plugin.processSelection(editor, COMMAND_IDS.TRANSLATE, language);
    }).open();
  });

  addEditorCommand(plugin, COMMAND_IDS.CHANGE_TONE, (editor) => {
    new ToneModal(plugin.app, (tone) => {
      if (!tone) {
        new Notice("Please select a tone.");
        return;
      }
      plugin.processSelection(editor, COMMAND_IDS.CHANGE_TONE, tone);
    }).open();
  });

  addEditorCommand(plugin, COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION, async (editor: Editor) => {
    const { wordCount, tokenCount } = await plugin.countSelectionWordsAndTokens(editor);
    new Notice(`Selected text contains ${wordCount} words and ${tokenCount} tokens.`);
  });

  addCommand(plugin, COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS, async () => {
    const totalTokens = await plugin.countTotalTokens();
    new Notice(`Total tokens in your vault: ${totalTokens}`);
  });
}
