import { createNodeContextCacheFs } from "@/context/contextCacheFs";
import { markersDir } from "@/context/conversionsLocation";
import type { App } from "obsidian";

export async function clearProjectMarkers(app: App, projectId: string): Promise<void> {
  const normalizedId = (projectId || "").trim();
  if (!normalizedId) return;
  await createNodeContextCacheFs(markersDir(app, normalizedId)).clear();
}
