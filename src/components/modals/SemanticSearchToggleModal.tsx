import { App } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";

export class SemanticSearchToggleModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void, enabling: boolean) {
    const content = enabling
      ? "Semantic search requires building an embedding index for your vault.\n\nUse 'Refresh Vault Index' or 'Force Reindex Vault' commands to build the index after enabling. Pick your embedding model below.\n\nThe Copilot index jsonl file will be stored in .obsidian or .copilot depending on your Obsidian sync setting below."
      : "Disabling semantic search will fall back to index-free lexical search (less resource-intensive, could be less accurate).\n\nYour existing index will be preserved but not used.";

    const title = enabling ? "Enable Semantic Search" : "Disable Semantic Search";
    const confirmButtonText = enabling ? "Enable" : "Disable";

    super(app, onConfirm, content, title, confirmButtonText, "Cancel");
  }
}
