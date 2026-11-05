import { MiyoClient, MiyoRequestError } from "@/miyo/MiyoClient";
import {
  getMiyoCustomUrl,
  getVaultRelativeMiyoPath,
  resolveMiyoFolderName,
} from "@/miyo/miyoUtils";
import type { ChatRelevantNotesContext } from "@/search/chatRelevantNotesContext";
import type { RelevantNotesResult } from "@/miyo/findRelevantNotes";
import { getSettings } from "@/settings/model";
import { withTimeout } from "@/utils";
import { App, TFile } from "obsidian";

const EMPTY_NOTES = Object.freeze([]);
export async function findChatRelevantNotes(
  app: App,
  context: ChatRelevantNotesContext
): Promise<RelevantNotesResult> {
  const { request } = context;
  const details = { skippedAttachments: context.skippedAttachments };
  if (
    !request.draft?.trim() &&
    !request.messages?.some((message) => message.content.trim()) &&
    !request.excerpts?.some((excerpt) => excerpt.trim()) &&
    !request.file_paths?.some((path) => path.trim())
  ) {
    // Unsupported-only attachments must stay in chat rather than use an unrelated note.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
    return { notes: EMPTY_NOTES, status: "no-usable-context", details };
  }
  const client = new MiyoClient({ plusLicenseKey: getSettings().plusLicenseKey });
  try {
    const baseUrl = await withTimeout(
      () => client.resolveBaseUrl(getMiyoCustomUrl(getSettings())),
      8000,
      "Miyo endpoint resolution"
    );
    const folderName = await withTimeout(
      () => resolveMiyoFolderName(app, client, baseUrl),
      8000,
      "Miyo folder lookup"
    );
    // The context names files under the vault's name from before the lookup, which Miyo may know by another name.
    // https://github.com/logancyang/obsidian-copilot/issues/3690
    const filePaths = request.file_paths?.map(
      (path) => `${folderName}${path.slice(request.folder_name.length)}`
    );
    const response = await withTimeout(
      () =>
        client.recommend(baseUrl, { ...request, folder_name: folderName, file_paths: filePaths }),
      8000,
      "Miyo chat related search"
    );
    details.skippedAttachments += response.skipped_files.length;
    const notes = response.results.flatMap(({ path, score }) => {
      const relativePath = getVaultRelativeMiyoPath(app, path);
      const file = app.vault.getAbstractFileByPath(relativePath);
      if (
        !(file instanceof TFile) ||
        file.extension !== "md" ||
        !Number.isFinite(score) ||
        filePaths?.includes(path)
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
      notes: notes.length ? notes : EMPTY_NOTES,
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
