import {
  deriveConversationsFolder,
  deriveCustomPromptsFolder,
  deriveMemoryFolder,
  deriveSkillsFolder,
  deriveSystemPromptsFolder,
} from "@/settings/copilotFolder";
import type { CopilotSettings } from "@/settings/model";

export interface FolderRelocationEntry {
  label: string;
  oldPath: string;
  newPath: string;
}

type UpgradeNoticeSettings = Pick<
  CopilotSettings,
  | "copilotFolder"
  | "defaultSaveFolder"
  | "customPromptsFolder"
  | "userSystemPromptsFolder"
  | "memoryFolderName"
  | "agentMode"
>;

type RootSettings = Pick<CopilotSettings, "copilotFolder">;

interface SubFolderSpec {
  label: string;
  legacyValue: (settings: UpgradeNoticeSettings) => string;
  derive: (settings: RootSettings) => string;
}

const SUBFOLDER_SPECS: readonly SubFolderSpec[] = [
  {
    label: "Chat conversations",
    legacyValue: (s) => s.defaultSaveFolder,
    derive: deriveConversationsFolder,
  },
  {
    label: "Custom prompts",
    legacyValue: (s) => s.customPromptsFolder,
    derive: deriveCustomPromptsFolder,
  },
  {
    label: "System prompts",
    legacyValue: (s) => s.userSystemPromptsFolder,
    derive: deriveSystemPromptsFolder,
  },
  {
    label: "Agent skills",
    legacyValue: (s) => s.agentMode.skills.folder,
    derive: deriveSkillsFolder,
  },
  {
    label: "Memory",
    legacyValue: (s) => s.memoryFolderName,
    derive: deriveMemoryFolder,
  },
];

function canonicalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function buildUpgradeRelocationEntries(
  settings: UpgradeNoticeSettings
): FolderRelocationEntry[] {
  return SUBFOLDER_SPECS.flatMap((spec) => {
    const oldPath = spec.legacyValue(settings);
    const newPath = spec.derive(settings);
    if (canonicalizePath(oldPath) === canonicalizePath(newPath)) {
      return [];
    }
    return [{ label: spec.label, oldPath, newPath }];
  });
}
