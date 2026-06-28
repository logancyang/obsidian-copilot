import type { ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";

/**
 * The context-source fields whose change should invalidate a project's
 * materialized context. Deliberately excludes `systemPrompt`, `modelConfigs`,
 * `UsageTimestamps`, etc. — those affect a session's behavior but not which
 * external sources get materialized into the off-vault conversion cache.
 */
interface NormalizedContextSource {
  inclusions: string;
  exclusions: string;
  webUrls: string;
  youtubeUrls: string;
}

/**
 * Collapse a multiline config value to a canonical form so cosmetic edits
 * (trailing spaces, blank lines, reordering-free whitespace) don't read as a
 * real change. Returns lines trimmed, blanks dropped, rejoined with `\n`.
 *
 * DESIGN NOTE: this is a deliberately CHEAP textual normalization, not a
 * resolved-glob comparison. A reviewer may suggest deriving the signature from
 * `getMatchingPatterns()` so two patterns that match the same files read as
 * equal — don't. That would resolve globs against the live vault on every
 * project-records publish (a hot path), and the worst case of an over-eager
 * signature is benign: one extra materialization that single-flights and
 * cheap-skips unchanged sources — the same cost as the feature's happy path.
 */
function normalizeMultiline(value: string | undefined): string {
  if (!value) return "";
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Canonical view of the fields that drive context materialization. Used to
 * decide whether a project edit actually changed its external sources (vs. a
 * usage-timestamp touch or an unrelated config tweak).
 */
export function normalizeProjectContextSource(project: ProjectConfig): NormalizedContextSource {
  const source = project.contextSource;
  return {
    inclusions: normalizeMultiline(source?.inclusions),
    exclusions: normalizeMultiline(source?.exclusions),
    webUrls: normalizeMultiline(source?.webUrls),
    youtubeUrls: normalizeMultiline(source?.youtubeUrls),
  };
}

/**
 * A stable fingerprint of everything that determines a project's materialized
 * context: its normalized source fields PLUS its `filePath` (the project folder
 * — and therefore the resolved cwd and the manifest's absolute paths — moves
 * when the file is renamed/relocated even if the config is byte-identical). Two
 * records with the same signature need no re-materialization.
 */
export function getProjectContextSignature(record: ProjectFileRecord): string {
  return JSON.stringify({
    source: normalizeProjectContextSource(record.project),
    filePath: record.filePath,
  });
}

/**
 * Fingerprint of everything an EMPTY project landing session bakes in at
 * creation: the materialization signature PLUS the project's instruction body.
 * A landing session captures its instructions once at start — Claude via
 * `systemPromptAppend`, codex/opencode via the AGENTS.md mirror read from cwd —
 * so a System-Prompt-only edit must replace the still-empty session for the
 * first message to use the new instructions, even though it changes no
 * materialized source.
 *
 * Kept SEPARATE from {@link getProjectContextSignature} on purpose: that one
 * drives re-materialization (glob/URL/PDF conversion) and must stay insensitive
 * to `systemPrompt` (see its DESIGN NOTE) — folding the prompt in there would
 * re-materialize on every prompt edit. `systemPrompt` is compared verbatim
 * (no `normalizeMultiline`): `project.md` preserves the body's whitespace, so a
 * whitespace-only edit is still a real change to what the session captures.
 */
export function getProjectLandingCaptureSignature(record: ProjectFileRecord): string {
  return JSON.stringify({
    context: getProjectContextSignature(record),
    systemPrompt: record.project.systemPrompt ?? "",
  });
}
