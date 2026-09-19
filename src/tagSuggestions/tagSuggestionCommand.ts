import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import { checkIsPlusUser } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import {
  addTagToFrontmatter,
  buildTagSuggestionState,
  collectTagCandidates,
  NoulAnswer,
  packTagSuggestionRequests,
  rankTagSuggestions,
  tagSuggestionErrorNotice,
} from "@/tagSuggestions/tagSuggestions";
import type { TagSuggestionRow } from "@/tagSuggestions/tagSuggestionRow";
import { App, MarkdownView, Notice, TFile } from "obsidian";

export async function suggestTagsForCurrentNote(
  app: App,
  suggestionRow: TagSuggestionRow
): Promise<void> {
  // Tag suggestion is an optional Jev judgment: every failure stays local to this
  // user-triggered command and leaves the note unchanged.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  if (!(file instanceof TFile) || file.extension !== "md") {
    new Notice("Open a Markdown note before suggesting tags.");
    return;
  }

  const loading = new Notice("Suggesting tags…", 0);
  try {
    const isPlusUser = await checkIsPlusUser(app, "tool_call");
    if (!isPlusUser) {
      new Notice("A valid Copilot Plus license is required to suggest tags.");
      return;
    }

    const content = await app.vault.cachedRead(file);
    const candidates = collectTagCandidates(app, file, content);
    if (!candidates.length) {
      new Notice("This vault has no other tags to suggest for this note.");
      return;
    }
    const state = buildTagSuggestionState(app, file, content, app.metadataCache.getFileCache(file));
    const requests = packTagSuggestionRequests(state, candidates, getSettings().userId);
    const client = BrevilabsClient.getInstance();
    const responses = await Promise.all(
      requests.map((request) =>
        client.broca<typeof state, (typeof request.questions)[string], NoulAnswer>(
          request.state,
          request.questions
        )
      )
    );
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || activeView !== view || activeView.file?.path !== file.path) return;
    const ranking = rankTagSuggestions(requests, responses);
    if (!ranking.length) {
      new Notice("No tag suggestions were returned. Try again.");
      return;
    }
    const suggestions = ranking.slice(0, 10);
    logInfo(
      "[Tag suggestion judgments]",
      suggestions.map(({ tag, score }, index) => ({ tag, noul: score, rank: index + 1 }))
    );
    suggestionRow.show(file, suggestions, async (tag) => {
      try {
        await addTagToFrontmatter(app, file, tag);
        new Notice(`Added #${tag}`);
        return true;
      } catch (error) {
        logError("Failed to add a suggested tag", error);
        new Notice("Couldn’t add that tag. Try again.");
        return false;
      }
    });
  } catch (error) {
    logError("Tag suggestion failed", error);
    new Notice(tagSuggestionErrorNotice(error));
  } finally {
    loading.hide();
  }
}
