import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, getMiyoFolderName } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import type { App } from "obsidian";

type Listener = () => void;

const listeners = new Set<Listener>();

export async function requestMiyoIndexRefresh(app: App): Promise<void> {
  const settings = getSettings();
  const client = new MiyoClient({ plusLicenseKey: settings.plusLicenseKey });
  const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings));
  await client.scanFolder(baseUrl, getMiyoFolderName(app), false);

  notifyMiyoIndexChanged();
}

export function onMiyoIndexChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyMiyoIndexChanged(): void {
  listeners.forEach((listener) => listener());
}
