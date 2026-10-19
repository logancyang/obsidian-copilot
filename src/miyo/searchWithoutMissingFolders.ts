import { logWarn } from "@/logger";
import { MiyoRequestError, type MiyoSearchResponse } from "@/miyo/MiyoClient";

export const MIYO_SEARCH_CANDIDATE_LIMIT = 1000;

export async function searchWithoutMissingFolders(
  search: (folderNames: string[] | undefined) => Promise<MiyoSearchResponse>,
  folderName: string | undefined,
  extraFolders: string[]
): Promise<{ response: MiyoSearchResponse; extraFolders: string[] }> {
  try {
    // folder_name stays the vault, so a Miyo without multi-folder search falls back to the vault alone instead of every folder.
    // https://github.com/logancyang/obsidian-copilot/issues/3508
    const folderNames =
      folderName && extraFolders.length > 0 ? [folderName, ...extraFolders] : undefined;
    return { response: await search(folderNames), extraFolders };
  } catch (error) {
    const missing =
      error instanceof MiyoRequestError && error.status === 404
        ? /^Folder not registered: (.+)$/.exec(error.detail)?.[1]
        : undefined;
    // A ticked folder this Miyo lacks, such as one synced from another device, is
    // dropped so the rest of the scope is still searched.
    // https://github.com/logancyang/obsidian-copilot/issues/3508
    if (missing === undefined || !extraFolders.includes(missing)) throw error;
    logWarn(`Miyo has no folder "${missing}"; searching without it`);
    return searchWithoutMissingFolders(
      search,
      folderName,
      extraFolders.filter((name) => name !== missing)
    );
  }
}
