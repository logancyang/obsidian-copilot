import type { ProjectConfig } from "@/aiParams";
import { AGENTS_FILE_NAME, findCachedInstructionFile } from "@/instructions/agentsFile";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import type { ProjectFileRecord } from "@/projects/type";
import { App, normalizePath } from "obsidian";

interface NormalizedContextSource {
  inclusions: string;
  exclusions: string;
  webUrls: string;
  youtubeUrls: string;
}

function normalizeMultiline(value: string | undefined): string {
  if (!value) return "";
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export function normalizeProjectContextSource(project: ProjectConfig): NormalizedContextSource {
  const source = project.contextSource;
  return {
    inclusions: normalizeMultiline(source?.inclusions),
    exclusions: normalizeMultiline(source?.exclusions),
    webUrls: normalizeMultiline(source?.webUrls),
    youtubeUrls: normalizeMultiline(source?.youtubeUrls),
  };
}

export function getProjectContextSignature(record: ProjectFileRecord): string {
  return JSON.stringify({
    source: normalizeProjectContextSource(record.project),
    filePath: record.filePath,
  });
}

const UNVERIFIABLE_INSTRUCTIONS = "agents:unverifiable";

export function landingCaptureIsVerifiable(signature: string | null): boolean {
  return signature !== null && !signature.includes(UNVERIFIABLE_INSTRUCTIONS);
}

export function getProjectLandingCaptureSignature(app: App, record: ProjectFileRecord): string {
  return JSON.stringify({
    context: getProjectContextSignature(record),
    instructions: getInstructionsFingerprint(app, record),
  });
}

function getInstructionsFingerprint(app: App, record: ProjectFileRecord): string {
  const projectFolderPath = getProjectAnchorFromConfigPath(record.filePath).projectFolderPath;
  const agentsPath = normalizePath(`${projectFolderPath}/${AGENTS_FILE_NAME}`);
  const file = findCachedInstructionFile(app, agentsPath);
  if (file) return `agents:${file.stat.mtime}:${file.stat.size}`;
  if (agentsPath.split("/").some((segment) => segment.startsWith("."))) {
    return UNVERIFIABLE_INSTRUCTIONS;
  }
  return `legacy:${record.project.systemPrompt ?? ""}`;
}

export function composeContextDirtyKey(configSignature: string, epoch: number): string {
  return `${configSignature}#${epoch}`;
}

export function contextDirtyKeyMatchesConfig(
  key: string | undefined,
  configSignature: string
): boolean {
  if (key === undefined) return false;
  if (key === configSignature) return true;
  const lastHash = key.lastIndexOf("#");
  if (lastHash < 0) return false;
  return key.slice(0, lastHash) === configSignature && /^\d+$/.test(key.slice(lastHash + 1));
}
