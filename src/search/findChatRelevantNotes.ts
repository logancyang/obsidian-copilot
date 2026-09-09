import { MiyoClient, MiyoRequestError, type RelatedContextResponse } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, getMiyoFilePath, getVaultRelativeMiyoPath } from "@/miyo/miyoUtils";
import type { ChatRelevantNotesContext } from "@/search/chatRelevantNotesContext";
import type { RelevantNotesResult } from "@/search/findRelevantNotes";
import { getSettings } from "@/settings/model";
import { withTimeout } from "@/utils";
import { App, TFile } from "obsidian";

const EMPTY_NOTES = Object.freeze([]);
/** Retrieve one chat snapshot; the opt-in fixture exercises the UI without claiming relevance.
 * @param app - Vault used to resolve result paths.
 * @param context - Isolated composition and visible conversation snapshot.
 * @param mock - Explicit development-only fixture mode.
 */
export async function findChatRelevantNotes(
  app: App,
  context: ChatRelevantNotesContext,
  mock = false
): Promise<RelevantNotesResult> {
  const { request } = context;
  const details = { skippedAttachments: context.skippedAttachments, mock };
  if (
    !request.draft?.trim() &&
    !request.messages?.length &&
    !request.excerpts?.length &&
    !request.file_paths?.length
  ) {
    // Unsupported-only attachments must stay in chat rather than use an unrelated note.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
    return { notes: EMPTY_NOTES, status: "no-usable-context", details };
  }
  const client = new MiyoClient({ plusLicenseKey: getSettings().plusLicenseKey });
  let baseUrl: string | undefined;
  try {
    let response: RelatedContextResponse;
    if (mock) {
      // Fixture order is alphabetical, independent of the conversation; it is not a ranking.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
      const results = app.vault
        .getMarkdownFiles()
        .filter((file) => !request.file_paths?.includes(getMiyoFilePath(app, file.path)))
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, request.limit ?? 20)
        .map((file) => ({ path: getMiyoFilePath(app, file.path), score: 0.73 }));
      response = {
        status: "ok",
        results,
        count: results.length,
        skipped_files: [],
        context_truncated: false,
        execution_time_ms: 0,
      };
    } else {
      baseUrl = await withTimeout(
        () => client.resolveBaseUrl(getMiyoCustomUrl(getSettings())),
        8000,
        "Miyo endpoint resolution"
      );
      response = await withTimeout(
        () => client.recommend(baseUrl!, request),
        8000,
        "Miyo chat related search"
      );
    }
    details.skippedAttachments += response.skipped_files.length;
    const notes = response.results.flatMap(({ path, score }) => {
      const relativePath = getVaultRelativeMiyoPath(app, path);
      const file = app.vault.getAbstractFileByPath(relativePath);
      if (
        !(file instanceof TFile) ||
        file.extension !== "md" ||
        !Number.isFinite(score) ||
        request.file_paths?.includes(path)
      )
        return [];
      return [
        {
          note: { path: relativePath, title: file.basename },
          metadata: { score, hasOutgoingLinks: false, hasBacklinks: false },
        },
      ];
    });
    return {
      notes,
      status:
        response.status === "no_usable_context"
          ? "no-usable-context"
          : notes.length
            ? "matches"
            : "no-matches",
      details,
    };
  } catch (error) {
    // An old service cannot search chat context; hosts can retain editor-note retrieval.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
    if (
      error instanceof MiyoRequestError &&
      error.status === 501 &&
      error.errorCode === "not_implemented"
    ) {
      return { notes: EMPTY_NOTES, status: "unsupported-service", details };
    }
    return {
      notes: EMPTY_NOTES,
      status:
        error instanceof MiyoRequestError && error.status === 400
          ? "request-error"
          : error instanceof MiyoRequestError && error.status === 413
            ? "request-too-large"
            : "unavailable",
      details,
    };
  }
}
