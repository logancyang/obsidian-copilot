import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import { checkIsPlusUser, isPlusEnabled } from "@/plusUtils";
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

export interface SuggestTagOptions {
  quiet?: boolean;
  view?: MarkdownView;
}

export async function suggestTagsForCurrentNote(
  app: App,
  suggestionRow: TagSuggestionRow,
  options: SuggestTagOptions = {}
): Promise<void> {
  const quiet = options.quiet === true;
  const view = options.view ?? app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  if (!view || !(file instanceof TFile) || file.extension !== "md") {
    if (!quiet) new Notice("Open a Markdown note before suggesting tags.");
    return;
  }
  if (
    quiet &&
    (!isPlusEnabled() ||
      (suggestionRow.hasSession(file) && !suggestionRow.isSessionLoading(file)) ||
      suggestionRow.isRequestInFlight(file))
  ) {
    return;
  }

  const request = suggestionRow.beginRequest(file);
  const sourceIsCurrent = (): boolean => {
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    return (
      suggestionRow.isCurrentRequest(request) &&
      activeView !== null &&
      activeView === view &&
      activeView.file?.path === file.path
    );
  };
  const updateTags = async (add: string[], remove: string[]): Promise<boolean> => {
    try {
      await addTagToFrontmatter(app, file, add, remove);
      if (add.length) {
        new Notice(add.length === 1 ? `Added #${add[0]}` : `Added ${add.length} tags`);
      }
      return true;
    } catch (error) {
      logError("Failed to update suggested tags", error);
      new Notice(
        add.length === 1
          ? "Couldn’t add that tag. Try again."
          : remove.length === 1
            ? "Couldn’t remove that tag. Try again."
            : "Couldn’t update tags. Try again."
      );
      return false;
    }
  };
  const rerank = () => {
    void suggestTagsForCurrentNote(app, suggestionRow, { quiet: true, view });
  };

  try {
    if (suggestionRow.showLoading(file, view) === false) {
      if (quiet) logInfo("[Tag suggestions] Could not mount the loading row");
      else new Notice("Add a tags property to this note first.");
      return;
    }
    if (!quiet) {
      const isPlusUser = await checkIsPlusUser(app, "tool_call");
      if (!sourceIsCurrent()) return;
      if (!isPlusUser) {
        suggestionRow.close();
        new Notice("A valid Copilot Plus license is required to suggest tags.");
        return;
      }
    }

    if (quiet) {
      const cached = suggestionRow.getCachedSuggestions(file);
      if (cached) {
        if (sourceIsCurrent()) {
          suggestionRow.show(file, cached.ranked, updateTags, view, cached.sourceTags, rerank);
        }
        return;
      }
    }

    const content = await app.vault.cachedRead(file);
    if (!sourceIsCurrent()) return;
    const fileCache = app.metadataCache.getFileCache(file);
    const state = buildTagSuggestionState(app, file, content, fileCache);
    const candidates = collectTagCandidates(app, file, content);
    if (!candidates.length) {
      suggestionRow.close();
      if (quiet) logInfo("[Tag suggestions] No usable candidate tags");
      else new Notice("This vault has no other tags to suggest for this note.");
      return;
    }
    const requests = packTagSuggestionRequests(state, candidates, getSettings().userId);
    const client = BrevilabsClient.getInstance();
    if (!sourceIsCurrent()) return;
    const responses = await Promise.all(
      requests.map((packed) =>
        client.broca<typeof state, (typeof packed.questions)[string], NoulAnswer>(
          packed.state,
          packed.questions
        )
      )
    );
    if (!sourceIsCurrent()) return;
    const ranking = rankTagSuggestions(requests, responses);
    if (!ranking.length) {
      suggestionRow.close();
      if (quiet) logInfo("[Tag suggestions] No ranked tags returned");
      else new Notice("No tag suggestions were returned. Try again.");
      return;
    }
    const suggestions = ranking.slice(0, 10);
    logInfo(
      "[Tag suggestion judgments]",
      suggestions.map(({ tag, score }, index) => ({ tag, noul: score, rank: index + 1 }))
    );
    suggestionRow.cacheSuggestions(file, suggestions, state.existing_tags);
    suggestionRow.show(file, suggestions, updateTags, view, state.existing_tags, rerank);
  } catch (error) {
    if (sourceIsCurrent()) {
      logError("Tag suggestion failed", error);
      suggestionRow.close();
      if (!quiet) new Notice(tagSuggestionErrorNotice(error));
    }
  } finally {
    suggestionRow.finishRequest(file, request);
  }
}
