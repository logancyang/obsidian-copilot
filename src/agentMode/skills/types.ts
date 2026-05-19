import type { BackendId } from "@/agentMode/session/types";

export type { BackendId };

/**
 * Canonical in-memory shape of a managed skill, derived from a
 * `SKILL.md` file's frontmatter plus on-disk location.
 *
 * The shape is intentionally close to the agentskills.io spec; the
 * Copilot-specific fanout (`enabledAgents`) is sourced from
 * `metadata.copilot-enabled-agents` on the file and is the source of
 * truth for which agent project dirs should hold a symlink.
 */
export interface Skill {
  /** Spec-validated skill name (matches parent dir; 1–64 chars; `^[a-z0-9]+(-[a-z0-9]+)*$`). */
  name: string;
  /** Spec-required description, 1–1024 chars. */
  description: string;
  /** Absolute path to the canonical SKILL.md file. */
  filePath: string;
  /** Absolute path to the canonical skill directory (parent of SKILL.md). */
  dirPath: string;
  /** Body of SKILL.md after the frontmatter block. */
  body: string;
  /** Optional spec field. */
  license?: string;
  /** Optional spec field. */
  compatibility?: string;
  /** Spec experimental + Claude-native; space-separated list as the literal string from frontmatter. */
  allowedTools?: string;
  /** Claude Code-only: model override. Honored by Claude's loader. */
  model?: string;
  /** Claude Code-only: when true, Claude cannot auto-invoke the skill. Defaults to false. */
  disableModelInvocation?: boolean;
  /** Claude Code-only (kebab-case top-level): when false, Copilot hides the skill from invocation surfaces. */
  userInvocable?: boolean;
  /** Source of truth for symlink fanout — agents whose project dir should hold a link. */
  enabledAgents: BackendId[];
}

/**
 * A candidate for bulk import — a real directory living under
 * `.<agent>/skills/<name>/` that is not yet a symlink into the
 * canonical store. Populated by the import-detection walker.
 */
export interface ImportCandidate {
  /** Original folder name (also the proposed canonical name before suffixing). */
  name: string;
  /** Source agent — drives both the consent-card grouping and the initial `enabledAgents`. */
  sourceAgent: BackendId;
  /** Absolute path to the source directory (the one that will be moved). */
  sourcePath: string;
  /** Number of files in the source directory (shallow walk, includes SKILL.md). */
  fileCount: number;
  /** Total bytes across those files. Powers the "3 files · 4.2 KB" meta. */
  totalBytes: number;
}
