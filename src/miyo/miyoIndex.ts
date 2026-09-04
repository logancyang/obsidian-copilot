import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, getMiyoFolderName } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import type { App } from "obsidian";

type Listener = () => void;

const listeners = new Set<Listener>();

/** Request a normal Miyo scan for the current vault. */
export async function requestMiyoIndexRefresh(app: App): Promise<void> {
  const settings = getSettings();
  const client = new MiyoClient({ plusLicenseKey: settings.plusLicenseKey });
  const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings));
  await client.scanFolder(baseUrl, getMiyoFolderName(app), false);

  // A successful scan request can change Relevant Notes immediately, so its
  // subscribers must discard any result fetched against the previous index.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/281
  notifyMiyoIndexChanged();
}

/** Subscribe to changes that can affect Miyo-backed note results. */
export function onMiyoIndexChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify subscribers that Miyo-backed note results may have changed. */
export function notifyMiyoIndexChanged(): void {
  listeners.forEach((listener) => listener());
}
