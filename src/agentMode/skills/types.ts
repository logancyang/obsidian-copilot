import type { BackendId } from "@/agentMode/session/types";

export type { BackendId };

/**
 * Where a managed skill's `SKILL.md` actually lives. Three states:
 *
 *   - `canonical` — `<vault>/<configured-skills-folder>/<name>/SKILL.md`.
 *     Agent-folder entries are symlinks pointing here. `enabledAgents` is
 *     sourced from `metadata.copilot-enabled-agents` in the frontmatter.
 *   - `project` with one agent dir — `SKILL.md` lives as a real directory
 *     inside that agent's project folder (e.g. `.claude/skills/<name>/`),
 *     with no canonical copy and no symlinks. `enabledAgents` equals the
 *     single agent owning the dir.
 *   - `project` with two or more agent dirs (mirrored) — identical
 *     SKILL.md directory trees in multiple `<vault>/.<agent>/skills/<name>/`.
 *     Merged into one row by discovery (see `mergeDiscovery.ts`).
 */
export type SkillLocation = { kind: "canonical" } | { kind: "project"; agentDirs: BackendId[] };

/**
 * Canonical in-memory shape of a managed skill, derived from a
 * `SKILL.md` file's frontmatter plus on-disk location.
 *
 * For canonical skills, the shape is close to the agentskills.io spec; the
 * Copilot-specific fanout (`enabledAgents`) is sourced from
 * `metadata.copilot-enabled-agents` on the file and is the source of
 * truth for which agent project dirs should hold a symlink.
 *
 * For project skills (single or mirrored), `enabledAgents` is inferred
 * from `location.agentDirs` — no `metadata.copilot-enabled-agents` field
 * is required on the SKILL.md.
 */
export interface Skill {
  /** Spec-validated skill name (matches parent dir; 1–64 chars; `^[a-z0-9]+(-[a-z0-9]+)*$`). */
  name: string;
  /** Spec-required description, 1–1024 chars. */
  description: string;
  /**
   * Absolute path to the SKILL.md to display/open. For canonical skills:
   * the canonical SKILL.md. For project-mirrored skills: the
   * alphabetically-first agent's copy (deterministic).
   */
  filePath: string;
  /**
   * Absolute path to the directory holding {@link filePath}. Reveal-in-vault
   * opens this directory.
   */
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
  /**
   * Source of truth for symlink fanout (canonical skills) or the inferred
   * single-source / mirrored set of agents (project skills).
   */
  enabledAgents: BackendId[];
  /** Where this skill's SKILL.md actually lives — drives toggle semantics and the UI. */
  location: SkillLocation;
  /**
   * Recursive content hash of the skill directory (SKILL.md plus all
   * supporting files, POSIX-stable). Only set for project skills, where it
   * drives the same-name + same-content merge rule in `mergeDiscovery.ts`.
   * Canonical skills do not carry this — they always have exactly one copy.
   */
  contentHash?: string;
  /**
   * Display suffix appended to {@link name} when rendering the skill in the
   * Skills tab. Set only when discovery found a same-name conflict it
   * couldn't merge (different content across agents), e.g. `" (claude)"`.
   * The on-disk frontmatter `name` is unchanged. UI concern only — never
   * written back to disk and never passed to the LLM.
   */
  displayNameSuffix?: string;
}
