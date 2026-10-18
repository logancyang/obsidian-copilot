import {
  OPENARTIFACTS_LINK_OFFER_MARKER,
  OPENARTIFACTS_VAULT_FOLDER,
} from "@/openArtifacts/constants";
import { ensureFolderExists } from "@/utils";
import type { Vault } from "obsidian";

// An unreadable vault counts as already offered, so the server is never asked for the offer twice.
// https://github.com/Brevilabs/OpenArtifacts/issues/94
export async function isLinkOfferPending(vault: Vault): Promise<boolean> {
  return vault.adapter.exists(OPENARTIFACTS_LINK_OFFER_MARKER).then(
    (exists) => !exists,
    () => false
  );
}

// The skill wrappers read the same marker, so the offer is shown once per vault across both paths.
// https://github.com/Brevilabs/OpenArtifacts/issues/94
export async function markLinkOfferShown(vault: Vault): Promise<void> {
  await ensureFolderExists(vault, OPENARTIFACTS_VAULT_FOLDER).catch(async (error) => {
    if (!(await vault.adapter.exists(OPENARTIFACTS_VAULT_FOLDER))) throw error;
  });
  await vault.adapter.write(OPENARTIFACTS_LINK_OFFER_MARKER, "");
}
