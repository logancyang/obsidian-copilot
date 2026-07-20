import {
  deriveConversationsFolder,
  deriveCustomPromptsFolder,
  deriveMemoryFolder,
  deriveSkillsFolder,
  deriveSystemPromptsFolder,
} from "@/settings/copilotFolder";
import type { CopilotSettings } from "@/settings/model";

/**
 * One legacy sub-folder whose data needs relocating after the v3→v4 folder
 * consolidation — its stored old path differs from the path Copilot now derives
 * to (because the folder was customized, or the root itself moved). `oldPath` is
 * where the data physically still lives; `newPath` is where Copilot reads and
 * writes now.
 */
export interface FolderRelocationEntry {
  /** Human-readable name of the data class (e.g. "Chat conversations"). */
  label: string;
  /** Stored path Copilot used before the upgrade; the files remain here. */
  oldPath: string;
  /** Derived path Copilot reads and writes after the upgrade. */
  newPath: string;
}

/** Settings slice the upgrade notice inspects. */
type UpgradeNoticeSettings = Pick<
  CopilotSettings,
  | "copilotFolder"
  | "defaultSaveFolder"
  | "customPromptsFolder"
  | "userSystemPromptsFolder"
  | "memoryFolderName"
  | "agentMode"
>;

/** Settings slice the pure derivation helpers depend on. */
type RootSettings = Pick<CopilotSettings, "copilotFolder">;

interface SubFolderSpec {
  /** Display name for the relocation entry. */
  label: string;
  /** Stored legacy field value, shown verbatim as the old path. */
  legacyValue: (settings: UpgradeNoticeSettings) => string;
  /** Derive the effective sub-folder path from a settings snapshot. */
  derive: (settings: RootSettings) => string;
}

/**
 * The legacy sub-folders whose stored path is compared against the derived new
 * path to build the relocation list. Each had a real writer before v4 — either a
 * user-facing path input or, for memory, a "Memory Folder Name" field that
 * shipped in the Copilot Plus settings from 3.1.0 through 3.3.3 and wrote
 * `memoryFolderName` via `updateSetting`. A vault upgraded from any of those
 * releases can therefore carry a non-default `memoryFolderName` in `data.json`,
 * and the new `UserMemoryManager` reads the derived `<root>/memory` instead, so
 * memory must be surfaced when the two differ.
 *
 * Projects (`projectsFolder`) is deliberately absent: although it is a persisted
 * field, a full history search found no product write path (no `updateSetting`
 * call, no input control) — only the default seed, sanitize fallback, and read
 * sites. Its stored value is therefore always the default, so it can never
 * differ from the derived path at upgrade. If a future review flags projects as
 * missing here, point them at this note and re-check for a real writer before
 * adding it.
 */
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

/**
 * Canonicalize a vault-relative folder path for equality comparison only.
 * Normalizes backslashes, duplicate and surrounding slashes so a user who never
 * customized a folder (but whose stored value differs by a trailing slash) is
 * not mistaken for a customizer. Comparison is case-sensitive to match the QA
 * folder matcher and the rest of the codebase's path handling: on a
 * case-sensitive filesystem (Linux) `Copilot/...` and `copilot/...` are
 * genuinely different directories, so lowercasing here would misjudge a real
 * customizer as a default user and skip their migration notice, silently
 * orphaning their old conversations. The trade-off is that on a case-insensitive
 * filesystem (macOS/Windows) a stored value differing only by case yields one
 * benign no-op prompt — an acceptable, low-risk cost for not under-detecting
 * real customizers on case-sensitive filesystems.
 */
function canonicalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * Build the list of legacy sub-folders whose data needs relocating after the
 * v3→v4 folder consolidation: every folder whose stored old path differs from
 * the path it now derives to (covers both individually-customized folders and,
 * when the root itself moved, folders that only shifted because of the new
 * root). Pure — the caller passes the settings snapshot so the decision is
 * unit-testable without the global store. Returns an empty array when nothing
 * needs to move (e.g. default users), which the caller treats as "do not prompt".
 */
export function buildUpgradeRelocationEntries(
  settings: UpgradeNoticeSettings
): FolderRelocationEntry[] {
  return SUBFOLDER_SPECS.flatMap((spec) => {
    const oldPath = spec.legacyValue(settings);
    const newPath = spec.derive(settings);
    // Only surface a folder whose data actually needs to move: if the old
    // location already resolves to the new derived path there is nothing to
    // relocate. This also covers default (never-customized) users, whose old
    // value equals the derived default.
    if (canonicalizePath(oldPath) === canonicalizePath(newPath)) {
      return [];
    }
    return [{ label: spec.label, oldPath, newPath }];
  });
}
