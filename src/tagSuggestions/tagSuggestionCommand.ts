import { TagSuggestionModal } from "@/components/modals/TagSuggestionModal";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import { checkIsPaidUser } from "@/plusUtils";
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
import { App, Notice, TFile } from "obsidian";

export async function suggestTagsForCurrentNote(app: App): Promise<void> {
  // Tag suggestion is an optional Jev judgment: every failure stays local to this
  // user-triggered command and leaves the note unchanged.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
  const file = app.workspace.getActiveFile();
  if (!(file instanceof TFile) || file.extension !== "md") {
    new Notice("Open a Markdown note before suggesting tags.");
    return;
  }

  const isPaidUser = await checkIsPaidUser(app, { trigger: "tool_call" });
  if (!isPaidUser) {
    new Notice("A valid Copilot Plus license is required to suggest tags.");
    return;
  }

  const loading = new Notice("Suggesting tags…", 0);
  try {
    const content = await app.vault.cachedRead(file);
    const candidates = collectTagCandidates(app, file, content);
    if (!candidates.length) {
      new Notice("This vault has no other tags to suggest for this note.");
      return;
    }
    const state = buildTagSuggestionState(file, content, app.metadataCache.getFileCache(file));
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
    new TagSuggestionModal(app, suggestions, async (tag) => {
      try {
        await addTagToFrontmatter(app, file, tag);
        new Notice(`Added #${tag}`);
      } catch (error) {
        logError("Failed to add a suggested tag", error);
        new Notice("Couldn’t add that tag. Try again.");
      }
    }).open();
  } catch (error) {
    logError("Tag suggestion failed", error);
    new Notice(tagSuggestionErrorNotice(error));
  } finally {
    loading.hide();
  }
}
